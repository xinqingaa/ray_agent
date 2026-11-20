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
        assert all(item['id'] != from_two['id'] for item in await s.list())
        await s.refresh_catalog(force=True)
        assert any(item['id'] == from_two['id'] for item in await s.list(refresh=False))
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


def test_codex_group_and_aliases_restore_original_settings(tmp_path, monkeypatch):
    from app.domain.services import skill_discovery

    async def run():
        home = tmp_path / 'home'
        workspace = tmp_path / 'workspace'
        monkeypatch.setattr(skill_discovery, 'user_home', lambda: home)
        monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex-home'))
        for i in range(10):
            write_skill(home / '.codex' / 'skills', f'codex-{i}')
        write_skill(tmp_path / 'codex-home' / 'skills', 'other-codex')
        private = write_skill(workspace / '.codex' / 'skills', 'private-codex')
        alias = workspace / '.cursor' / 'skills' / 'alias'
        alias.parent.mkdir(parents=True)
        alias.symlink_to(private, target_is_directory=True)
        config = SkillConfig()
        s = service(tmp_path / 'store')
        s._config_loader = lambda: config
        s._workspace_locator = lambda wid, **_: (str(workspace) if wid == 'a' else None, wid)
        before = {item['name']: item for item in await s.list(workspace_id='a')}
        await s.change(before['codex-0']['id'], before['codex-0']['version'], enabled=False)
        await s.change(before['codex-1']['id'], before['codex-1']['version'], included=True)
        config = config.model_copy(update={'disabled_groups': ['codex']})
        write_skill(home / '.codex' / 'skills', 'new-codex')
        off = {item['name']: item for item in await s.list(workspace_id='a')}
        assert all(not off[name]['enabled'] for name in ('codex-0', 'codex-1', 'other-codex'))
        assert 'new-codex' not in off
        assert off['private-codex']['enabled'] and off['private-codex']['source']['group'] == 'cursor'
        with pytest.raises(SkillError):
            await s.validate_selection(before['codex-1'])
        config = SkillConfig()
        after = {item['name']: item for item in await s.list(workspace_id='a')}
        assert not after['codex-0']['enabled']
        assert after['codex-1']['enabled'] and after['codex-1']['auto_bound']
        assert after['new-codex']['enabled'] and not after['new-codex']['included']
        assert all(item['name'] != 'private-codex' for item in await s.list())

    asyncio.run(run())


def test_scan_reuses_content_and_reports_invalid_updates(tmp_path):
    from unittest.mock import patch

    async def run():
        folder = tmp_path / 'extra'
        package = write_skill(folder, 'reusable')
        config = SkillConfig(discover_user=False, extra_dirs=[str(folder)])
        s = service(tmp_path / 'store')
        s._config_loader = lambda: config
        with patch.object(s.storage, 'write', wraps=s.storage.write) as write:
            entry, = await s.list()
            assert write.call_count == 1
            assert (await s.list())[0]['version'] == entry['version']
            assert write.call_count == 1
            (package / 'SKILL.md').write_text('invalid')
            invalid, = await s.list()
            assert not invalid['enabled'] and invalid['status'] == 'invalid'
            assert (await s.sources())['sources'][-1]['problems']
            (package / 'SKILL.md').write_bytes(source('reusable', '更新'))
            updated, = await s.list()
            assert updated['enabled'] and updated['version'] != entry['version']
            assert write.call_count == 2
        config = config.model_copy(update={'extra_dirs': []})
        assert await s.list() == []
        assert (package / 'SKILL.md').is_file()

    asyncio.run(run())


def test_same_name_preferences_are_scoped_per_workspace(tmp_path):
    async def run():
        folders = {scope: tmp_path / scope for scope in ('first', 'second')}
        for scope, folder in folders.items():
            write_skill(folder / '.rayagent' / 'skills', 'shared-example', scope)
        config = SkillConfig(discover_user=False, discover_workspace=False)
        s = service(tmp_path / 'store')
        s._config_loader = lambda: config
        s._workspace_locator = lambda wid, **_: (str(folders[wid]) if wid in folders else None, wid)
        cross_scope = await install(s, name='shared-example')
        workspace_skills = {}
        for scope in folders:
            skill = next(e for e in await s.list(workspace_id=scope) if e['external'])
            workspace_skills[scope] = skill
            await s.change(skill['id'], skill['version'], included=True, workspace_id=scope)
        config = config.model_copy(update={
            'preferred': {'shared-example': cross_scope['id']},
            'workspace_preferred': {'first': {'shared-example': workspace_skills['first']['id']}},
        })
        requests = {'first': workspace_skills['first']['id'], 'second': cross_scope['id'], None: cross_scope['id']}
        for scope, expected in requests.items():
            visible = await s.list(workspace_id=scope)
            preferred = next(e for e in visible if e['preferred'])
            assert preferred['id'] == expected and preferred['auto_bound']

    asyncio.run(run())
