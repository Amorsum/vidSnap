"""固定可信 DoH 解析器；不使用系统 DNS，不接受请求指定解析服务器。"""
import http.client
import ipaddress
import json
import re
import socket
import threading
import time
from urllib.parse import urlencode

DNS_HOST = "dns.alidns.com"
DNS_ADDRESSES = ("223.5.5.5", "223.6.6.6")
MAX_RESPONSE_BYTES = 64 * 1024
_cache = {}
_cache_lock = threading.Lock()


class MediaDnsError(OSError):
    pass


class DnsHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, address, dial):
        super().__init__(DNS_HOST, timeout=3)
        self.address = address
        self.dial = dial

    def connect(self):
        raw = self.dial(self.address, self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=DNS_HOST)
        except BaseException:
            raw.close()
            raise


def _query_json(host, record_type, dial):
    for address in DNS_ADDRESSES:
        connection = DnsHTTPSConnection(address, dial)
        try:
            connection.request("GET", "/resolve?" + urlencode({"name": host, "type": record_type}),
                               headers={"Accept": "application/dns-json"})
            response = connection.getresponse()
            if response.status != 200:
                raise MediaDnsError("加密 DNS 服务未返回成功响应")
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise MediaDnsError("加密 DNS 响应过大")
            return json.loads(body)
        except (OSError, ValueError, http.client.HTTPException):
            continue
        finally:
            connection.close()
    raise MediaDnsError("Media DNS resolution failed")


def _parse_answer(data, host, record_type):
    number = {"A": 1, "AAAA": 28}[record_type]
    if not isinstance(data, dict) or type(data.get("Status")) is not int or data["Status"] != 0:
        raise MediaDnsError("加密 DNS 查询失败")
    questions = data.get("Question")
    if isinstance(questions, list) and len(questions) == 1:
        question = questions[0]
    else:
        question = questions
    if not isinstance(question, dict):
        raise MediaDnsError("加密 DNS 问题不匹配")
    if str(question.get("name", "")).lower().rstrip(".") != host or question.get("type") != number:
        raise MediaDnsError("加密 DNS 问题不匹配")
    answers = data.get("Answer", [])
    if not isinstance(answers, list) or len(answers) > 128:
        raise MediaDnsError("加密 DNS 结果无效")
    addresses, ttl = [], 60
    for answer in answers:
        if not isinstance(answer, dict):
            raise MediaDnsError("加密 DNS 记录无效")
        value = answer.get("TTL")
        if type(value) is not int or value < 0:
            raise MediaDnsError("加密 DNS TTL 无效")
        ttl = min(ttl, value)
        if answer.get("type") != number:
            continue  # CNAME 的实际目标地址由同一次可信解析返回。
        if not isinstance(answer.get("data"), str):
            raise MediaDnsError("加密 DNS 地址无效")
        try:
            address = ipaddress.ip_address(answer.get("data"))
        except ValueError:
            raise MediaDnsError("加密 DNS 地址无效") from None
        if address.version != (4 if record_type == "A" else 6):
            raise MediaDnsError("加密 DNS 地址类型不匹配")
        addresses.append(str(address))
    return addresses, ttl


def resolve_doh(host, port, dial=None):
    if not isinstance(host, str) or not re.fullmatch(r"[a-z0-9.-]{1,253}", host):
        raise MediaDnsError("DNS 主机名无效")
    if dial is None:
        dial = lambda address, timeout: socket.create_connection((address, 443), timeout)
    with _cache_lock:
        cached = _cache.get(host)
        if cached and cached[0] > time.monotonic():
            values = cached[1]
        else:
            values = None
    if values is None:
        values, ttl = [], 60
        for record_type, family in [("A", socket.AF_INET), ("AAAA", socket.AF_INET6)]:
            addresses, answer_ttl = _parse_answer(_query_json(host, record_type, dial), host, record_type)
            ttl = min(ttl, answer_ttl)
            values.extend((family, address) for address in addresses)
        if not values:
            raise MediaDnsError("加密 DNS 未返回地址")
        with _cache_lock:
            now = time.monotonic()
            for key in list(_cache):
                if _cache[key][0] <= now:
                    del _cache[key]
            if len(_cache) >= 256:
                del _cache[next(iter(_cache))]
            if ttl > 0:
                _cache[host] = (now + ttl, tuple(values))
    return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "",
             (address, port) if family == socket.AF_INET else (address, port, 0, 0))
            for family, address in values]
