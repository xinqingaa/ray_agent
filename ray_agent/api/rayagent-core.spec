# -*- mode: python ; coding: utf-8 -*-
# 冻结桌面核心为 onedir：dist/rayagent-core/ 下的入口与 _internal/ 依赖目录必须整体分发。
# 在 ray_agent/api 下执行：uv run --locked pyinstaller --noconfirm --clean rayagent-core.spec
import json
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH)
sys.path.insert(0, str(ROOT))
import build_identity  # noqa: E402
from core.workers import WORKERS  # noqa: E402


def source_modules(base):
    """按文件枚举模块：collect_submodules 不进入没有 __init__.py 的命名空间包。"""
    for path in sorted((ROOT / base).rglob('*.py')):
        if '__pycache__' not in path.parts:
            parts = path.relative_to(ROOT).with_suffix('').parts
            yield '.'.join(parts[:-1] if parts[-1] == '__init__' else parts)


manifest = Path(workpath) / 'build-manifest.json'
manifest.parent.mkdir(parents=True, exist_ok=True)
manifest.write_text(json.dumps(build_identity.manifest(), indent=2) + '\n')

# Alembic 在运行时按资源目录加载 env.py 与迁移脚本，它们以源码形式随包；
# 内置 skill 正文由 skill_service 按模块相对路径读取。可写数据都在启动参数指定的数据根中。
datas = [
    (str(manifest), '.'),
]
for base in ('alembic', 'app/builtin_skills'):
    for path in sorted((ROOT / base).rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            datas.append((str(path), str(path.parent.relative_to(ROOT))))

hiddenimports = [
    *source_modules('app'),
    *source_modules('core'),
    *WORKERS.values(),
    # 迁移脚本与 env.py 只在运行时导入，静态分析看不到它们的依赖。
    *collect_submodules('alembic', filter=lambda name: not name.startswith('alembic.testing')),
    *collect_submodules('watchfiles'),
    'sqlalchemy.dialects.sqlite.aiosqlite',
    'sqlalchemy.dialects.sqlite.pysqlite',
    'aiosqlite',
]

a = Analysis(
    ['sidecar.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', '_tkinter', 'pytest', '_pytest', 'IPython', 'PyInstaller'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='rayagent-core',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='rayagent-core',
)
