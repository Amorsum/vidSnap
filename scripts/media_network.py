"""媒体出站边界：域名白名单、全量 DNS 校验、连接固定 IP，以及有界短链跳转。

仅保护本项目显式配置的媒体客户端；不是操作系统级网络沙箱。
"""
import contextlib
import base64
import http.client
import http.server
import ipaddress
import os
import re
import select
import socket
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urljoin, urlsplit, unquote, parse_qs
from media_dns import MediaDnsError, resolve_doh


HOSTS = {
    "bilibili": ("bilibili.com", "b23.tv", "bilivideo.com", "bilivideo.cn", "bilivideo.net", "hdslb.com"),
    "youtube": ("youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "google.com", "ggpht.com", "gstatic.com", "googleusercontent.com"),
    "douyin": ("douyin.com", "iesdouyin.com", "amemv.com", "douyinvod.com", "douyinpic.com", "bytecdn.cn", "byteimg.com", "bytegoofy.com", "bytedance.com", "bytedance.net", "pstatp.com", "snssdk.com", "volccdn.com", "bytednsdoc.com", "ibytedtos.com"),
}
SHORT_HOSTS = {"v.douyin.com", "www.douyin.com", "douyin.com", "www.iesdouyin.com"}
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"


class NetworkPolicyError(ValueError):
    pass


class NonPublicDnsError(NetworkPolicyError):
    pass


def validate_url(url, scope):
    if not isinstance(url, str) or len(url) > 4096 or re.search(r"[\s\\\x00-\x1f\x7f]", url):
        raise NetworkPolicyError("拒绝不合法的媒体地址")
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        bili_media_port = (scope == "bilibili" and parts.port == 8082
                           and host.endswith(".mcdn.bilivideo.cn"))
        if parts.scheme != "https" or (parts.port not in (None, 443) and not bili_media_port) or parts.username is not None or parts.password is not None:
            raise ValueError()
        if not re.fullmatch(r"[a-z0-9.-]+", host) or host.endswith("."):
            raise ValueError()
        if not any(host == suffix or host.endswith("." + suffix) for suffix in HOSTS[scope]):
            raise ValueError()
    except (ValueError, KeyError):
        raise NetworkPolicyError("拒绝非白名单 HTTPS 媒体地址") from None
    return parts


def is_public_address(value):
    address = ipaddress.ip_address(value)
    if not address.is_global or address.is_multicast or address.is_reserved:
        return False
    if address.version == 4:
        return address not in ipaddress.ip_network("192.0.0.0/24") and address not in ipaddress.ip_network("192.88.99.0/24")
    # 不接受 mapped、NAT64、6to4、Teredo 等可嵌入其他目标地址的过渡网络。
    return (address in ipaddress.ip_network("2000::/3")
            and address not in ipaddress.ip_network("2002::/16")
            and address not in ipaddress.ip_network("2001::/23"))


def connect_upstream_proxy(proxy_url, target_ip, timeout, port=443):
    # 代理地址由运维配置；隧道目标仍为已校验 IP，不能把原主机名交给代理再次解析。
    parts = urlsplit(proxy_url)
    if parts.scheme != "http" or not parts.hostname or parts.path not in ("", "/") or parts.query or parts.fragment:
        raise NetworkPolicyError("上游代理必须是固定 HTTP 代理地址")
    headers = {}
    if parts.username is not None:
        credentials = unquote(parts.username) + ":" + unquote(parts.password or "")
        headers["Proxy-Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode("ascii")
    proxy = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)
    try:
        proxy.set_tunnel(target_ip, port, headers)
        proxy.connect()
        connection = proxy.sock
        proxy.sock = None
        return connection
    except BaseException:
        proxy.close()
        raise


def open_public_connection(host, scope, timeout=15, port=443):
    validate_url("https://" + host + ":" + str(port), scope)
    mode = os.environ.get("MEDIA_DNS_MODE", "system").strip().lower()
    if mode == "system":
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    elif mode == "doh":
        upstream = os.environ.get("MEDIA_UPSTREAM_PROXY")
        dial = (lambda address, budget: connect_upstream_proxy(upstream, address, budget)) if upstream else None
        addresses = resolve_doh(host, port, dial)
    else:
        raise NetworkPolicyError("不支持的 MEDIA_DNS_MODE 配置")
    if not addresses or any(not is_public_address(entry[4][0]) for entry in addresses):
        raise NonPublicDnsError("拒绝非公网 DNS 地址")
    # 连接刚刚校验过的 sockaddr，不能再次按主机名解析，避免 DNS 重绑定。
    last_error = None
    for family, kind, protocol, _, target in addresses:
        upstream_proxy = os.environ.get("MEDIA_UPSTREAM_PROXY")
        if upstream_proxy:
            try:
                return connect_upstream_proxy(upstream_proxy, target[0], timeout, port)
            except OSError as error:
                last_error = error
                continue
        connection = socket.socket(family, kind, protocol)
        try:
            connection.settimeout(timeout)
            connection.connect(target)
            return connection
        except OSError as error:
            connection.close()
            last_error = error
    raise OSError("媒体公网连接失败") from last_error


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, scope, timeout=15, port=443):
        super().__init__(host, port=port, timeout=timeout)
        self.scope = scope

    def connect(self):
        raw = open_public_connection(self.host, self.scope, self.timeout, self.port)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


