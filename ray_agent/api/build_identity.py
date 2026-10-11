"""构建输入身份；只哈希显式产品输入，不读取运行配置或凭据。"""
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUTS = ('app', 'core', 'alembic', 'alembic.ini', 'requirements.txt', 'pyproject.toml', 'run.sh', 'Dockerfile', '.dockerignore', 'build_identity.py')


def fingerprint(root=ROOT):
    files = []
    for name in INPUTS:
        path = root / name
        files.extend(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else files.append(path)
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix in ('.pyc', '.pyo'):
            continue
        rel = path.relative_to(root).as_posix()
        digest.update(f'{rel}\0{hashlib.sha256(path.read_bytes()).hexdigest()}\n'.encode())
    return digest.hexdigest()


def read_manifest():
    try:
        return json.loads((ROOT / 'build-manifest.json').read_text())
    except (OSError, ValueError):
        return {'service': 'api', 'status': 'unknown'}


def manifest():
    revision, dirty = os.getenv('BUILD_REVISION') or None, os.getenv('BUILD_DIRTY') or None
    if revision is None:
        try:
            revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, stderr=subprocess.DEVNULL, text=True).strip()
            dirty = str(bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True))).lower()
        except (OSError, subprocess.CalledProcessError):
            pass
    return dict(service='api', algorithm='sha256-path-content-v1', fingerprint=fingerprint(),
                revision=revision, dirty={'true': True, 'false': False}.get(dirty),
                built_at=datetime.now(timezone.utc).isoformat())


if __name__ == '__main__':
    import sys
    data = json.dumps(manifest(), indent=2) + '\n'
    if '--write' in sys.argv:
        (ROOT / 'build-manifest.json').write_text(data)
    else:
        print(data, end='')
