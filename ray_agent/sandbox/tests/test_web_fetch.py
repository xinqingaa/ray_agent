import asyncio
import socket
import unittest
import zlib
from unittest.mock import patch

import httpx
from app.services.web import public_address, fetch_page, MAX_BYTES


class FetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_private_destinations_and_url_credentials(self):
        for url in ('file:///etc/passwd','http://user:pass@example.org','http://127.0.0.1',
                    'http://[::1]','http://169.254.169.254','http://example.org:8080'):
            with self.assertRaises(ValueError):
                await public_address(url)

    async def test_redirects_revalidate_and_requests_pin_ip_without_cookies(self):
        seen=[]
        async def handler(request):
            seen.append(request)
            return httpx.Response(302, headers={'location':'http://127.0.0.1/private','set-cookie':'secret=1'})
        client = httpx.AsyncClient
        def factory(**kwargs):
            return client(transport=httpx.MockTransport(handler), **kwargs)
        original = asyncio.get_running_loop().getaddrinfo
        async def resolve(host, port, **kwargs):
            if host=='public.example':
                return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.215.14',port))]
            return await original(host,port,**kwargs)
        with patch('app.services.web.httpx.AsyncClient',factory), patch.object(asyncio.get_running_loop(),'getaddrinfo',resolve):
            with self.assertRaisesRegex(ValueError,'非公开'):
                await fetch_page('https://public.example/')
        self.assertEqual(len(seen),1)
        self.assertEqual(seen[0].url.host,'93.184.215.14')
        self.assertEqual(seen[0].headers['host'],'public.example')
        self.assertEqual(seen[0].extensions['sni_hostname'],'public.example')
        self.assertNotIn('cookie',seen[0].headers)

    async def test_stream_size_mime_and_compression_are_bounded(self):
        class RawStream(httpx.AsyncByteStream):
            def __init__(self,body): self.body=body
            async def __aiter__(self): yield self.body
        client=httpx.AsyncClient
        cases=[(b'hello world','text/plain','identity',False),
               (b'x','application/pdf','identity',True),
               (b'x'*(MAX_BYTES+1),'text/plain','identity',True)]
        compressor=zlib.compressobj(wbits=31)
        bomb=compressor.compress(b'x'*(MAX_BYTES+1))+compressor.flush()
        cases.append((bomb,'text/plain','gzip',True))
        for body,mime,encoding,fails in cases:
            async def handler(request):
                return httpx.Response(200,headers={'content-type':mime,'content-encoding':encoding},stream=RawStream(body))
            def factory(**kwargs): return client(transport=httpx.MockTransport(handler),**kwargs)
            async def address(url): return '93.184.215.14','public.example',443
            with patch('app.services.web.httpx.AsyncClient',factory),patch('app.services.web.public_address',address):
                if fails:
                    with self.assertRaises(ValueError): await fetch_page('https://public.example')
                else:
                    result=await fetch_page('https://public.example')
                    self.assertEqual(result['body'],'hello world')


if __name__=='__main__': unittest.main()
