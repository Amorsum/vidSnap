"""无平台网络/密钥的出站边界回归：连接与跳转先列预期再执行。"""
import contextlib
import http.client
import io
import os
from pathlib import Path
import socket
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import media_network as network


def dns(address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    target = (address, 443, 0, 0) if family == socket.AF_INET6 else (address, 443)
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", target)


class Response:
    def __init__(self, status=200, location=None, content=b"video", length=None):
        self.status, self.location = status, location
        self.content = io.BytesIO(content)
        self.length = length

    def getheader(self, key):
        return {"Location": self.location, "Content-Length": self.length}.get(key)

    def read(self, size):
        return self.content.read(size)


class MediaNetworkTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": ""})
        environment.start()
        self.addCleanup(environment.stop)

    def test_bilibili_domains_and_short_links(self):
        for host in ["www.bilibili.com", "api.bilibili.com", "b23.tv", "upos-sz-mirror.bilivideo.com", "aisubtitle.hdslb.com"]:
            network.validate_url("https://" + host + "/video", "bilibili")
        for url in ["https://bilibili.com.evil.test/", "https://evilbilibili.com/", "https://127.0.0.1/", "https://www.youtube.com/"]:
            with self.assertRaises(network.NetworkPolicyError):
                network.validate_url(url, "bilibili")
        calls = []
        @contextlib.contextmanager
        def request(url, scope):
            calls.append((url, scope))
            yield Response(302, "https://www.bilibili.com/video/BV1xx411c7mD/?p=2&share=1")
        with patch.object(network, "request_url", request):
            self.assertEqual(network.resolve_bilibili_url("https://b23.tv/abc"), "https://www.bilibili.com/video/BV1xx411c7mD?p=2")
        self.assertEqual(len(calls), 1)

    def test_bilibili_redirect_rejected_before_next_request(self):
        for target in ["https://127.0.0.1/", "https://evil.test/", "https://space.bilibili.com/123", "https://www.bilibili.com/video/BV1xx411c7mD?p=0", "https://www.bilibili.com/video/BV1xx411c7mD?p=1&p=2", "https://b23.tv/abc"]:
            calls = []
            @contextlib.contextmanager
            def request(url, scope):
                calls.append(url)
                yield Response(302, target)
            with patch.object(network, "request_url", request), self.assertRaises(network.NetworkPolicyError):
                network.resolve_bilibili_url("https://b23.tv/abc")
            self.assertEqual(len(calls), 1)

    def test_bilibili_media_port_is_restricted_and_dns_is_pinned(self):
        host = "xy112x1x130x31xy.mcdn.bilivideo.cn"
        network.validate_url(f"https://{host}:8082/media", "bilibili")
        for url, scope in [(f"https://{host}:8082/media", "youtube"),
                           ("https://api.bilibili.com:8082/", "bilibili"),
                           ("https://mcdn.bilivideo.cn:8082/", "bilibili"),
                           (f"https://{host}:8083/", "bilibili"),
                           (f"http://{host}:8082/", "bilibili"),
                           ("https://evil.mcdn.bilivideo.cn.example:8082/", "bilibili")]:
            with self.subTest(url=url, scope=scope), self.assertRaises(network.NetworkPolicyError):
                network.validate_url(url, scope)
        public = (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", 8082))
        with patch.object(socket, "getaddrinfo", return_value=[public]) as lookup, patch.object(socket, "socket") as create:
            network.open_public_connection(host, "bilibili", port=8082)
            lookup.assert_called_once_with(host, 8082, type=socket.SOCK_STREAM)
            create.return_value.connect.assert_called_once_with(("8.8.8.8", 8082))
        with patch.object(socket, "getaddrinfo", return_value=[dns("10.0.0.1")]), patch.object(socket, "socket") as create:
            with self.assertRaises(network.NetworkPolicyError):
                network.open_public_connection(host, "bilibili", port=8082)
            create.assert_not_called()
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "http://127.0.0.1:7890"}), patch.object(socket, "getaddrinfo", return_value=[public]), patch.object(network, "connect_upstream_proxy") as connect:
            network.open_public_connection(host, "bilibili", port=8082)
            connect.assert_called_once_with("http://127.0.0.1:7890", "8.8.8.8", 15, 8082)
        with patch.object(network.http.client, "HTTPConnection") as proxy:
            network.connect_upstream_proxy("http://127.0.0.1:7890", "8.8.8.8", 5, 8082)
            proxy.return_value.set_tunnel.assert_called_once_with("8.8.8.8", 8082, {})

    def test_bilibili_media_port_is_preserved_in_tls_connection(self):
        host = "xy112x1x130x31xy.mcdn.bilivideo.cn"
        connection = network.PublicHTTPSConnection(host, "bilibili", port=8082)
        raw = Mock()
        with patch.object(network, "open_public_connection", return_value=raw) as connect, patch.object(connection._context, "wrap_socket") as tls:
            connection.connect()
            connect.assert_called_once_with(host, "bilibili", 15, 8082)
            tls.assert_called_once_with(raw, server_hostname=host)

    def test_bilibili_proxy_connect_preserves_media_port(self):
        host = "xy112x1x130x31xy.mcdn.bilivideo.cn"
        peer, upstream = socket.socketpair()
        with contextlib.closing(peer), contextlib.closing(upstream), network.media_proxy("bilibili") as proxy:
            port = int(proxy.rsplit(":", 1)[1])
            with patch.object(network, "open_public_connection", return_value=upstream) as connect:
                with socket.create_connection(("127.0.0.1", port), timeout=5) as client:
                    client.sendall(f"CONNECT {host}:8082 HTTP/1.1\r\nHost: {host}:8082\r\n\r\n".encode())
                    response = b""
                    while b"\r\n\r\n" not in response:
                        response += client.recv(4096)
                    self.assertIn(b"200", response)
                    connect.assert_called_once_with(host, "bilibili", port=8082)
                    client.sendall(b"media bytes")
                    self.assertEqual(peer.recv(100), b"media bytes")

    def test_01_host_boundaries(self):
        for url in ["https://www.youtube.com/watch?v=id", "https://r1.googlevideo.com/a?signature=x"]:
            network.validate_url(url, "youtube")
        for url in ["https://v.douyin.com/abc/", "https://v3.douyinvod.com/a"]:
            network.validate_url(url, "douyin")
        for url in ["http://www.youtube.com/", "https://youtube.com.evil.test/", "https://evilyoutube.com/",
                    "https://user@youtube.com/", "https://@youtube.com/", "https://youtube.com:8443/",
                    "https://youtube.com./", "https://you\\tube.com/", "https://you\ntube.com/",
                    "file:///etc/passwd", "https://127.0.0.1/", "https://[::1]/", "https://www.douyin.com/"]:
            with self.subTest(url=url), self.assertRaises(network.NetworkPolicyError):
                network.validate_url(url, "youtube")

    def test_02_private_and_transition_addresses(self):
        for address in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "0.0.0.0",
                        "100.64.0.1", "192.0.0.9", "192.88.99.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
                        "::", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::a00:1",
                        "2002:7f00:1::", "2001::1", "2001:db8::1", "ff02::1"]:
            with self.subTest(address=address):
                self.assertFalse(network.is_public_address(address))
        for address in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]:
            self.assertTrue(network.is_public_address(address))

    def test_03_dns_all_answers_validated_before_socket(self):
        for addresses in [[dns("127.0.0.1")], [dns("8.8.8.8"), dns("10.0.0.1")], []]:
            with patch.object(socket, "getaddrinfo", return_value=addresses), patch.object(socket, "socket") as create:
                with self.assertRaises(network.NetworkPolicyError):
                    network.open_public_connection("www.youtube.com", "youtube")
                create.assert_not_called()

    def test_04_connection_pins_validated_sockaddr(self):
        with patch.object(socket, "getaddrinfo", return_value=[dns("8.8.8.8")]) as lookup, patch.object(socket, "socket") as create:
            network.open_public_connection("www.youtube.com", "youtube")
            lookup.assert_called_once()
            create.return_value.connect.assert_called_once_with(("8.8.8.8", 443))

    def test_05_ipv6_connection_and_failure_cleanup(self):
        with patch.object(socket, "getaddrinfo", return_value=[dns("2606:4700:4700::1111")]), patch.object(socket, "socket") as create:
            create.return_value.connect.side_effect = OSError("failure")
            with self.assertRaises(OSError):
                network.open_public_connection("www.youtube.com", "youtube")
            create.return_value.close.assert_called_once()

    def test_06_tls_preserves_original_hostname_and_verification(self):
        connection = network.PublicHTTPSConnection("www.douyin.com", "douyin")
        self.assertEqual(connection._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(connection._context.check_hostname)
        raw = Mock()
        with patch.object(network, "open_public_connection", return_value=raw), patch.object(connection._context, "wrap_socket") as tls:
            connection.connect()
            tls.assert_called_once_with(raw, server_hostname="www.douyin.com")

    def test_07_valid_short_hops_and_canonical_final(self):
        calls = []
        @contextlib.contextmanager
        def request(url, scope):
            calls.append(url)
            yield Response(302, "/second/" if len(calls) == 1 else "https://www.iesdouyin.com/share/video/123/?share=x")
        with patch.object(network, "request_url", request):
            self.assertEqual(network.resolve_douyin_url("https://v.douyin.com/first/"), "https://www.douyin.com/video/123")
        self.assertEqual(calls, ["https://v.douyin.com/first/", "https://v.douyin.com/second/"])

    def test_08_short_rejects_next_target_before_request(self):
        for target in ["http://www.douyin.com/video/1", "https://127.0.0.1/", "https://www.douyin.com.evil.test/video/1",
                       "https://v3.douyinvod.com/video/1", "https://www.douyin.com/user/1", "https://@www.douyin.com/video/1"]:
            request = Mock(return_value=contextlib.nullcontext(Response(302, target)))
            with self.subTest(target=target), patch.object(network, "request_url", request), self.assertRaises(network.NetworkPolicyError):
                network.resolve_douyin_url("https://v.douyin.com/first/")
            self.assertEqual(request.call_count, 1)

    def test_09_short_cycle_hop_limit_and_missing_location(self):
        for response in [Response(302, "https://v.douyin.com/first/"), Response(302), Response(200)]:
            with patch.object(network, "request_url", return_value=contextlib.nullcontext(response)), self.assertRaises(network.NetworkPolicyError):
                network.resolve_douyin_url("https://v.douyin.com/first/")
        count = 0
        @contextlib.contextmanager
        def request(url, scope):
            nonlocal count
            count += 1
            yield Response(302, f"https://v.douyin.com/hop{count}/")
        with patch.object(network, "request_url", request), self.assertRaises(network.NetworkPolicyError):
            network.resolve_douyin_url("https://v.douyin.com/first/", max_redirects=2)
        self.assertEqual(count, 3)

    def test_10_direct_canonical_needs_no_short_network(self):
        with patch.object(network, "request_url") as request:
            self.assertEqual(network.resolve_douyin_url("https://www.douyin.com/video/123"), "https://www.douyin.com/video/123")
            request.assert_not_called()

    def test_11_media_download_and_relative_redirect(self):
        calls = []
        @contextlib.contextmanager
        def request(url, scope):
            calls.append(url)
            yield Response(302, "/video") if len(calls) == 1 else Response(content=b"fixture", length="7")
        with tempfile.TemporaryDirectory() as directory, patch.object(network, "request_url", request):
            output = Path(directory) / "video.mp4"
            network.download_media("https://v3.douyinvod.com/start", output)
            self.assertEqual(output.read_bytes(), b"fixture")
        self.assertEqual(calls[-1], "https://v3.douyinvod.com/video")

    def test_12_media_size_empty_truncation_and_status_cleanup(self):
        for response in [Response(content=b"toolarge"), Response(length="20"), Response(content=b""), Response(length="10"), Response(403)]:
            with tempfile.TemporaryDirectory() as directory, patch.object(network, "request_url", return_value=contextlib.nullcontext(response)):
                output = Path(directory) / "video.mp4"
                with self.assertRaises((ValueError, OSError)):
                    network.download_media("https://v3.douyinvod.com/start", output, max_bytes=5)
                self.assertFalse(output.exists())

    def test_13_media_redirect_private_host_never_requested(self):
        request = Mock(return_value=contextlib.nullcontext(Response(302, "https://169.254.169.254/latest/")))
        with tempfile.TemporaryDirectory() as directory, patch.object(network, "request_url", request), self.assertRaises(network.NetworkPolicyError):
            network.download_media("https://v3.douyinvod.com/start", Path(directory) / "video.mp4")
        self.assertEqual(request.call_count, 1)

    def test_14_proxy_rejects_private_dns_and_bad_ports(self):
        with network.media_proxy("youtube") as proxy, patch.object(socket, "getaddrinfo", return_value=[dns("127.0.0.1")]):
            port = int(proxy.rsplit(":", 1)[1])
            for target in ["www.youtube.com:443", "www.youtube.com:8443", "127.0.0.1:443", "evil.test:443", "www.youtube.com:443/path"]:
                # numeric local proxy connection bypasses patched getaddrinfo in this test only.
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                connection.sock = socket.socket()
                connection.sock.connect(("127.0.0.1", port))
                connection.request("CONNECT", target)
                self.assertEqual(connection.getresponse().status, 403)
                connection.close()

    def test_15_proxy_tunnel_bytes_and_shutdown(self):
        peer, upstream = socket.socketpair()
        with contextlib.closing(peer), contextlib.closing(upstream), network.media_proxy("youtube") as proxy:
            port = int(proxy.rsplit(":", 1)[1])
            with patch.object(network, "open_public_connection", return_value=upstream):
                with socket.create_connection(("127.0.0.1", port), timeout=5) as client:
                    client.sendall(b"CONNECT www.youtube.com:443 HTTP/1.1\r\nHost: www.youtube.com\r\n\r\n")
                    response = b""
                    while b"\r\n\r\n" not in response:
                        response += client.recv(4096)
                    self.assertIn(b"200", response)
                    client.sendall(b"mock TLS bytes")
                    self.assertEqual(peer.recv(100), b"mock TLS bytes")
                    peer.sendall(b"server bytes")
                    self.assertEqual(client.recv(100), b"server bytes")
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=1)

    def test_16_yt_command_locks_proxy_config_native_and_ffmpeg(self):
        command = network.yt_dlp_command(["--dump-json", "https://www.youtube.com/watch?v=id"], "http://127.0.0.1:123")
        self.assertIn("--ignore-config", command)
        self.assertIn("--no-plugin-dirs", command)
        self.assertEqual(command[command.index("--proxy") + 1], "http://127.0.0.1:123")
        self.assertEqual(command[command.index("--downloader") + 1], "native")
        self.assertEqual(command[command.index("--fixup") + 1], "never")
        for option in ["--downloader-args", "--postprocessor-args"]:
            self.assertEqual(command[command.index(option) + 1], "ffmpeg_i:-protocol_whitelist file,pipe")

    def test_17_process_timeout_kills_owned_child_and_clears_proxy_bypass(self):
        with patch.dict(os.environ, {"no_proxy": "*", "HTTPS_PROXY": "http://untrusted"}), patch.object(network, "media_proxy", return_value=contextlib.nullcontext("http://127.0.0.1:123")), patch.object(network.subprocess, "Popen") as popen:
            child = popen.return_value.__enter__.return_value
            child.wait.side_effect = [network.subprocess.TimeoutExpired("yt-dlp", 1), 0]
            with self.assertRaises(network.subprocess.TimeoutExpired):
                network.run_yt_dlp(["--dump-json"], 1)
            child.kill.assert_called_once()
            env = popen.call_args.kwargs["env"]
            self.assertEqual(env["NO_PROXY"], "")
            self.assertNotIn("no_proxy", env)
            self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:123")

    def test_18_upstream_receives_only_validated_ip(self):
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "http://127.0.0.1:7890"}), patch.object(socket, "getaddrinfo", return_value=[dns("8.8.8.8")]), patch.object(network, "connect_upstream_proxy") as connect:
            network.open_public_connection("www.youtube.com", "youtube")
            connect.assert_called_once_with("http://127.0.0.1:7890", "8.8.8.8", 15, 443)
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "http://127.0.0.1:7890"}), patch.object(socket, "getaddrinfo", return_value=[dns("127.0.0.1")]), patch.object(network, "connect_upstream_proxy") as connect:
            with self.assertRaises(network.NetworkPolicyError):
                network.open_public_connection("www.youtube.com", "youtube")
            connect.assert_not_called()

    def test_19_upstream_fixed_address_auth_and_tunnel(self):
        with patch.object(network.http.client, "HTTPConnection") as proxy:
            expected = proxy.return_value.sock
            self.assertIs(network.connect_upstream_proxy("http://test:password@127.0.0.1:7890", "8.8.8.8", 5), expected)
            proxy.assert_called_once_with("127.0.0.1", 7890, timeout=5)
            proxy.return_value.set_tunnel.assert_called_once_with("8.8.8.8", 443, {"Proxy-Authorization": "Basic dGVzdDpwYXNzd29yZA=="})
            self.assertIsNone(proxy.return_value.sock)
        for url in ["https://127.0.0.1/", "file:///test", "http://127.0.0.1/path?target=elsewhere"]:
            with self.assertRaises(network.NetworkPolicyError):
                network.connect_upstream_proxy(url, "8.8.8.8", 5)

    def test_20_youtube_subtitle_scope_and_partial_size_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "caption.vtt"
            request = Mock(return_value=contextlib.nullcontext(Response(content=b"WEBVTT", length="6")))
            with patch.object(network, "request_url", request):
                network.download_media("https://www.youtube.com/api/timedtext", output, max_bytes=10, scope="youtube", timeout_seconds=20)
            self.assertEqual(output.read_bytes(), b"WEBVTT")
            request.assert_called_once_with("https://www.youtube.com/api/timedtext", "youtube")
            with patch.object(network, "request_url", return_value=contextlib.nullcontext(Response(content=b"toolarge"))):
                with self.assertRaises(network.NetworkPolicyError):
                    network.download_media("https://www.youtube.com/api/timedtext", output, max_bytes=5, scope="youtube")
            self.assertFalse(output.exists())
            request = Mock(return_value=contextlib.nullcontext(Response(302, "https://www.douyin.com/video/1")))
            with patch.object(network, "request_url", request), self.assertRaises(network.NetworkPolicyError):
                network.download_media("https://www.youtube.com/api/timedtext", output, scope="youtube")
            self.assertEqual(request.call_count, 1)

    def test_21_subtitle_deadline_checked_before_request(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(network.time, "monotonic", side_effect=[0, 21]), patch.object(network, "request_url") as request:
            with self.assertRaises(TimeoutError):
                network.download_media("https://www.youtube.com/api/timedtext", Path(directory) / "caption.vtt", scope="youtube", timeout_seconds=20)
            request.assert_not_called()

    def test_22_subtitle_cli_has_fixed_scope_byte_and_time_limits(self):
        with patch.object(sys, "argv", ["media_network.py", "subtitle", "https://www.youtube.com/api/timedtext", "caption.vtt"]), patch.object(network, "download_media") as download:
            self.assertEqual(network.main(), 0)
            download.assert_called_once_with("https://www.youtube.com/api/timedtext", "caption.vtt", max_bytes=4 * 1024 * 1024, scope="youtube", timeout_seconds=20)

    def test_23_referer_follows_platform_scope(self):
        for scope, url, referer in [("youtube", "https://www.youtube.com/api/timedtext", "https://www.youtube.com/"),
                                    ("douyin", "https://www.douyin.com/", "https://www.douyin.com/")]:
            with patch.object(network, "PublicHTTPSConnection") as create, network.request_url(url, scope):
                self.assertEqual(create.return_value.request.call_args.kwargs["headers"]["Referer"], referer)


if __name__ == "__main__":
    unittest.main()
