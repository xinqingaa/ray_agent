"""普通解释器归档发布：校验失败不暴露半成品，真实固定 Python 独立加载自己的库。"""
import json
import os
import subprocess

import pytest

from app.infrastructure.external.execution.env import scrub_env
from app.infrastructure.external.execution.tool_runtimes import digest, install
from core.paths import RESOURCE_ROOT


@pytest.mark.skipif(os.getenv('RAY_TEST_TOOL_RUNTIMES') != '1', reason='显式启用准备过的真实工具运行时')
def test_real_archives_publish_independent_python_and_recover_corruption(tmp_path):
    source = RESOURCE_ROOT / 'build/tool-runtime-archives'
    spec = json.loads((source / 'manifest.json').read_text())
    identity = 'test-fixed-runtime'
    bins = install(source, spec, tmp_path, identity)
    env = scrub_env(runtime_bin_dirs=bins)
    version = subprocess.check_output([str(bins[0] / 'python3'), '-I', '-c',
        'import sys,ssl,sqlite3,venv; print(sys.version.split()[0]); print(6*7)'], text=True, env=env)
    assert version.splitlines() == ['3.12.12', '42']
    loaded = subprocess.run([str(bins[0] / 'python3'), '-c', 'print(42)'],
                            env={**env, 'DYLD_PRINT_LIBRARIES': '1'}, text=True, capture_output=True, check=True)
    libraries = [line for line in loaded.stderr.splitlines() if 'libpython3.12.dylib' in line]
    assert libraries and all(str(tmp_path / identity / 'python/lib') in line for line in libraries)
    assert subprocess.check_output([str(bins[1] / 'node'), '-e', 'console.log(process.versions.node)'],
                                   text=True, env=env).strip() == '22.20.0'
    # 损坏当前解释器后重新验证归档并原子替换，旧损坏版本退出 PATH。
    (bins[0] / 'python3.12').write_bytes(b'corrupted')
    assert install(source, spec, tmp_path, identity) == bins
    assert digest(bins[0] / 'python3.12') == spec['runtimes']['python']['files']['bin/python3.12']
    assert not list(tmp_path.glob('.prepare-*'))


def test_corrupt_archive_never_publishes_runtime(tmp_path):
    source = tmp_path / 'source'
    source.mkdir()
    (source / 'bad.tar.gz').write_bytes(b'incomplete')
    spec = {'runtimes': {'python': {'archive': 'bad.tar.gz', 'sha256': '0' * 64}}}
    with pytest.raises(RuntimeError, match='归档校验失败'):
        install(source, spec, tmp_path / 'data', 'target')
    assert not (tmp_path / 'data/target').exists()
    assert not list((tmp_path / 'data').glob('.prepare-*'))
