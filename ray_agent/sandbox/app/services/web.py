"""公开网页的有界读取。每跳解析后固定连接到公开 IP，不携带代理、Cookie 或认证。"""
import asyncio
import ipaddress
import socket
import zlib
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3


async def public_address(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise ValueError('只接受无认证信息的公开 HTTP(S) URL')
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == 'https' else 80)
    if port not in (80, 443):
        raise ValueError('公开网页读取只允许 80/443 端口')
    records = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses or any(not ipaddress.ip_address(addr).is_global or
                            getattr(ipaddress.ip_address(addr), 'ipv4_mapped', None) is not None for addr in addresses):
        raise ValueError('目标解析到非公开地址，已拒绝请求')
    return addresses[0], host, port


async def fetch_page(url: str) -> dict:
    async def fetch():
        current = url
        # 每跳使用独立 client，避免服务端设置的 Cookie 被带到下一跳。
        for hop in range(MAX_REDIRECTS + 1):
            address, host, port = await public_address(current)
            target = httpx.URL(current).copy_with(host=address)
            host_header = host if port in (80,443) else f'{host}:{port}'
            async with httpx.AsyncClient(trust_env=False, timeout=8, follow_redirects=False) as client:
                async with client.stream('GET', target, headers={'Host':host_header, 'Accept-Encoding':'identity',
                    'User-Agent':'RayAgent/1.0 (public webpage reader)'}, extensions={'sni_hostname':host}) as response:
                    if response.status_code in (301,302,303,307,308):
                        if hop == MAX_REDIRECTS or not response.headers.get('location'):
                            raise ValueError('重定向次数超限或缺少目标')
                        current = urljoin(current, response.headers['location'])
                        continue
                    mime = response.headers.get('content-type','').split(';')[0].strip().lower()
                    if mime not in ('text/html','application/xhtml+xml','text/plain'):
                        raise ValueError(f'不支持的网页 MIME：{mime or "未声明"}')
                    encoding = response.headers.get('content-encoding','identity').lower()
                    if encoding not in ('identity','gzip','deflate'):
                        raise ValueError(f'不支持的压缩格式：{encoding}')
                    decoder = zlib.decompressobj(31 if encoding == 'gzip' else 15) if encoding != 'identity' else None
                    body = bytearray()
                    wire_bytes = 0
                    async for chunk in response.aiter_raw(chunk_size=65536):
                        wire_bytes += len(chunk)
                        if wire_bytes > MAX_BYTES:
                            raise ValueError('网页传输超过 2 MiB，请改用浏览器定向读取')
                        remaining = MAX_BYTES-len(body)
                        body.extend(decoder.decompress(chunk, remaining+1) if decoder else chunk)
                        if len(body)>MAX_BYTES or (decoder and decoder.unconsumed_tail):
                            raise ValueError('网页解压后超过 2 MiB，请改用浏览器定向读取')
                    if decoder and not decoder.eof:
                        raise ValueError('网页压缩数据不完整')
                    text = bytes(body).decode(response.encoding or 'utf-8', errors='replace')
                    return dict(url=url, final_url=current, status=response.status_code, mime=mime,
                        fetched_at=datetime.now(timezone.utc).isoformat(), body=text, bytes=len(body))
        raise ValueError('重定向次数超限')
    return await asyncio.wait_for(fetch(), timeout=15)
