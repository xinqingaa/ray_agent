# -*- mode: python ; coding: utf-8 -*-
# 冻结桌面核心为 onedir：dist/rayagent-core/ 下的入口与 _internal/ 依赖目录必须整体分发。
# 在 ray_agent/api 下执行：uv run --locked pyinstaller --noconfirm --clean rayagent-core.spec
import json
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

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

# 打包身份：协议／事件／schema 兼容范围写入冻结资源，与 resources/package_identity.json 对齐并由构建刷新。
from app.interfaces.schemas.core import PROTOCOL_VERSION  # noqa: E402
from app.interfaces.schemas.event import EVENT_VERSION  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from app.infrastructure.storage.sqlite import _alembic_config  # noqa: E402

_head = ScriptDirectory.from_config(_alembic_config(Path(workpath) / 'dummy.db')).get_current_head()
package_identity = {
    'product': 'RayAgent',
    'channel': 'internal-macos-arm64',
    'signing': 'ad-hoc',
    'notarized': False,
    'protocol_version': PROTOCOL_VERSION,
    'event_version': EVENT_VERSION,
    'schema': {
        'head_revision': _head,
        'compat': '本程序可读并升级至 head；旧二进制在 schema 超出其已知修订时拒绝打开（SchemaTooNew）；升级前副本在数据根 upgrades/',
    },
    'components_manifest': 'component_manifest.json',
    'licenses': 'THIRD_PARTY_NOTICES.md',
    'notes': '内部包：首次在未信任的 Mac 上打开需在系统设置中手动允许；不作为公开分发。',
}
identity_path = Path(workpath) / 'package_identity.json'
identity_path.write_text(json.dumps(package_identity, indent=2, ensure_ascii=False) + '\n')

# Alembic 在运行时按资源目录加载 env.py 与迁移脚本，它们以源码形式随包；
# 内置 skill 正文由 skill_service 按模块相对路径读取。可写数据都在启动参数指定的数据根中。
datas = [
    (str(manifest), '.'),
    (str(identity_path), 'resources'),
]
runtime_root = ROOT / 'build/tool-runtime-archives'
if not (runtime_root / 'manifest.json').is_file():
    raise RuntimeError('先运行 scripts/prepare_tool_runtimes.py 准备正常工具运行时')
datas.append((str(runtime_root), 'tool-runtime-archives'))
binaries = []
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

# P7／P9：语义索引、OCR、浏览器驱动的原生库与数据文件；collect_all 覆盖隐式导入、
# 动态库与包内资源（含指向 .dylibs 的符号链接展开）。组件本体仍按清单下载到数据根。
for package in (
    'onnxruntime',
    'tokenizers',
    'lancedb',
    'pyarrow',
    'pypdfium2',
    'rapidocr_onnxruntime',
    'cv2',
    'numpy',
    'playwright',
):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    except Exception as exc:  # noqa: BLE001 — 冻结时缺可选包只记入警告，不中断既有路径
        print(f'WARNING: collect_all({package!r}) failed: {exc}')
        continue
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

for base in ('alembic', 'app/builtin_skills', 'resources'):
    for path in sorted((ROOT / base).rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            datas.append((str(path), str(path.parent.relative_to(ROOT))))

a = Analysis(
    ['sidecar.py'],
    pathex=[str(ROOT)],
    binaries=binaries,
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
