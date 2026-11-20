"""真实 SQLite 业务库上的 skill 并发编辑、受理事务冻结与引用释放。"""
import asyncio
import uuid

import pytest
from sqlalchemy import text

from app.application.services.skill_service import SkillService
from app.domain.models.message import SkillSelection
from app.domain.models.run import RunReason, RunStatus
from app.domain.services.run_ledger import RunLedger
from app.domain.services.skill_packages import SkillError
from app.infrastructure.external.skills.github import GitHubSkills
from app.infrastructure.external.skills.storage import SkillStorage
from app.infrastructure.repositories.db_skill_repository import DBSkillRepository
from core.config import Settings
from tests.core.test_skills import install, source
from tests.core.test_sqlite_storage import new_session
from tests.support.loop_harness import MemoryNotifier
from tests.support.sqlite_db import with_database


def skill_service(database, tmp_path):
    from app.domain.models.app_config import SkillConfig
    settings = Settings()
    return SkillService(
        DBSkillRepository(database), SkillStorage(tmp_path / "skills", settings),
        GitHubSkills(settings), settings,
        config_loader=lambda: SkillConfig(discover_user=False, discover_workspace=False),
    )


def test_skill_publication_acceptance_and_reference_lifetime(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        s = skill_service(database, tmp_path)
        await s.initialize()
        installed = await install(s)
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())

        async def freeze(uow):
            await s.accept(uow, session.id, SkillSelection(id='example', version=installed['version']))
        run = await ledger.start(session.id, apply=freeze)
        assert len(await s.bindings(run.id)) == 2
        loaded = await s.load(run.id, 'example')
        # 两个客户端同时编辑旧版本，恰好一个成功。
        results = await asyncio.gather(s.edit('example', installed['version'], source(body='一').decode()),
                                       s.edit('example', installed['version'], source(body='二').decode()),
                                       return_exceptions=True)
        assert sum(isinstance(r, SkillError) for r in results) == 1
        assert (await s.load(run.id, 'example'))['text'] == loaded['text']
        async with read_factory() as uow:
            assert (await uow.run.get(run.id)).config_snapshot['skills_frozen']
        latest = await s.detail('example')
        await s.change('example', latest['version'], delete=True)
        assert (await s.load(run.id, 'example'))['version'] == installed['version']
        async with uow_factory() as uow:
            await uow.db_session.execute(text('DELETE FROM sessions WHERE id = :id'), {'id': session.id})
        assert await s.bindings(run.id) == []
        async with s.repository.transaction() as tx:
            assert installed['version'] not in await tx.references()
        assert (await s.list())[0]['builtin']
    with_database(tmp_path, scenario)


def test_stopped_run_cannot_commit_install_and_stale_selection_rolls_back(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        s = skill_service(database, tmp_path)
        await s.initialize()
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())

        async def invalid(uow):
            await s.accept(uow, session.id, SkillSelection(id='missing', version='a' * 64))
        with pytest.raises(SkillError):
            await ledger.start(session.id, apply=invalid)
        async with read_factory() as uow:
            assert await uow.run.get_active(session.id) is None
        run = await ledger.start(session.id)
        op = await s.create_import(uuid.uuid4().hex, kind='manual', text=source().decode(), owner=run.id)
        candidate = op['candidates'][0]
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED, RunReason.USER_STOP)
        with pytest.raises(SkillError):
            await s.publish(op['id'], '', candidate['version'], owner=run.id)
        assert not any(e['name'] == 'example' for e in await s.list())
        with pytest.raises(SkillError):
            await s.create_import(uuid.uuid4().hex, kind='manual', text=source().decode(), owner=run.id)
        await s.cancel_run(run.id)
        assert (await s.operation(op['id']))['stage'] == 'cancelled'
    with_database(tmp_path, scenario)


def test_workspace_selection_is_scoped_and_waiting_retains_exact_snapshot(tmp_path):
    from app.application.services.skill_runtime import SkillRuntime
    from app.domain.models.app_config import SkillConfig
    from app.domain.models.session import Session
    from tests.core.test_skill_multi_source import write_skill

    async def scenario(uow_factory, read_factory, database):
        a, b = tmp_path / 'a', tmp_path / 'b'
        b.mkdir()
        package = write_skill(a / '.rayagent' / 'skills', 'shared-name', '私有版本')
        s = skill_service(database, tmp_path)
        s._workspace_locator = lambda wid, **_: ({'a': str(a), 'b': str(b)}.get(wid), wid)
        await s.initialize()
        global_entry = await install(s, name='shared-name')
        chosen = next(item for item in await s.list(workspace_id='a') if item['external'])
        selection = SkillSelection(id=chosen['id'], version=chosen['version'])
        assert all(item['id'] != chosen['id'] for item in await s.list(workspace_id='b'))
        for scope in (None, 'b'):
            with pytest.raises(SkillError):
                await s.detail(chosen['id'], workspace_id=scope)
        ledger = RunLedger(uow_factory, MemoryNotifier())

        async def create(scope):
            session = Session(id=f'fixture-{scope}', workspace_id=scope)
            async with uow_factory() as uow:
                await uow.session.save(session)
            return session

        async def start(session):
            async def accept(uow):
                await s.accept(uow, session.id, selection)
            return await ledger.start(session.id, apply=accept)

        for scope in (None, 'b'):
            session = await create(scope)
            with pytest.raises(SkillError):
                await start(session)
            async with read_factory() as uow:
                assert await uow.run.get_active(session.id) is None

        session = await create('a')
        running = await start(session)
        runtime = SkillRuntime(s, running.id, workspace_id='a')
        await runtime.initialize(frozen=True)
        assert global_entry['id'] not in {entry['id'] for entry in runtime.entries}
        assert (await runtime.load('shared-name')).data['version'] == chosen['version']
        assert (await runtime.prepare(chosen['id'])).success

        await ledger.transition(session.id, running.id, RunStatus.WAITING, RunReason.APPROVAL)
        restarted = skill_service(database, tmp_path)
        restarted._config_loader = lambda: SkillConfig(discover_user=False, disabled_groups=['rayagent'])
        (package / 'SKILL.md').write_bytes(source('shared-name', '外部变化'))
        await restarted.initialize()
        rebound = SkillRuntime(restarted, running.id, workspace_id='a')
        await rebound.initialize(frozen=True)
        snapshot = await rebound.resource(chosen['id'], 'references/note.md', 1, None)
        assert snapshot.success and snapshot.data['text'] == '参考'
        assert (await rebound.load(chosen['id'])).data['version'] == chosen['version']
        detail = await restarted.detail(chosen['id'], workspace_id='a', run_id=running.id)
        assert '私有版本' in detail['text']
        with pytest.raises(SkillError):
            await restarted.detail(chosen['id'], workspace_id='b', run_id=running.id)
        assert not (await SkillRuntime(restarted, running.id, workspace_id='b').load(chosen['id'])).success
        (restarted.snapshot_root(chosen['version']) / 'references/note.md').write_text('损坏')
        assert not (await rebound.prepare(chosen['id'])).success

    with_database(tmp_path, scenario)
