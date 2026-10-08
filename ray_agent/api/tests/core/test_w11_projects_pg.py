"""托管项目真实数据库：迁移、准入并发、归属固定、分页与 API 契约。"""
import asyncio
import os
from pathlib import Path
import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from app.application.services.project_service import ProjectService
from app.domain.models.run import RunStatus
from app.domain.services.project_transactions import ProjectRunConflict
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.project.local_project_files import LocalProjectFiles
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
pytestmark=pytest.mark.skipif(not PG_URI,reason="需要独立临时 PostgreSQL")

def projects(factory, root):
    storage=ManagedProjectStorage(str(root),local_bind=str(root))
    assert storage.initialize(in_container=False)
    return ProjectService(factory, LocalProjectFiles(),storage)

def migrate(target):
    previous = os.environ.get("SQLALCHEMY_DATABASE_URI")
    os.environ["SQLALCHEMY_DATABASE_URI"] = PG_URI
    try:
        config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        (command.downgrade if target == "e7b1c4d9a2f6" else command.upgrade)(config, target)
    finally:
        if previous is None:
            os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
        else:
            os.environ["SQLALCHEMY_DATABASE_URI"] = previous


def legacy_sessions(paths):
    engine = create_engine(PG_URI.replace("+asyncpg", "+psycopg2"))
    with engine.begin() as conn:
        for index, path in enumerate(paths):
            conn.execute(text("INSERT INTO sessions(id,project_path,title,status) VALUES(:id,:path,'保留标题','pending')"),
                {"id": f"legacy-{index}", "path": path})
    return engine


def test_migration_drops_legacy_project_path_without_backfill():
    migrate("e7b1c4d9a2f6")
    engine = legacy_sessions(["/host/project", None])
    try:
        migrate("head")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM projects")).scalar() == 0
            assert conn.execute(text("SELECT count(*) FROM sessions WHERE project_id IS NOT NULL")).scalar() == 0
            assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name='sessions' AND column_name='project_path'")).scalar() == 0
            head = ScriptDirectory.from_config(Config(str(Path(__file__).resolve().parents[2] / 'alembic.ini'))).get_current_head()
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
    finally:
        engine.dispose()



def test_managed_projects_and_concurrent_admission(tmp_path):
    async def scenario(factory,engine):
        service=projects(factory,tmp_path)
        first,other=await service.create('第一项目'),await service.create('第二项目')
        assert 'path' not in first.model_dump()
        sessions=[await service.create_session(first.id) for _ in range(2)]
        independent=await service.create_session(other.id)
        ledger=RunLedger(factory)
        results=await asyncio.gather(*[ledger.start(s.id) for s in sessions],return_exceptions=True)
        accepted=[r for r in results if not isinstance(r,BaseException)]
        rejected=[r for r in results if isinstance(r,BaseException)]
        assert len(accepted)==len(rejected)==1
        assert isinstance(rejected[0],ProjectRunConflict)
        run=accepted[0]; waiting_session=next(s for s in sessions if s.id!=run.session_id)
        await ledger.transition(run.session_id,run.id,RunStatus.WAITING)
        with pytest.raises(ProjectRunConflict):
            await ledger.start(waiting_session.id)
        with pytest.raises(ProjectRunConflict):
            await service.archive(first.id,True)
        assert (await ledger.start(independent.id)).status==RunStatus.RUNNING
        await ledger.transition(run.session_id,run.id,RunStatus.CANCELLED)
        with pytest.raises(ProjectRunConflict, match='文件操作'):
            await service.archive(first.id,True)
        from app.domain.services.project_file_coordinator import ProjectFileCoordinator
        class StoppedSandbox:
            @classmethod
            async def stop_project_writers(cls, project_id):
                assert project_id == first.id
        assert await ProjectFileCoordinator(factory, StoppedSandbox).settle(first.id)
        await service.archive(first.id,True)
        page,total=await service.page(archived=True)
        assert total==1 and page[0].id==first.id
        assert (await service.detail(first.id))['task_count']==2
    with_db(scenario)


def test_public_api_creates_without_paths_or_sandbox_and_keeps_ownership(tmp_path):
    from fastapi import FastAPI
    from httpx import AsyncClient,ASGITransport
    from app.application.services.session_service import SessionService
    from app.interfaces.endpoints import project_routes,session_routes
    from app.interfaces.errors.exception_handlers import register_exception_handlers
    from app.interfaces.service_dependencies import get_project_service,get_session_service
    async def scenario(factory,engine):
        service=projects(factory,tmp_path)
        app=FastAPI(); register_exception_handlers(app)
        app.include_router(project_routes.router); app.include_router(session_routes.router)
        app.dependency_overrides[get_project_service]=lambda:service
        app.dependency_overrides[get_session_service]=lambda:SessionService(factory,object)
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            assert (await client.post('/projects',json={'path':'/host'})).status_code==422
            response=await client.post('/projects',json={'name':'材料分析','instructions':'保留原材料'})
            assert response.status_code==200,response.text
            project=response.json()['data']; assert 'path' not in project
            async with factory() as uow:
                assert (await uow.session.page())[1]==0
            session=(await client.post('/sessions',json={'project_id':project['id']})).json()['data']['session_id']
            assert (await client.put(f'/sessions/{session}/project',json={'project_id':project['id']})).status_code==404
            assert (await client.get(f"/projects/{project['id']}/tree")).status_code==200
            assert (await client.get(f'/sessions/{session}/project/tree')).status_code==200
            details=(await client.get(f'/sessions/{session}')).json()['data']
            assert details['project']['id']==project['id']
            assert 'path' not in details['project']
    with_db(scenario)
