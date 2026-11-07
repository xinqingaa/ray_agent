"""公开网页的有界读取与正文整理。

每跳解析后固定连接到公开 IP，只允许 80/443 端口，不携带代理、Cookie 或认证；传输与解压后的字节、重定向次数和
总时长都有上限。正文按 HTML 主体转为 Markdown，不调用模型。

本机代理的 TUN fake-IP 模式把域名解析到基准测试保留段，此时经 DNS-over-HTTPS 核对真实地址全为公开地址后，
仍连接代理给出的地址，由代理按域名转发。
"""
import asyncio
import ipaddress
import socket
import zlib
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify

from app.domain.external.web_reader import WebPageReader
from app.domain.models.tool_result import ToolResult

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
CONNECT_TIMEOUT_SECONDS = 8
TOTAL_TIMEOUT_SECONDS = 15
CONTENT_CHARS = 6000
# 基准测试保留段不会出现在公网路由上，解析结果落在这里只可能是本机代理合成的地址。
FAKE_IP_NETWORKS = (ipaddress.ip_network('198.18.0.0/15'), ipaddress.ip_network('2001:2::/48'))
# 用 IP 字面量访问，核对本身不依赖本机 DNS；按顺序回退。
DOH_ENDPOINTS = ('https://223.5.5.5/resolve', 'https://1.12.12.12/resolve', 'https://1.1.1.1/dns-query')
DOH_TIMEOUT_SECONDS = 3


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return ip.is_global and getattr(ip, 'ipv4_mapped', None) is None


def is_fake_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return any(ip in network for network in FAKE_IP_NETWORKS)


def is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


async def resolve_via_doh(host: str) -> list[str]:
    async def query(client: httpx.AsyncClient, endpoint: str, record_type: str) -> list[str]:
        response = await client.get(endpoint, params={'name': host, 'type': record_type},
                                    headers={'Accept': 'application/dns-json'})
        response.raise_for_status()
        data = response.json()
        if data.get('Status') not in (0, 3):
            raise ValueError(f'DNS 状态 {data.get("Status")}')
        answers = [item['data'] for item in data.get('Answer') or [] if item.get('type') in (1, 28)]
        for answer in answers:
            ipaddress.ip_address(answer)
        return answers

    for endpoint in DOH_ENDPOINTS:
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=DOH_TIMEOUT_SECONDS, follow_redirects=False) as client:
                v4, v6 = await asyncio.gather(query(client, endpoint, 'A'), query(client, endpoint, 'AAAA'))
            return list(dict.fromkeys(v4 + v6))
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            continue
    raise ValueError('目标经本机代理解析，无法核对真实地址，已拒绝请求')


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
    proxied = (not is_ip_literal(host) and any(is_fake_ip(addr) for addr in addresses)
               and all(is_fake_ip(addr) or is_public(addr) for addr in addresses))
    if proxied:
        real = await resolve_via_doh(host)
        if not real or not all(is_public(addr) for addr in real):
            raise ValueError('目标解析到非公开地址，已拒绝请求')
    elif not addresses or not all(is_public(addr) for addr in addresses):
        raise ValueError('目标解析到非公开地址，已拒绝请求')
    return addresses[0], host, port


