"""核心内的公开网页读取：拒绝非公开目标、每跳固定公开 IP 且不带 Cookie、传输与解压有界，失败给出浏览器提示。"""
import asyncio
import socket
import zlib
from unittest.mock import patch

import httpx
import pytest

from app.infrastructure.external.web import public_page
from app.infrastructure.external.web.public_page import MAX_BYTES, PublicWebReader, fetch_page, public_address


def test_rejects_private_destinations_and_url_credentials():
    async def scenario():
        for url in ('file:///etc/passwd', 'http://user:pass@example.org', 'http://127.0.0.1',
                    'http://[::1]', 'http://169.254.169.254', 'http://example.org:8080'):
            with pytest.raises(ValueError):
                await public_address(url)
    asyncio.run(scenario())


def test_redirects_revalidate_and_requests_pin_ip_without_cookies():
    async def scenario():
        seen = []

        async def handler(request):
            seen.append(request)
            return httpx.Response(302, headers={'location': 'http://127.0.0.1/private', 'set-cookie': 'secret=1'})
        client = httpx.AsyncClient

        def factory(**kwargs):
            return client(transport=httpx.MockTransport(handler), **kwargs)
        original = asyncio.get_running_loop().getaddrinfo

        async def resolve(host, port, **kwargs):
            if host == 'public.example':
                return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.215.14', port))]
            return await original(host, port, **kwargs)
        with patch.object(public_page.httpx, 'AsyncClient', factory), \
                patch.object(asyncio.get_running_loop(), 'getaddrinfo', resolve):
            with pytest.raises(ValueError, match='非公开'):
                await fetch_page('https://public.example/')
        assert len(seen) == 1 and seen[0].url.host == '93.184.215.14'
        assert seen[0].headers['host'] == 'public.example'
        assert seen[0].extensions['sni_hostname'] == 'public.example'
        assert 'cookie' not in seen[0].headers
    asyncio.run(scenario())


def test_stream_size_mime_and_compression_are_bounded():
    class RawStream(httpx.AsyncByteStream):
        def __init__(self, body):
            self.body = body

        async def __aiter__(self):
            yield self.body

    compressor = zlib.compressobj(wbits=31)
    bomb = compressor.compress(b'x' * (MAX_BYTES + 1)) + compressor.flush()
    cases = [(b'hello world', 'text/plain', 'identity', False), (b'x', 'application/pdf', 'identity', True),
             (b'x' * (MAX_BYTES + 1), 'text/plain', 'identity', True), (bomb, 'text/plain', 'gzip', True)]

    async def scenario():
        client = httpx.AsyncClient
        for body, mime, encoding, fails in cases:
            async def handler(request, body=body, mime=mime, encoding=encoding):
                return httpx.Response(200, headers={'content-type': mime, 'content-encoding': encoding},
                                      stream=RawStream(body))

            def factory(**kwargs):
                return client(transport=httpx.MockTransport(handler), **kwargs)

            async def address(url):
                return '93.184.215.14', 'public.example', 443
            with patch.object(public_page.httpx, 'AsyncClient', factory), \
                    patch.object(public_page, 'public_address', address):
                if fails:
                    with pytest.raises(ValueError):
                        await fetch_page('https://public.example')
                else:
                    assert (await fetch_page('https://public.example'))['body'] == 'hello world'
    asyncio.run(scenario())


def test_reader_extracts_text_and_maps_failures_to_browser_hint():
    async def scenario():
        async def page(url):
            return dict(url=url, final_url=url, status=200, mime='text/html', fetched_at='now', bytes=10,
                        body='<html><title>标题</title><main>' + '正文内容' * 40 + '</main></html>')
        with patch.object(public_page, 'fetch_page', page):
            result = await PublicWebReader().fetch_webpage('https://public.example')
        assert result.success and result.data['title'] == '标题' and '正文内容' in result.data['content']
        assert result.data['requires_browser'] is False and 'body' not in result.data

        async def refused(url):
            raise ValueError('目标解析到非公开地址，已拒绝请求')

        async def broken(url):
            raise httpx.ConnectError('down')
        with patch.object(public_page, 'fetch_page', refused):
            denied = await PublicWebReader().fetch_webpage('http://127.0.0.1')
        with patch.object(public_page, 'fetch_page', broken):
            failed = await PublicWebReader().fetch_webpage('https://public.example')
        assert not denied.success and '非公开' in denied.message and denied.data['requires_browser']
        assert not failed.success and failed.data['requires_browser']
    asyncio.run(scenario())
