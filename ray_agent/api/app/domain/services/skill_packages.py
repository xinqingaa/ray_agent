"""skill 的纯校验：不访问网络，不执行包内容。"""
import hashlib
import io
import json
import re
import stat
import unicodedata
import zipfile
from pathlib import PurePosixPath

import yaml


class SkillError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def safe_path(value: str) -> str:
    value = unicodedata.normalize('NFC', value)
    parts = value.split('/')
    if (not value or value.startswith('/') or '\\' in value or len(parts) > 20 or len(value) > 4096
            or any(p in ('', '.', '..') or ':' in p or p.endswith((' ', '.'))
                   or any(ord(c) < 32 for c in p) or re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)', p)
                   for p in parts)):
        raise SkillError(f'非法包内路径：{value}')
    return str(PurePosixPath(value))


def parse_skill(raw: bytes, settings) -> dict:
    try:
        text = raw.decode('utf-8-sig')
        if len(text) > settings.skill_body_chars:
            raise ValueError('正文超过完整加载上限')
        match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)(.*)\Z', text, re.S)
        if not match:
            raise ValueError('需要 YAML frontmatter 和正文')
        if any(isinstance(token, (yaml.tokens.AliasToken, yaml.tokens.AnchorToken)) for token in yaml.scan(match[1])):
            raise ValueError('frontmatter 不支持 YAML 锚点和别名')
        metadata = yaml.safe_load(match[1])
        name, description = metadata['name'], metadata['description']
        if not isinstance(name, str) or not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', name):
            raise ValueError('名称须由小写字母、数字和连字符组成，以字母开头')
        if name in {'plan', 'compact', 'clear', 'help', 'upload', 'attach', 'project', 'plan-mode', 'compress'} or len(name) > settings.skill_name_chars:
            raise ValueError('名称过长或与内置命令冲突')
        if not isinstance(description, str) or not description.strip() or len(description) > settings.skill_description_chars:
            raise ValueError('描述为空或过长')
        if not match[2].strip() or len(text) > settings.skill_body_chars:
            raise ValueError('正文为空或超过完整加载上限')
        return {'name': name, 'description': description.strip(), 'text': text}
    except (UnicodeError, ValueError, TypeError, KeyError, RecursionError, yaml.YAMLError) as exc:
        raise SkillError(f'SKILL.md 格式错误：{exc}') from exc


def validate_files(files: dict[str, bytes], settings) -> dict[str, bytes]:
    if not files or len(files) > settings.skill_max_files:
        raise SkillError('包为空或文件数量超限')
    seen, result, total = set(), {}, 0
    for path, data in files.items():
        path = safe_path(path)
        key = path.casefold()
        if key in seen:
            raise SkillError(f'规范化后路径冲突：{path}')
        seen.add(key)
        if len(data) > settings.skill_file_bytes:
            raise SkillError(f'单文件大小超限：{path}')
        total += len(data)
        if total > settings.skill_package_bytes:
            raise SkillError('累计解压大小超限')
        result[path] = data
    for path in result:
        if any('/'.join(path.split('/')[:i]).casefold() in seen for i in range(1, len(path.split('/')))):
            raise SkillError(f'文件与目录路径冲突：{path}')
    return result


def unzip(raw: bytes, settings, *, github_archive=False, directory=None) -> dict[str, bytes]:
    if len(raw) > settings.skill_download_bytes:
        raise SkillError('压缩包大小超限')
    try:
        result, seen, declared = {}, set(), 0
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > settings.skill_max_files * 2:
                raise SkillError('压缩包条目数量超限')
            selected_prefixes = None
            if github_archive:
                paths = [safe_path(i.filename.rstrip('/')) for i in entries]
                wrapper = paths[0].split('/')[0] if paths else ''
                if not wrapper or any(p != wrapper and not p.startswith(wrapper + '/') for p in paths):
                    raise SkillError('GitHub 归档根目录异常')
                if directory is not None:
                    target = wrapper + ('/' + safe_path(directory) if directory else '')
                    selected_prefixes = [target + '/']
                elif wrapper + '/SKILL.md' in paths:
                    selected_prefixes = [wrapper + '/']
                else:
                    selected_prefixes = [p[:-len('SKILL.md')] for p in paths if p.endswith('/SKILL.md')]
                    if len(selected_prefixes) > settings.skill_max_candidates:
                        raise SkillError('候选数量超限，请提供具体 Skill 目录地址')
            for info in entries:
                path = safe_path(info.filename.rstrip('/'))
                if selected_prefixes is not None and not any(path.startswith(prefix) for prefix in selected_prefixes):
                    continue
                key = path.casefold()
                if key in seen:
                    raise SkillError(f'重复路径：{path}')
                seen.add(key)
                kind = stat.S_IFMT(info.external_attr >> 16)
                if kind not in (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG):
                    raise SkillError(f'不支持链接或特殊文件：{path}')
                if info.is_dir():
                    continue
                declared += info.file_size
                if info.flag_bits & 1 or info.file_size > settings.skill_file_bytes or declared > settings.skill_package_bytes:
                    raise SkillError('包加密或解压大小超限')
                with archive.open(info) as stream:
                    data = stream.read(settings.skill_file_bytes + 1)
                result[path] = data
        return validate_files(result, settings)
    except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise SkillError(f'ZIP 无法读取：{exc}') from exc


def candidates(files, settings, directory=None):
    roots = sorted(p[:-len('SKILL.md')].rstrip('/') for p in files if p.split('/')[-1] == 'SKILL.md')
    if directory is not None:
        roots = [directory] if f'{directory}/SKILL.md'.lstrip('/') in files else []
    elif 'SKILL.md' in files:
        roots = ['']
    # ZIP 包可有一个无意义的外层目录；不把该层作为来源路径丢弃。
    if not roots:
        raise SkillError('来源中没有 SKILL.md')
    if len(roots) > settings.skill_max_candidates:
        raise SkillError('候选数量超限，请提供具体 Skill 目录地址')
    result = []
    for root in roots:
        prefix = root + '/' if root else ''
        bundle = {p[len(prefix):]: d for p, d in files.items() if p.startswith(prefix)}
        parsed = parse_skill(bundle['SKILL.md'], settings)
        manifest = [{'path': p, 'size': len(d), 'sha256': hashlib.sha256(d).hexdigest()} for p, d in sorted(bundle.items())]
        digest = hashlib.sha256(json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        warnings = []
        if any(d.startswith(b'version https://git-lfs.github.com/spec/') for d in bundle.values()):
            warnings.append('包含 Git LFS 指针，未取得实际资源')
        if any(p.endswith('.gitmodules') for p in files):
            warnings.append('仓库包含子模块，未获取子模块资源')
        result.append({**parsed, 'path': root, 'version': digest, 'files': manifest, 'warnings': warnings})
    return result
