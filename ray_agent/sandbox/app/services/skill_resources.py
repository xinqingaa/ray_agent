"""API 发布的 skill 材料；不执行包内容。"""
import base64
import hashlib
import os
import re
import shutil
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path('/home/ubuntu/.rayagent/skills')
MAX_FILES = 2000
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PACKAGE_BYTES = 50 * 1024 * 1024


def _safe_path(path):
    if isinstance(path, str):
        path = unicodedata.normalize('NFC', path)
    if (not isinstance(path, str) or not path or '\\' in path or path.startswith('/') or len(path.split('/')) > 20 or len(path) > 4096
            or any(p in ('', '.', '..') or re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)', p) or ':' in p or p.endswith((' ', '.')) or any(ord(c) < 32 for c in p) for p in path.split('/'))):
        raise ValueError('非法 Skill 资源路径')
    return path


def _check_ancestors(path):
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise ValueError('材料目标包含符号链接')


def prepare_resources(run_id, name, version, files, root=ROOT):
    if not re.fullmatch(r'[a-f0-9-]{32,36}', run_id) or not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', name) or not re.fullmatch('[a-f0-9]{64}', version):
        raise ValueError('无效运行、Skill 或版本身份')
    if not files or len(files) > MAX_FILES:
        raise ValueError('材料文件数量超限')
    parsed, seen, total = {}, set(), 0
    for item in files:
        path = _safe_path(item['path'])
        if path.casefold() in seen:
            raise ValueError('材料路径重复')
        seen.add(path.casefold())
        if len(item['content']) > (MAX_FILE_BYTES + 2) // 3 * 4:
            raise ValueError('材料单文件超限')
        raw = base64.b64decode(item['content'], validate=True)
        total += len(raw)
        if len(raw) > MAX_FILE_BYTES or total > MAX_PACKAGE_BYTES or len(raw) != item['size'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError('材料大小或哈希校验失败')
        parsed[path] = raw
    for path in parsed:
        if any('/'.join(path.split('/')[:i]).casefold() in seen for i in range(1, len(path.split('/')))):
            raise ValueError('材料文件与目录路径冲突')
    target = root / run_id / name / version
    _check_ancestors(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    _check_ancestors(target)

    def matches():
        if not target.is_dir():
            return False
        actual = {}
        for p in target.rglob('*'):
            if p.is_symlink() or not (p.is_dir() or p.is_file()):
                return False
            if p.is_file():
                if p.stat().st_size > MAX_FILE_BYTES:
                    return False
                actual[p.relative_to(target).as_posix()] = p.read_bytes()
        return actual == parsed

    if matches():
        return {'root': str(target), 'version': version, 'files': len(files), 'verified': True}
    tmp = Path(tempfile.mkdtemp(prefix='.prepare-', dir=target.parent))
    try:
        for path, data in parsed.items():
            dest = tmp / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            dest.chmod(0o755 if path.startswith('scripts/') else 0o644)
        _check_ancestors(target)
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        os.replace(tmp, target)
        if not matches():
            raise ValueError('发布后材料校验失败')
        return {'root': str(target), 'version': version, 'files': len(files), 'verified': True}
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
