"""随包正常解释器以只读归档分发，首次执行时校验并原子展开到数据根。"""
from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid
from pathlib import Path

from app.infrastructure.external.execution.env import scrub_env
from core.paths import RESOURCE_ROOT, data_root


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def descriptor() -> tuple[Path, dict, str]:
    source = RESOURCE_ROOT / 'tool-runtime-archives'
    raw = (source / 'manifest.json').read_bytes()
    return source, json.loads(raw), hashlib.sha256(raw).hexdigest()


def runtime_bin_dirs() -> list[Path]:
    if not getattr(sys, 'frozen', False):
        root = RESOURCE_ROOT / 'build/tool-runtimes'
        return [path for name, exe in [('python', 'python3'), ('node', 'node')]
                if (path := root / name / 'bin').is_dir() and (path / exe).is_file()]
    source, spec, identity = descriptor()
    if not all((source / item['archive']).is_file() for item in spec['runtimes'].values()):
        return []
    root = data_root().runtimes / identity
    return [root / name / 'bin' for name in ('python', 'node')]


def install(source: Path, spec: dict, root: Path, identity: str) -> list[Path]:
    """只安装随包受信归档；重复／并发启动复用完整版本，半成品不会进入 PATH。"""
    root.mkdir(parents=True, exist_ok=True)
    target = root / identity
    def valid():
        try:
            return (target / '.ready').read_text() == identity and all(
                digest(target / name / path) == expected
                for name, item in spec['runtimes'].items() for path, expected in item['files'].items())
        except OSError:
            return False
    with (root / '.install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not valid():
            staging = Path(tempfile.mkdtemp(prefix='.prepare-', dir=root))
            try:
                for name, item in spec['runtimes'].items():
                    archive = source / item['archive']
                    if digest(archive) != item['sha256']:
                        raise RuntimeError(f'随包 {name} 归档校验失败，请重新安装应用')
                    with tarfile.open(archive) as bundle:
                        bundle.extractall(staging, filter='data')
                    for path, expected in item['files'].items():
                        if digest(staging / name / path) != expected:
                            raise RuntimeError(f'{name} 运行时文件校验失败')
                python_bin = staging / 'python/bin'
                for alias in ('python', 'python3'):
                    path = python_bin / alias
                    path.unlink(missing_ok=True)
                    path.symlink_to('python3.12')
                env = scrub_env(runtime_bin_dirs=[python_bin, staging / 'node/bin'])
                checks = [('python', ['-I', '-c', 'import sys,ssl,sqlite3,venv; print(sys.version.split()[0])']),
                          ('node', ['-e', 'console.log(process.versions.node)'])]
                for name, args in checks:
                    item = spec['runtimes'][name]
                    actual = subprocess.check_output([str(staging / name / item['executable']), *args],
                                                     env=env, text=True, timeout=30).strip()
                    if actual != item['version']:
                        raise RuntimeError(f'{name} 版本校验失败: {actual}')
                (staging / '.ready').write_text(identity)
                if target.exists():
                    # 不删除可能仍被旧进程使用的 inode；损坏版本退出 PATH 后留待数据根清理。
                    target.rename(root / ('.invalid-' + uuid.uuid4().hex))
                os.replace(staging, target)
            finally:
                shutil.rmtree(staging, ignore_errors=True)
    return [target / name / 'bin' for name in ('python', 'node')]


async def ensure_tool_runtimes() -> list[Path]:
    if not getattr(sys, 'frozen', False):
        return runtime_bin_dirs()
    source, spec, identity = descriptor()
    return await asyncio.to_thread(install, source, spec, data_root().runtimes, identity)
