"""P8：外部目录发现、快照冻结、同名冲突与删除外部目录边界。"""
import asyncio
import shutil
from pathlib import Path

import pytest

from app.application.services.skill_runtime import SkillRuntime
from app.domain.models.app_config import SkillConfig
from app.domain.services.skill_context import catalog_message
from app.domain.services.skill_packages import SkillError
from tests.core.test_skills import install, service, source


def write_skill(root: Path, name: str, body: str = '方法正文') -> Path:
    package = root / name
    package.mkdir(parents=True)
    (package / 'SKILL.md').write_bytes(source(name, body))
    (package / 'references').mkdir()
    (package / 'references' / 'note.md').write_text('参考', encoding='utf-8')
    return package


def test_external_discover_snapshot_and_freeze(tmp_path):
    async def run():
        extra = tmp_path / 'extra-skills'
        write_skill(extra, 'pack-one', '第一版')
        config = SkillConfig(discover_user=False, discover_workspace=False, extra_dirs=[str(extra)])
        s = service(tmp_path / 'store')
        s._config_loader = lambda: config
        await s.initialize()
        items = await s.list()
        external = next(e for e in items if e['name'] == 'pack-one')
        assert external['external'] and external['version'] and external['included'] is False
        await s.change(external['id'], external['version'], included=True)
        first_version = external['version']
        root = Path(external['root_path'])
        assert (root / 'SKILL.md').is_file()

        await s.bind_run('run-a')
        loaded = await s.load('run-a', 'pack-one')
        assert '第一版' in loaded['text']
        assert loaded['version'] == first_version

        (extra / 'pack-one' / 'SKILL.md').write_bytes(source('pack-one', '第二版'))
        await s.refresh_catalog()
        latest = next(e for e in await s.list(refresh=False) if e['name'] == 'pack-one')
        assert latest['version'] != first_version
        assert (await s.load('run-a', 'pack-one'))['version'] == first_version
        assert '第一版' in (await s.load('run-a', 'pack-one'))['text']

        await s.bind_run('run-b')
        assert '第二版' in (await s.load('run-b', 'pack-one'))['text']

        runtime = SkillRuntime(s, 'run-a')
        await runtime.initialize(frozen=True)
        await runtime.load('pack-one')
        prepared = await runtime.prepare('pack-one')
        assert prepared.success and prepared.data['root_path'] == str(root)
    asyncio.run(run())


def test_same_name_conflict_and_missing_external(tmp_path):
    async def run():
        one = tmp_path / 'a'
        two = tmp_path / 'b'
        write_skill(one, 'dup', '来自 A')
        write_skill(two, 'dup', '来自 B')
        config = SkillConfig(discover_user=False, discover_workspace=False,
                             extra_dirs=[str(one), str(two)])
        s = service(tmp_path / 'store')
        s._config_loader = lambda: config
        await s.initialize()
        items = [e for e in await s.list() if e['name'] == 'dup']
        assert len(items) == 2
        assert all(e.get('conflict') and e['included'] is False for e in items)
        for item in items:
            await s.change(item['id'], item['version'], included=True)
        bound = await s.bind_run('run-conflict')
        assert not any(e['name'] == 'dup' for e in bound)

        from_one = next(e for e in items if Path(e['source']['path']).is_relative_to(one))
        from_two = next(e for e in items if Path(e['source']['path']).is_relative_to(two))
        preferred = config.model_copy(update={'preferred': {'dup': from_one['id']}})
        s._config_loader = lambda: preferred
        bound = await s.bind_run('run-preferred')
        assert any(e['id'] == from_one['id'] for e in bound)

        # 列表顺序不保证；删掉 one 后，只应让来自 one 的条目变 missing
        shutil.rmtree(one)
        await s.refresh_catalog()
        missing = next(e for e in await s.list(refresh=False) if e['id'] == from_one['id'])
        assert missing['status'] == 'missing'
        still = next(e for e in await s.list(refresh=False) if e['id'] == from_two['id'])
        assert still['status'] == 'available'
        await s.change(from_two['id'], from_two['version'], delete=True)
        assert (two / 'dup' / 'SKILL.md').is_file()
    asyncio.run(run())


def test_catalog_index_hides_identity_and_truncates_description():
    content = catalog_message('', [{
        'id': 'ext-user-abc', 'name': 'pack', 'version': 'f' * 64,
        'description': '甲' * 200, 'source': {'kind': 'user'},
    }], 160)['content']
    assert 'ext-user-abc' not in content and 'f' * 64 not in content
    assert 'description_truncated' in content
    assert '甲' * 160 in content and '甲' * 161 not in content


def test_discovery_registers_without_joining_or_failing_budget(tmp_path):
    async def run():
        extra = tmp_path / 'extra'
        for name in ('alpha', 'beta', 'gamma'):
            write_skill(extra, name)
        config = SkillConfig(discover_user=False, discover_workspace=False, extra_dirs=[str(extra)])
        s = service(tmp_path / 'store', skill_catalog_chars=1)
        s._config_loader = lambda: config
        await s.initialize()
        items = await s.list()
        external = [e for e in items if e['external']]
        assert len(external) == 3 and all(e['included'] is False for e in external)
        assert {e['name'] for e in await s.bind_run('run')} == {'find-skills'}
    asyncio.run(run())


def test_include_rejects_only_that_skill_when_catalog_is_full(tmp_path):
    async def run():
        s = service(tmp_path / 'store')
        first = await install(s, name='alpha')
        assert first['included'] is True
        s.settings.skill_catalog_chars = len(catalog_message('', [first], s.settings.skill_catalog_description_chars)['content'])
        second = await install(s, name='beta')
        assert second['included'] is False and (await s.list(refresh=False))
        with pytest.raises(SkillError):
            await s.change(second['id'], second['version'], included=True)
        assert next(e for e in await s.list(refresh=False) if e['name'] == 'alpha')['included'] is True
    asyncio.run(run())


def test_overfull_catalog_still_starts_with_builtin_and_selection(tmp_path):
    async def run():
        s = service(tmp_path / 'store')
        await s.initialize()
        await install(s, name='alpha')
        picked = await install(s, name='picked')
        await s.change(picked['id'], picked['version'], included=False)
        entries = await s.list(refresh=False)
        config = SkillConfig(discover_user=False, discover_workspace=False)
        s.settings.skill_catalog_chars = 1
        bound = s._freeze_bound(entries, config, None, next(e for e in entries if e['name'] == 'picked'))
        assert {e['name'] for e in bound} == {'find-skills', 'picked'}
        listed = await s.list(refresh=False)
        assert next(e for e in listed if e['name'] == 'alpha')['catalog_overflow'] is True
    asyncio.run(run())