async def fetch_page(url: str) -> dict:
    async def fetch():
        current = url
        # 每跳使用独立 client，避免服务端设置的 Cookie 被带到下一跳。
        for hop in range(MAX_REDIRECTS + 1):
            address, host, port = await public_address(current)
            target = httpx.URL(current).copy_with(host=address)
            host_header = host if port in (80, 443) else f'{host}:{port}'
            async with httpx.AsyncClient(trust_env=False, timeout=CONNECT_TIMEOUT_SECONDS, follow_redirects=False) as client:
                async with client.stream('GET', target, headers={'Host': host_header, 'Accept-Encoding': 'identity',
                    'User-Agent': 'RayAgent/1.0 (public webpage reader)'}, extensions={'sni_hostname': host}) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        if hop == MAX_REDIRECTS or not response.headers.get('location'):
                            raise ValueError('重定向次数超限或缺少目标')
                        current = urljoin(current, response.headers['location'])
                        continue
                    mime = response.headers.get('content-type', '').split(';')[0].strip().lower()
                    if mime not in ('text/html', 'application/xhtml+xml', 'text/plain'):
                        raise ValueError(f'不支持的网页 MIME：{mime or "未声明"}')
                    encoding = response.headers.get('content-encoding', 'identity').lower()
                    if encoding not in ('identity', 'gzip', 'deflate'):
                        raise ValueError(f'不支持的压缩格式：{encoding}')
                    decoder = zlib.decompressobj(31 if encoding == 'gzip' else 15) if encoding != 'identity' else None
                    body = bytearray()
                    wire_bytes = 0
                    async for chunk in response.aiter_raw(chunk_size=65536):
                        wire_bytes += len(chunk)
                        if wire_bytes > MAX_BYTES:
                            raise ValueError('网页传输超过 2 MiB，请改用浏览器定向读取')
                        remaining = MAX_BYTES - len(body)
                        body.extend(decoder.decompress(chunk, remaining + 1) if decoder else chunk)
                        if len(body) > MAX_BYTES or (decoder and decoder.unconsumed_tail):
                            raise ValueError('网页解压后超过 2 MiB，请改用浏览器定向读取')
                    if decoder and not decoder.eof:
                        raise ValueError('网页压缩数据不完整')
                    text = bytes(body).decode(response.encoding or 'utf-8', errors='replace')
                    return dict(url=url, final_url=current, status=response.status_code, mime=mime,
                                fetched_at=datetime.now(timezone.utc).isoformat(), body=text, bytes=len(body))
        raise ValueError('重定向次数超限')
    return await asyncio.wait_for(fetch(), timeout=TOTAL_TIMEOUT_SECONDS)


def extract_webpage(result: ToolResult) -> ToolResult:
    """把抓取到的 HTML 或纯文本整理为有界正文；只处理已抓取内容，不发网络请求。"""
    if not result.success or not isinstance(result.data, dict):
        return result
    data = dict(result.data)
    body = data.pop('body', '')
    login = False
    if data.get('mime') != 'text/plain':
        soup = BeautifulSoup(body, 'html.parser')
        data['title'] = soup.title.get_text(' ', strip=True) if soup.title else ''
        login = soup.select_one('input[type="password"]') is not None
        for node in soup.select('script,style,noscript,template,svg,[hidden],[aria-hidden="true"]'):
            node.decompose()
        root = soup.select_one('main, article, [role="main"]') or soup.body or soup
        content = markdownify(str(root), heading_style='ATX').strip()
        data['method'] = 'html_root_markdown'
    else:
        content = body.strip()
        data['title'] = ''
        data['method'] = 'plain_text'
    requires = login or len(content) < 80 or data.get('status', 200) >= 400
    data.update(content=content[:CONTENT_CHARS], total_chars=len(content), truncated=len(content) > CONTENT_CHARS,
                requires_browser=requires)
    if requires:
        data['reason'] = '页面包含登录输入、正文较少或 HTTP 失败；必要时用浏览器确认，不要循环回退。'
    result = ToolResult(success=data.get('status', 200) < 400, data=data)
    if len(content) > CONTENT_CHARS:
        result.with_full_content(dict(data, content=content))
    return result


class PublicWebReader(WebPageReader):

    async def fetch_webpage(self, url: str) -> ToolResult:
        try:
            page = await fetch_page(url)
        except (ValueError, TimeoutError) as exc:
            return ToolResult(success=False, message=str(exc) or '网页读取超过总时限', data={'requires_browser': True})
        except Exception:
            return ToolResult(success=False, message='网页网络请求失败；可使用浏览器读取', data={'requires_browser': True})
        return extract_webpage(ToolResult(success=True, data=page))
