"""准备随基础包分发的正常 CPython／Node，绝不从开发机 PATH 复制解释器。"""
from __future__ import annotations
import asyncio
import gzip
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))
from app.infrastructure.external.components.install_files import fetch_file, sha256_file  # noqa: E402


def _strip_bytecode(root: Path) -> None:
    """删除 site-packages 内无必要的 __pycache__ / .pyc，缩小分发体积并保持确定性打包。"""
    for pycache in list(root.rglob('__pycache__')):
        shutil.rmtree(pycache, ignore_errors=True)
    for ext in ('*.pyc', '*.pyo'):
        for compiled in root.rglob(ext):
            compiled.unlink(missing_ok=True)


def prepare():
    manifest = json.loads((API_ROOT / 'resources/tool_runtime_manifest.json').read_text())
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise RuntimeError('首个内部包工具运行时仅支持 macOS Apple Silicon')
    target = API_ROOT / 'build/tool-runtimes'
    target.mkdir(parents=True, exist_ok=True)
    cache = API_ROOT / 'build/runtime-downloads'
    cache.mkdir(parents=True, exist_ok=True)
    py = manifest['python']
    archive = cache / 'python.tar.gz'
    if not archive.is_file() or sha256_file(archive) != py['sha256']:
        asyncio.run(fetch_file(py['url'], archive, expected_sha256=py['sha256']))
    shutil.rmtree(target / 'python', ignore_errors=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(target, filter='data')
    # Node 是 Playwright 锁定包内的正常解释器，明确复制为工具运行时；不经其 driver CLI 执行用户脚本。
    import playwright
    package = Path(playwright.__file__).parent
    source = package / 'driver/node'
    if sha256_file(source) != manifest['node']['sha256']:
        raise RuntimeError('Node 来源哈希与工具运行时清单不符')
    node_bin = target / 'node/bin'
    node_bin.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, node_bin / 'node')
    shutil.copy2(package / 'driver/LICENSE', target / 'node/LICENSE')
    python_bin = target / 'python/bin'
    for alias in ('python', 'python3'):
        path = python_bin / alias
        path.unlink(missing_ok=True)
        path.symlink_to('python3.12')

    packages = list(py.get('packages') or [])
    if packages:
        uv_exe = shutil.which('uv')
        if not uv_exe:
            raise RuntimeError('未找到 uv，无法向独立 Python 工具运行时预装锁定办公库')
        install_env = {
            **os.environ,
            'UV_PYTHON': str(python_bin / 'python3'),
            'PYTHONNOUSERSITE': '1',
        }
        subprocess.check_call(
            [
                uv_exe, 'pip', 'install',
                '--python', str(python_bin / 'python3'),
                '--no-compile',
                '--only-binary=:all:',
                *packages,
            ],
            env=install_env,
        )
        _strip_bytecode(target / 'python/lib/python3.12/site-packages')

    controlled_env = {'PATH': '/usr/bin:/bin', 'HOME': str(target), 'PYTHONNOUSERSITE': '1'}
    verify_imports = ','.join(['sys', 'ssl', 'sqlite3', 'venv', *list(py.get('verify_imports') or [])])
    checks = [
        (python_bin / 'python3', ['-I', '-c', f'import {verify_imports}; print(sys.version.split()[0])'], py['version']),
        (node_bin / 'node', ['-e', 'console.log(process.versions.node)'], manifest['node']['version']),
    ]
    for executable, args, expected in checks:
        actual = subprocess.check_output([str(executable), *args], env=controlled_env, text=True).strip()
        if actual != expected:
            raise RuntimeError(f'工具运行时版本不符: {actual} != {expected}')
    (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    # 归档作为数据分发，避免 PyInstaller 把正常解释器当作核心动态库重写。
    packed = API_ROOT / 'build/tool-runtime-archives'
    packed.mkdir(parents=True, exist_ok=True)

    def normalized(info):
        info.mtime, info.uid, info.gid, info.uname, info.gname = 0, 0, 0, '', ''
        return info

    for name in ('python', 'node'):
        with (packed / f'{name}.tar.gz').open('wb') as output:
            with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as zipped:
                with tarfile.open(fileobj=zipped, mode='w') as bundle:
                    bundle.add(target / name, arcname=name, filter=normalized)

    descriptor = {'platform': manifest['platform'], 'runtimes': {}}
    for name, executable in [('python', 'bin/python3.12'), ('node', 'bin/node')]:
        archive_name = name + '.tar.gz'
        critical = [executable] + (['lib/libpython3.12.dylib'] if name == 'python' else [])
        entry = dict(
            version=manifest[name]['version'], archive=archive_name,
            sha256=sha256_file(packed / archive_name), executable=executable,
            files={path: sha256_file(target / name / path) for path in critical},
        )
        if name == 'python':
            if py.get('bundle_revision'):
                entry['bundle_revision'] = py['bundle_revision']
            if packages:
                entry['packages'] = packages
            if py.get('verify_imports'):
                entry['verify_imports'] = py['verify_imports']
        descriptor['runtimes'][name] = entry
    (packed / 'manifest.json').write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + '\n')
    print(f'工具运行时已校验: CPython {py["version"]} ({len(packages)} 个预装库) / Node {manifest["node"]["version"]}')


if __name__ == '__main__':
    prepare()
