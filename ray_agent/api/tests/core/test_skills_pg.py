"""真实 PostgreSQL 的 skill 并发、受理事务与引用释放。"""
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.application.services.skill_service import SkillService
from app.infrastructure.repositories.db_skill_repository import DBSkillRepository
from app.infrastructure.external.skills.storage import SkillStorage
from app.infrastructure.external.skills.github import GitHubSkills
from app.domain.models.message import SkillSelection
from app.domain.services.run_ledger import RunLedger
from app.domain.services.skill_packages import SkillError
from core.config import Settings
from tests.core.test_run_events_pg import fresh_schema, with_db, new_session, pytestmark
from tests.core.test_skills import install, source
from tests.support.loop_harness import MemoryNotifier
import pytest


def test_skill_publication_acceptance_and_reference_lifetime(tmp_path):
    async def scenario(uow_factory, engine):
        settings = Settings(_env_file=None, skill_storage_dir=str(tmp_path))
        s = SkillService(DBSkillRepository(uow_factory().session_factory), SkillStorage(tmp_path, settings), GitHubSkills(settings), settings)
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
                                       s.edit('example', installed['version'], source(body='二').decode()), return_exceptions=True)
        assert sum(isinstance(r, SkillError) for r in results) == 1
        assert (await s.load(run.id, 'example'))['text'] == loaded['text']
        async with uow_factory() as uow:
            stored = await uow.run.get(run.id)
        assert stored.config_snapshot['skills_frozen']
        # 删 skill 仍保留旧运行版本，删运行由外键释放引用。
        latest = await s.detail('example')
        # 无正文 DELETE 经过真实 HTTP 依赖及 PostgreSQL 受理锁。
        from fastapi import FastAPI, Depends
        from httpx import AsyncClient, ASGITransport
        from unittest.mock import patch
        from app.interfaces.endpoints.skill_routes import router
        from app.interfaces.data_admission import data_admission
        from app.interfaces.service_dependencies import get_skill_service
        app = FastAPI()
        app.include_router(router, prefix='/api', dependencies=[Depends(data_admission)])
        app.dependency_overrides[get_skill_service] = lambda: s
        with patch('app.interfaces.data_admission.get_session_factory', return_value=uow_factory().session_factory):
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                response = await client.delete('/api/skills/example', params={'expected_version': latest['version']},
                                               headers={'content-type': 'application/json'})
                assert response.status_code == 200
        assert (await s.load(run.id, 'example'))['version'] == installed['version']
        async with engine.begin() as conn:
            await conn.execute(text('DELETE FROM sessions WHERE id=:id'), {'id': session.id})
        assert await s.bindings(run.id) == []
        async with s.repository.transaction() as tx:
            assert installed['version'] not in await tx.references()
        # 数据清理保留全局内置 skill。
        assert (await s.list())[0]['builtin']
    with_db(scenario)


def test_stopped_run_cannot_commit_install_and_stale_selection_rolls_back(tmp_path):
    async def scenario(uow_factory, engine):
        from app.domain.models.run import RunStatus, RunReason
        import uuid
        settings = Settings(_env_file=None)
        s = SkillService(DBSkillRepository(uow_factory().session_factory), SkillStorage(tmp_path, settings), GitHubSkills(settings), settings)
        await s.initialize()
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        async def invalid(uow):
            await s.accept(uow, session.id, SkillSelection(id='missing', version='a' * 64))
        with pytest.raises(SkillError): await ledger.start(session.id, apply=invalid)
        async with uow_factory() as uow:
            assert await uow.run.get_active(session.id) is None
        run = await ledger.start(session.id)
        op = await s.create_import(uuid.uuid4().hex, kind='manual', text=source().decode(), owner=run.id)
        candidate = op['candidates'][0]
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED, RunReason.USER_STOP)
        with pytest.raises(SkillError): await s.publish(op['id'], '', candidate['version'], owner=run.id)
        assert not any(e['name'] == 'example' for e in await s.list())
        with pytest.raises(SkillError): await s.create_import(uuid.uuid4().hex, kind='manual', text=source().decode(), owner=run.id)
        await s.cancel_run(run.id)
        assert (await s.operation(op['id']))['stage'] == 'cancelled'
    with_db(scenario)
