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
    settings = Settings()
    return SkillService(DBSkillRepository(database), SkillStorage(tmp_path / "skills", settings),
                        GitHubSkills(settings), settings)


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
