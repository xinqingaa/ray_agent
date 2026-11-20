"""skills.sh 公共榜单与 CLI 搜索的有界读取。只消费目录元数据。"""
import asyncio
import json
import re
import time
from collections import OrderedDict
from html.parser import HTMLParser

import httpx

from app.domain.services.skill_packages import SkillError, market_identity

COUNT = re.compile(r'([0-9]+(?:\.[0-9]+)?)([KMB]?)', re.I)


def _description(value):
    return (' '.join(value.split())[:420] or None) if isinstance(value, str) else None


def _row(repository, slug, name, installs, count_label=None, description=None):
    return {'id': market_identity(repository, slug), 'repository': repository, 'slug': slug,
            'name': str(name).strip()[:128] or slug, 'installs': installs, 'count_label': count_label,
            'description': _description(description)}


class Description(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.value = None

    def handle_starttag(self, tag, attrs):
        if tag == 'meta' and self.value is None:
            fields = dict(attrs)
            if fields.get('name') == 'description' or fields.get('property') == 'og:description':
                self.value = _description(fields.get('content'))


class Leaderboard(HTMLParser):
    """只读取公开页面的可见条目链接、标题、排名与安装数。"""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = {}
        self.link = None
        self.field = None
        self.parts = []
        self.fields = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href') or ''
            self.link = href.split('/')[1:] if href.startswith('/') and href.count('/') == 3 else None
            self.fields = []
        if self.link and tag in ('h3', 'span'):
            self.field, self.parts = tag, []

    def handle_data(self, data):
        if self.field:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == self.field:
            self.fields.append((tag, ''.join(self.parts).strip()))
            self.field = None
        if tag != 'a' or not self.link:
            return
        owner, repo, slug = self.link
        self.link = self.field = None
        name = next((text for kind, text in self.fields if kind == 'h3'), None)
        numbers = [text.replace(',', '') for kind, text in self.fields if kind == 'span']
        if not name or len(numbers) < 2 or not numbers[0].isdigit():
            return
        count = COUNT.fullmatch(numbers[-1])
        if count:
            try:
                unit = {'': 1, 'K': 1000, 'M': 1000000, 'B': 1000000000}[count[2].upper()]
                self.rows[int(numbers[0])] = _row(f'{owner}/{repo}', slug, name, int(float(count[1]) * unit), numbers[-1])
            except (OverflowError, SkillError):
                return


def parse_leaderboard(html):
    parser = Leaderboard()
    parser.feed(html)
    if 1 not in parser.rows or len(parser.rows) < 2:
        raise SkillError('skills.sh 榜单格式暂时无法读取', 503)
    return list({row['id']: row for _, row in sorted(parser.rows.items())}.values())


def parse_search(raw):
    body = json.loads(raw)
    skills = body.get('skills') if isinstance(body, dict) else None
    if not isinstance(skills, list):
        raise SkillError('skills.sh 搜索结果格式暂时无法读取', 503)
    rows = {}
    for item in skills:
        if not isinstance(item, dict):
            continue
        repo = item.get('source')
        slug = item.get('skillId') or str(item.get('id', '')).rsplit('/', 1)[-1]
        count = item.get('installs')
        if not isinstance(count, int) or count < 0:
            continue
        try:
            row = _row(repo, slug, item.get('name') or slug, count, description=item.get('description'))
        except SkillError:
            continue
        rows[row['id']] = row
    return sorted(rows.values(), key=lambda row: (-row['installs'], row['id']))


class SkillMarket:
    def __init__(self, settings):
        self.settings = settings
        self.cache = OrderedDict()
        self.lock = asyncio.Lock()
        self.blocked_until = 0
        self.description_cache = OrderedDict()
        self.description_slots = asyncio.Semaphore(settings.skill_market_description_concurrency)

    async def _download(self, query):
        url = 'https://skills.sh/api/search' if query else 'https://www.skills.sh/'
        return await self._read(url, params={'q': query} if query else None)

    async def _read(self, url, *, params=None, head_only=False):
        async with asyncio.timeout(self.settings.skill_market_timeout_seconds):
            async with httpx.AsyncClient(follow_redirects=False, headers={'User-Agent': 'RayAgent-Skills'}) as client:
                async with client.stream('GET', url, params=params) as response:
                    if response.status_code == 429:
                        delay = response.headers.get('Retry-After', '')
                        self.blocked_until = time.monotonic() + (min(3600, int(delay)) if delay.isdecimal() and len(delay) < 8 else 60)
                        raise SkillError('skills.sh 暂时限流，请稍后重试', 503)
                    if response.status_code != 200:
                        raise SkillError(f'skills.sh 暂时不可用（HTTP {response.status_code}）', 503)
                    buffer = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(buffer) + len(chunk) > self.settings.skill_market_response_bytes:
                            raise SkillError('skills.sh 返回的目录超过读取上限', 503)
                        buffer.extend(chunk)
                        if head_only and b'</head>' in buffer:
                            break
                    return buffer.decode('utf-8')

    async def _market_description(self, key):
        repo, slug = key.rsplit('/', 1)
        canonical = market_identity(repo, slug)
        async with self.description_slots:
            cached = self.description_cache.get(canonical)
            if cached and time.monotonic() - cached[0] < self.settings.skill_market_cache_seconds:
                self.description_cache.move_to_end(canonical)
                return cached[1]
            if time.monotonic() < self.blocked_until:
                if cached:
                    return cached[1]
                raise SkillError('skills.sh 暂时限流，请稍后重试', 503)
            try:
                html = await self._read(f'https://www.skills.sh/{canonical}', head_only=True)
                parser = Description()
                parser.feed(html.split('</head>', 1)[0])
                summary = parser.value
            except (SkillError, httpx.HTTPError, TimeoutError, ValueError):
                if cached:
                    return cached[1]
                raise
            self.description_cache[canonical] = (time.monotonic(), summary)
            self.description_cache.move_to_end(canonical)
            while len(self.description_cache) > self.settings.skill_market_description_cache_entries:
                self.description_cache.popitem(last=False)
            return summary

    async def descriptions(self, ids: list[str]):
        known = {row['id']: row['description'] for _, rows in self.cache.values() for row in rows}
        requested = dict.fromkeys(item for item in ids if item in known)
        async def resolve(key):
            return known[key] or await self._market_description(key)

        async def outcome(key):
            try:
                return key, await resolve(key)
            except (SkillError, httpx.HTTPError, TimeoutError, ValueError):
                return None

        values = await asyncio.gather(*(outcome(key) for key in requested))
        return dict(found for found in values if found is not None)

    async def catalog(self, query, offset, limit):
        key = ' '.join(query.split()).casefold()
        async with self.lock:
            cached = self.cache.get(key)
            if cached:
                self.cache.move_to_end(key)
            stale = False
            if not cached or time.time() - cached[0] >= self.settings.skill_market_cache_seconds:
                try:
                    if time.monotonic() < self.blocked_until:
                        raise SkillError('skills.sh 暂时限流，请稍后重试', 503)
                    raw = await self._download(key)
                    rows = parse_search(raw) if key else parse_leaderboard(raw)
                    cached = self.cache[key] = (time.time(), rows)
                    if len(self.cache) > 32:
                        self.cache.popitem(last=False)
                except (SkillError, httpx.HTTPError, TimeoutError, ValueError) as exc:
                    if not cached:
                        if isinstance(exc, SkillError):
                            raise
                        raise SkillError('暂时无法连接 skills.sh，请重试', 503) from exc
                    stale = True
        updated, rows = cached
        return {'items': rows[offset:offset + limit], 'has_more': offset + limit < len(rows),
                'updated_at': int(updated), 'stale': stale}