@contextlib.contextmanager
def request_url(url, scope):
    parts = validate_url(url, scope)
    connection = PublicHTTPSConnection(parts.hostname, scope, port=parts.port or 443)
    try:
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        referer = {"youtube": "https://www.youtube.com/", "douyin": "https://www.douyin.com/", "bilibili": "https://www.bilibili.com/"}[scope]
        connection.request("GET", path, headers={"User-Agent": USER_AGENT, "Referer": referer})
        yield connection.getresponse()
    finally:
        connection.close()


def short_link_target(url):
    parts = validate_url(url, "douyin")
    if parts.hostname not in SHORT_HOSTS:
        raise NetworkPolicyError("短链接跳转目标不受支持")
    if parts.hostname == "v.douyin.com" and re.fullmatch(r"/[A-Za-z0-9_-]{1,128}/?", parts.path):
        return None
    match = re.fullmatch(r"/(?:share/)?video/(\d{1,32})/?", parts.path)
    if match and parts.hostname != "v.douyin.com":
        return "https://www.douyin.com/video/" + match.group(1)
    raise NetworkPolicyError("短链接跳转路径不受支持")


def resolve_douyin_url(url, max_redirects=5):
    visited = set()
    for hop in range(max_redirects + 1):
        canonical = short_link_target(url)
        if canonical:
            return canonical
        if url in visited:
            raise NetworkPolicyError("短链接存在循环跳转")
        visited.add(url)
        with request_url(url, "douyin") as response:
            if response.status not in (301, 302, 303, 307, 308):
                raise NetworkPolicyError("短链接未返回有效跳转")
            location = response.getheader("Location")
            if not location or hop == max_redirects:
                raise NetworkPolicyError("短链接跳转次数超限或缺少目标")
            url = urljoin(url, location)
            short_link_target(url)  # 下一跳发出任何请求前先验证。
    raise NetworkPolicyError("短链接跳转次数超限")


def download_media(url, output, max_bytes=512 * 1024 * 1024, *, scope="douyin", timeout_seconds=110):
    visited = set()
    deadline = time.monotonic() + timeout_seconds
    try:
        for hop in range(6):
            if time.monotonic() >= deadline:
                raise TimeoutError("媒体下载超时")
            validate_url(url, scope)
            if url in visited:
                raise NetworkPolicyError("媒体地址循环跳转")
            visited.add(url)
            with request_url(url, scope) as response:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader("Location")
                    if not location or hop == 5:
                        raise NetworkPolicyError("媒体跳转次数超限或缺少目标")
                    url = urljoin(url, location)
                    continue
                if response.status != 200:
                    raise OSError("媒体下载失败，HTTP " + str(response.status))
                length = response.getheader("Content-Length")
                if length and (not length.isdigit() or int(length) > max_bytes):
                    raise NetworkPolicyError("媒体文件超出大小限制")
                size = 0
                with open(output, "wb") as target:
                    while True:
                        if time.monotonic() >= deadline:
                            raise TimeoutError("媒体下载超时")
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > max_bytes:
                            raise NetworkPolicyError("媒体文件超出大小限制")
                        target.write(chunk)
                if size == 0 or (length and size != int(length)):
                    raise OSError("媒体文件为空或不完整")
                return
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(output)
        raise


class MediaProxyHandler(http.server.BaseHTTPRequestHandler):
    # CONNECT 后直接转发字节，禁用缓冲以免吞掉同一个 TCP 包内的 TLS 握手。
    rbufsize = 0

    def setup(self):
        self.request.settimeout(20)
        super().setup()

    def log_message(self, *_):
        pass  # 不输出带签名的媒体地址、Cookie 或请求头。

    def deny(self):
        # 浏览器取消后台请求时连接可能已经关闭，不将预期断连写成异常栈。
        with contextlib.suppress(OSError):
            self.send_error(403, "Media network policy rejected target")

    def do_CONNECT(self):
        connected = False
        try:
            parts = validate_url("https://" + self.path, self.server.scope)
            if parts.path or parts.query or parts.fragment:
                raise NetworkPolicyError("非法 CONNECT 目标")
            with open_public_connection(parts.hostname, self.server.scope, port=parts.port or 443) as upstream:
                self.send_response(200)
                self.end_headers()
                connected = True
                deadline = time.monotonic() + 240
                while time.monotonic() < deadline:
                    readable, _, _ = select.select([self.connection, upstream], [], [], 20)
                    if not readable:
                        return
                    for source in readable:
                        payload = source.recv(64 * 1024)
                        if not payload:
                            return
                        destination = upstream if source is self.connection else self.connection
                        destination.sendall(payload)
        except NonPublicDnsError:
            print("[media-network] Media DNS non-public answer", file=sys.stderr)
            if not connected:
                self.deny()
        except MediaDnsError:
            print("[media-network] Media DNS resolution failed", file=sys.stderr)
            if not connected:
                self.deny()
        except (OSError, ValueError):
            if not connected:
                self.deny()
        finally:
            self.close_connection = True

    def do_GET(self):
        self.deny()


class MediaProxyServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, scope):
        super().__init__(("127.0.0.1", 0), MediaProxyHandler)
        self.scope = scope
        self.slots = threading.BoundedSemaphore(32)
        self.connections = set()
        self.connections_lock = threading.Lock()

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        with self.connections_lock:
            self.connections.add(request)
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self.connections_lock:
                self.connections.discard(request)
            self.slots.release()

    def server_close(self):
        with self.connections_lock:
            for connection in self.connections:
                with contextlib.suppress(OSError):
                    connection.shutdown(socket.SHUT_RDWR)
                    connection.close()
        super().server_close()


@contextlib.contextmanager
def media_proxy(scope):
    with MediaProxyServer(scope) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield "http://127.0.0.1:" + str(server.server_port)
        finally:
            server.shutdown()
            thread.join()


def yt_dlp_command(args, proxy):
    return ["yt-dlp", "--ignore-config", "--no-plugin-dirs", "--proxy", proxy,
            "--socket-timeout", "20", "--downloader", "native", "--hls-prefer-native",
            "--compat-options", "no-direct-merge", "--fixup", "never",
            "--downloader-args", "ffmpeg_i:-protocol_whitelist file,pipe",
            "--postprocessor-args", "ffmpeg_i:-protocol_whitelist file,pipe", *args]


def chromium_network_options(proxy):
    return {
        "proxy": {"server": proxy, "bypass": "<-loopback>"},
        "args": ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                 "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
    }


def run_yt_dlp(args, timeout, scope="youtube"):
    with media_proxy(scope) as proxy:
        environment = {key: value for key, value in os.environ.items()
                       if key.lower() not in ("http_proxy", "https_proxy", "all_proxy", "no_proxy")}
        # 清空客户端绕过规则；所有媒体 URL，包括重定向与分片，走受控代理。
        environment.update({"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy, "ALL_PROXY": proxy, "NO_PROXY": ""})
        with subprocess.Popen(yt_dlp_command(args, proxy), env=environment) as child:
            try:
                return child.wait(timeout=timeout)
            except BaseException:
                child.kill()
                child.wait()
                raise


def bilibili_link_target(url):
    parts = validate_url(url, "bilibili")
    if parts.hostname == "b23.tv" and re.fullmatch(r"/[A-Za-z0-9]{1,32}/?", parts.path):
        return None
    if parts.hostname not in ("bilibili.com", "www.bilibili.com", "m.bilibili.com"):
        raise NetworkPolicyError("Bilibili 短链目标不受支持")
    match = re.fullmatch(r"/video/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,19})/?", parts.path)
    pages = parse_qs(parts.query, keep_blank_values=True).get("p", ["1"])
    if not match or len(pages) != 1 or not re.fullmatch(r"[1-9]\d{0,4}", pages[0]):
        raise NetworkPolicyError("Bilibili 视频或分 P 不受支持")
    return f"https://www.bilibili.com/video/{match.group(1)}?p={pages[0]}"


def resolve_bilibili_url(url, max_redirects=5):
    visited = set()
    for hop in range(max_redirects + 1):
        canonical = bilibili_link_target(url)
        if canonical:
            return canonical
        if url in visited:
            raise NetworkPolicyError("短链接存在循环跳转")
        visited.add(url)
        with request_url(url, "bilibili") as response:
            location = response.getheader("Location")
            if response.status not in (301, 302, 303, 307, 308) or not location or hop == max_redirects:
                raise NetworkPolicyError("Bilibili 短链接未返回有效跳转")
            url = urljoin(url, location)
            bilibili_link_target(url)
    raise NetworkPolicyError("短链接跳转次数超限")


def main():
    try:
        if sys.argv[1] == "resolve-bilibili":
            print(resolve_bilibili_url(sys.argv[2]))
            return 0
        if sys.argv[1] == "yt-dlp-bilibili":
            return run_yt_dlp(sys.argv[3:], int(sys.argv[2]), scope="bilibili")
        if sys.argv[1] == "yt-dlp":
            return run_yt_dlp(sys.argv[3:], int(sys.argv[2]))
        if sys.argv[1] == "download":
            download_media(sys.argv[2], sys.argv[3])
            return 0
        if sys.argv[1] in ("subtitle", "subtitle-bilibili"):
            scope = "bilibili" if sys.argv[1] == "subtitle-bilibili" else "youtube"
            download_media(sys.argv[2], sys.argv[3], max_bytes=4 * 1024 * 1024, scope=scope, timeout_seconds=20)
            return 0
        raise ValueError("不支持的媒体命令")
    except Exception as error:
        # 仅输出有限类型，不回显签名 URL 或子进程参数。
        print("[media-network] " + type(error).__name__ + ": 媒体网络访问失败或被安全策略拒绝", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
