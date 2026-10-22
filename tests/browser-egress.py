"""真实 Chrome 负向验证：不接触平台、登录态或模型；内网哨兵必须零访问。"""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import sys
import threading
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from media_network import media_proxy, chromium_network_options
from playwright.async_api import async_playwright, Error


class Sentinel(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self):
        Sentinel.hits += 1
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_):
        pass


class SentinelServer(ThreadingHTTPServer):
    accepted = 0

    def get_request(self):
        request = super().get_request()
        self.accepted += 1
        return request


async def main():
    with SentinelServer(("127.0.0.1", 0), Sentinel) as server, media_proxy("douyin") as proxy:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True, channel="chrome", **chromium_network_options(proxy))
                try:
                    page = await browser.new_page(ignore_https_errors=True, service_workers="block")
                    targets = [f"http://127.0.0.1:{server.server_port}/", f"https://127.0.0.1:{server.server_port}/",
                               "https://169.254.169.254/", "https://[::1]/", "https://www.douyin.com/"]
                    original_lookup = socket.getaddrinfo
                    def lookup(host, port, *args, **kwargs):
                        if host == "www.douyin.com":
                            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 443))]
                        return original_lookup(host, port, *args, **kwargs)
                    with patch.object(socket, "getaddrinfo", side_effect=lookup):
                        for target in targets:
                            try:
                                response = await page.goto(target, timeout=5000)
                                assert response and response.status == 403, "目标未被代理拒绝"
                            except Error as error:
                                assert "ERR_TUNNEL_CONNECTION_FAILED" in str(error) or "ERR_PROXY_CONNECTION_FAILED" in str(error), str(error)
                    assert Sentinel.hits == 0, "浏览器绕过代理访问了环回哨兵"
                    assert server.accepted == 0, "浏览器绕过代理建立了环回 TCP 连接"
                    print('{"browser":"Chrome","blocked_targets":5,"private_sentinel_connections":0,"platform_network_requests":0}')
                finally:
                    await browser.close()
        finally:
            server.shutdown()
            thread.join()


asyncio.run(main())
