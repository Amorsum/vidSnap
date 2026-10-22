"""真实 yt-dlp/FFmpeg + 本地 TLS fixture；仅此测试将白名单公网主机映射到本地。

需要本机 yt-dlp、FFmpeg、Chrome / Python Playwright 和 cryptography；不读取 cookies，不访问平台或模型。
"""
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch
import wave

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import media_network as network

audio = io.BytesIO()
with wave.open(audio, "wb") as writer:
    writer.setnchannels(1)
    writer.setsampwidth(2)
    writer.setframerate(16000)
    writer.writeframes(b"\0\0" * 1600)


class Fixture(BaseHTTPRequestHandler):
    paths = []

    def do_GET(self):
        Fixture.paths.append(self.path)
        if self.path in ("/start", "/private"):
            self.send_response(302)
            self.send_header("Location", "/media.wav" if self.path == "/start" else "https://127.0.0.1/private")
            self.end_headers()
            return
        self.send_response(200)
        if self.path == "/page":
            body = b"<html><body>Media network fixture</body></html>"
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio.getvalue())))
        self.end_headers()
        self.wfile.write(audio.getvalue())

    def log_message(self, *_):
        pass


def main():
    with tempfile.TemporaryDirectory(prefix="vidsnap-egress-smoke-") as directory:
        root = Path(directory)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "VidSnap local test only")])
        now = datetime.datetime.now(datetime.timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                       .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
                       .not_valid_after(now + datetime.timedelta(hours=1))
                       .add_extension(x509.SubjectAlternativeName([x509.DNSName("r1.googlevideo.com"), x509.DNSName("v3.douyinvod.com")]), critical=False)
                       .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256()))
        cert_path, key_path = root / "test-ca.pem", root / "test-key.pem"
        cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cert_path, key_path)
        client_context = ssl.create_default_context(cafile=str(cert_path))
        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
            server.socket = server_context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def local_fixture_connection(host, scope, timeout=15):
                network.validate_url("https://" + host, scope)
                return socket.create_connection(("127.0.0.1", server.server_port), timeout)
            try:
                with patch.object(network, "open_public_connection", side_effect=local_fixture_connection), patch.object(ssl, "_create_default_https_context", return_value=client_context):
                    direct = root / "direct.wav"
                    network.download_media("https://v3.douyinvod.com/start", direct)
                    assert direct.read_bytes() == audio.getvalue()
                    try:
                        network.download_media("https://v3.douyinvod.com/private", root / "denied.wav")
                        raise AssertionError("私网跳转未拒绝")
                    except network.NetworkPolicyError:
                        assert not (root / "denied.wav").exists()
                    info_path = root / "fixture.json"
                    info_path.write_text(json.dumps({"id": "fixture", "title": "local fixture", "ext": "wav",
                                                     "url": "https://r1.googlevideo.com/start", "webpage_url": "https://www.youtube.com/watch?v=fixture0000"}), encoding="utf-8")
                    # 仅给测试子进程追加本地 CA，生产仍使用系统证书验证。
                    with patch.dict(os.environ, {"SSL_CERT_FILE": str(cert_path), "REQUESTS_CA_BUNDLE": str(cert_path)}):
                        result = network.run_yt_dlp(["--load-info-json", str(info_path), "--output", str(root / "native.wav"),
                                                     "--no-playlist", "--quiet", "--no-progress", "--compat-options", "no-certifi"], 20)
                    assert result == 0
                    assert (root / "native.wav").read_bytes() == audio.getvalue()
                    with network.media_proxy("douyin") as proxy, sync_playwright() as playwright:
                        browser = playwright.chromium.launch(headless=True, channel="chrome", **network.chromium_network_options(proxy))
                        try:
                            # 仅浏览器测试信任临时证书，生产浏览器没有此开关。
                            page = browser.new_page(ignore_https_errors=True, service_workers="block")
                            response = page.goto("https://v3.douyinvod.com/page", timeout=10000)
                            assert response.status == 200
                            assert page.locator("body").inner_text() == "Media network fixture"
                        finally:
                            browser.close()
                    converted = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
                                                "-i", str(direct), "-c:a", "aac", str(root / "local.m4a")], capture_output=True, timeout=15)
                    assert converted.returncode == 0
                    blocked = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
                                              "-i", "https://127.0.0.1/private", str(root / "blocked.wav")], capture_output=True, timeout=5)
                    assert blocked.returncode != 0 and b"not on whitelist" in blocked.stderr
                    assert "/private" in Fixture.paths and "/media.wav" in Fixture.paths
                    print('{"native_yt_dlp":"passed","browser_public_fixture":"passed","media_redirect":"passed","private_redirect":"blocked","local_ffmpeg":"passed","network_ffmpeg":"blocked","platform_requests":0}')
            finally:
                server.shutdown()
                thread.join()


main()
