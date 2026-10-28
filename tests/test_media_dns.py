"""媒体独立 DoH：无真实网络与密钥，保留全部公网/域名校验。"""
import copy
import os
from pathlib import Path
import socket
import ssl
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import media_dns as dns
import media_network as network

HOST = 'www.bilibili.com'

def answer(kind='A', data='8.8.8.8', ttl=30):
    number = 1 if kind == 'A' else 28
    return {'Status': 0, 'Question': {'name': HOST + '.', 'type': number},
            'Answer': [{'name': HOST, 'type': number, 'TTL': ttl, 'data': data}]}

def records(_host, kind, _dial):
    return answer(kind, '8.8.8.8' if kind == 'A' else '2606:4700:4700::1111')

class MediaDnsTests(unittest.TestCase):
    def setUp(self):
        dns._cache.clear()
        env = patch.dict(os.environ, {'MEDIA_DNS_MODE': 'doh', 'MEDIA_UPSTREAM_PROXY': ''})
        env.start()
        self.addCleanup(env.stop)

    def test_dual_stack_cache_respects_ttl_and_requested_port(self):
        now = [0]
        with patch.object(dns, '_query_json', side_effect=records) as query, patch.object(dns.time, 'monotonic', side_effect=lambda: now[0]):
            first = dns.resolve_doh(HOST, 443)
            self.assertEqual(query.call_count, 2)
            second = dns.resolve_doh(HOST, 8082)
            self.assertEqual(query.call_count, 2)
            self.assertEqual(first[0][4], ('8.8.8.8', 443))
            self.assertEqual(second[0][4], ('8.8.8.8', 8082))
            now[0] = 31
            dns.resolve_doh(HOST, 443)
            self.assertEqual(query.call_count, 4)

    def test_empty_aaaa_and_list_question_are_accepted(self):
        data = answer()
        data['Question'] = [data['Question']]
        self.assertEqual(dns._parse_answer(data, HOST, 'A')[0], ['8.8.8.8'])
        empty = answer('AAAA', '::1')
        empty['Answer'] = []
        self.assertEqual(dns._parse_answer(empty, HOST, 'AAAA')[0], [])

    def test_malformed_or_mismatched_responses_are_rejected(self):
        cases = [None, [], {'Status': 3}, {'Status': False}]
        for changed in [{'Question': {'name': 'evil.test', 'type': 1}}, {'Question': []},
                        {'Question': {'name': HOST, 'type': 28}}, {'Answer': 'invalid'},
                        {'Answer': [{'type': 1, 'TTL': -1, 'data': '8.8.8.8'}]},
                        {'Answer': [{'type': 1, 'TTL': 1, 'data': 'invalid'}]},
                        {'Answer': [{'type': 1, 'TTL': 1, 'data': '::1'}]},
                        {'Answer': [{'type': 1, 'TTL': 1, 'data': None}]}]:
            value = copy.deepcopy(answer()); value.update(changed); cases.append(value)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(dns.MediaDnsError):
                dns._parse_answer(value, HOST, 'A')

    def test_doh_connection_pins_bootstrap_and_verifies_hostname(self):
        raw = Mock()
        dial = Mock(return_value=raw)
        connection = dns.DnsHTTPSConnection('223.5.5.5', dial)
        self.assertEqual(connection._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(connection._context.check_hostname)
        with patch.object(connection._context, 'wrap_socket', return_value=Mock()) as tls:
            connection.connect()
            dial.assert_called_once_with('223.5.5.5', 3)
            tls.assert_called_once_with(raw, server_hostname='dns.alidns.com')

    def test_doh_http_does_not_follow_redirect_or_accept_large_json(self):
        for status, payload in [(302, b'{}'), (200, b'x' * (dns.MAX_RESPONSE_BYTES + 1)), (200, b'not-json')]:
            response = Mock(status=status)
            response.read.return_value = payload
            with patch.object(dns, 'DnsHTTPSConnection') as connection, self.assertRaises(dns.MediaDnsError):
                connection.return_value.getresponse.return_value = response
                dns._query_json(HOST, 'A', Mock())
            self.assertEqual(connection.call_count, 2)
            self.assertEqual(connection.return_value.close.call_count, 2)

    def test_doh_public_addresses_are_pinned_without_system_resolution(self):
        public = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('8.8.8.8', 443))]
        with patch.object(network, 'resolve_doh', return_value=public), patch.object(socket, 'getaddrinfo') as lookup, patch.object(socket, 'socket') as create:
            network.open_public_connection(HOST, 'bilibili')
            lookup.assert_not_called()
            create.return_value.connect.assert_called_once_with(('8.8.8.8', 443))

    def test_nonpublic_mixed_or_empty_answers_never_connect(self):
        for values in [[], ['127.0.0.1'], ['198.18.0.1'], ['8.8.8.8', '10.0.0.1']]:
            records = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (value, 443)) for value in values]
            with patch.object(network, 'resolve_doh', return_value=records), patch.object(socket, 'socket') as create:
                with self.assertRaises(network.NonPublicDnsError): network.open_public_connection(HOST, 'bilibili')
                create.assert_not_called()

    def test_denied_hosts_bad_mode_and_doh_failure_never_fallback(self):
        with patch.object(network, 'resolve_doh') as query:
            with self.assertRaises(network.NetworkPolicyError): network.open_public_connection('evil.test', 'bilibili')
            query.assert_not_called()
        with patch.dict(os.environ, {'MEDIA_DNS_MODE': 'unknown'}), patch.object(socket, 'getaddrinfo') as lookup:
            with self.assertRaises(network.NetworkPolicyError): network.open_public_connection(HOST, 'bilibili')
            lookup.assert_not_called()
        with patch.object(network, 'resolve_doh', side_effect=dns.MediaDnsError('failed')), patch.object(socket, 'getaddrinfo') as lookup:
            with self.assertRaises(dns.MediaDnsError): network.open_public_connection(HOST, 'bilibili')
            lookup.assert_not_called()

if __name__ == '__main__': unittest.main()
