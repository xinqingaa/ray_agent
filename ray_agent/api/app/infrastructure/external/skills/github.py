"""仅获取固定提交的 GitHub 公共仓库；不执行 git/CLI，不接受任意下载地址。"""
import asyncio
import re
from urllib.parse import urlsplit, unquote, quote
import httpx
from app.domain.services.skill_packages import SkillError, unzip


class GitHubSkills:
    def __init__(self, settings):
        self.settings = settings

    @staticmethod
    def parse(url):
        if not isinstance(url, str) or len(url) > 2048 or url.lstrip().startswith(('npx ', 'npm ', '$ ')):
            raise SkillError('请粘贴公开 GitHub 地址，或在设置上传 ZIP；本机命令安装不会同步到 RayAgent')
        u = urlsplit(url)
        parts = [unquote(p) for p in u.path.rstrip('/').split('/')[1:]]
        if (u.scheme != 'https' or u.netloc != 'github.com' or u.query or u.fragment or len(parts) < 2
                or any(not p or p in ('.', '..') or '\\' in p or '/' in p or any(ord(c) < 32 for c in p) for p in parts)
                or not re.fullmatch(r'[\w.-]+', parts[0]) or not re.fullmatch(r'[\w.-]+', parts[1])):
            raise SkillError('仅支持 https://github.com 的公开仓库、技能目录或 SKILL.md 地址')
        if len(parts) > 2 and (parts[2] not in ('tree', 'blob') or len(parts) < 4):
            raise SkillError('GitHub 地址格式不支持')
        return parts

    async def _get(self, client, url, *, binary=False):
        allowed = {'api.github.com', 'codeload.github.com'}
        for attempt in range(3):
            try:
                async with client.stream('GET', url) as response:
                    if urlsplit(str(response.url)).hostname not in allowed or response.is_redirect:
                        raise SkillError('GitHub 下载发生不支持的重定向')
                    if response.status_code == 404 or (response.status_code == 422 and '/commits/' in url):
                        raise SkillError('公开仓库、引用或提交不存在', 404)
                    if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                        await asyncio.sleep(0.3 * (attempt + 1))
                        continue
                    if response.status_code != 200:
                        raise SkillError(f'GitHub 获取失败（HTTP {response.status_code}），请稍后重试或上传 ZIP；仓库需公开且服务未限流')
                    chunks, total = [], 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > self.settings.skill_download_bytes:
                            raise SkillError('GitHub 下载大小超限，请上传较小的技能 ZIP')
                        chunks.append(chunk)
                    raw = b''.join(chunks)
                    if binary:
                        return raw
                    import json
                    return json.loads(raw)
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                if attempt == 2:
                    raise SkillError('GitHub 网络获取失败，请重试或上传 ZIP') from exc
                await asyncio.sleep(0.3 * (attempt + 1))
        raise SkillError('GitHub 获取失败')

    async def fetch(self, url):
        parts = self.parse(url)
        owner, repo = parts[:2]
        repo = repo.removesuffix('.git')
        api = f'https://api.github.com/repos/{owner}/{repo}'
        async with asyncio.timeout(self.settings.skill_fetch_seconds):
            async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False,
                                         headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'RayAgent-Skills'}) as client:
                directory = None
                if len(parts) == 2:
                    info = await self._get(client, api)
                    ref = info['default_branch']
                else:
                    rest = parts[3:]
                    ref = None
                    if re.fullmatch('[a-f0-9]{40}', rest[0]):
                        ref, directory = rest[0], '/'.join(rest[1:])
                    else:
                        # 最长可解析引用优先，支持引用中的斜杠；不存在不是下载重试。
                        for length in range(len(rest), 0, -1):
                            candidate = '/'.join(rest[:length])
                            try:
                                info = await self._get(client, api + '/commits/' + quote(candidate, safe=''))
                            except SkillError as exc:
                                if exc.status == 404:
                                    continue
                                raise
                            ref, directory = info['sha'], '/'.join(rest[length:])
                            break
                    if ref is None:
                        raise SkillError('无法解析 GitHub 引用与技能目录')
                    if parts[2] == 'blob':
                        if not directory.endswith('SKILL.md'):
                            raise SkillError('文件地址必须指向 SKILL.md')
                        directory = directory[:-len('SKILL.md')].rstrip('/')
                if re.fullmatch('[a-f0-9]{40}', ref):
                    sha = ref
                else:
                    info = await self._get(client, api + '/commits/' + quote(ref, safe=''))
                    sha = info['sha']
                if not re.fullmatch('[a-f0-9]{40}', sha):
                    raise SkillError('GitHub 返回无效提交')
                raw = await self._get(client, f'https://codeload.github.com/{owner}/{repo}/zip/{sha}', binary=True)
        files = unzip(raw, self.settings, github_archive=True, directory=directory)
        prefix = next(iter(files)).split('/')[0] + '/'
        if any(not p.startswith(prefix) for p in files):
            raise SkillError('GitHub 归档根目录异常')
        files = {p[len(prefix):]: d for p, d in files.items()}
        return files, directory, {'kind': 'github', 'url': url, 'repository': f'{owner}/{repo}', 'commit': sha}
