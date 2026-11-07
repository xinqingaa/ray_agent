"""P8：外部目录发现、快照冻结、同名冲突与删除外部目录边界。"""
import asyncio
import shutil
from pathlib import Path

from app.application.services.skill_runtime import SkillRuntime
from app.domain.models.app_config import SkillConfig
from tests.core.test_skills import service, source


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
        assert external['external'] and external['version']
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
        assert all(e.get('conflict') for e in items)
        bound = await s.bind_run('run-conflict')
        assert not any(e['name'] == 'dup' for e in bound)

        preferred = config.model_copy(update={'preferred': {'dup': items[0]['id']}})
        s._config_loader = lambda: preferred
        bound = await s.bind_run('run-preferred')
        assert any(e['id'] == items[0]['id'] for e in bound)

        shutil.rmtree(one)
        await s.refresh_catalog()
        missing = next(e for e in await s.list(refresh=False) if e['id'] == items[0]['id'])
        assert missing['status'] == 'missing'
        await s.change(items[1]['id'], items[1]['version'], delete=True)
        assert (two / 'dup' / 'SKILL.md').is_file()
    asyncio.run(run())
