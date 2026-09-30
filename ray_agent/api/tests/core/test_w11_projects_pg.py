"""W11 项目事务验收。复用临时库夹具；禁止指向开发或用户数据库。"""
import asyncio
import os
import shutil
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.application.errors.exceptions import ConflictError
from app.application.services.project_service import ProjectService
from app.domain.models.run import RunStatus
from app.domain.models.session import Session
from app.domain.models.workspace_project import ProjectSettings
from app.domain.services.project_transactions import ProjectRunConflict
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.project.local_project_files import LocalProjectFiles
from app.infrastructure.external.project.git_reader import GitCliReader
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db

pytestmark = pytest.mark.skipif(not PG_URI, reason="需要独立临时 PostgreSQL")


def projects(factory, root):
    root = os.path.realpath(root)
    return ProjectService(factory, LocalProjectFiles([root]), GitCliReader([root]), [root])


def test_registration_deduplicates_and_rejects_overlap_both_directions(tmp_path):
    parent = tmp_path / "parent_%"
    child = parent / "child"
    child.mkdir(parents=True)
    sibling = tmp_path / "parent_other"
    sibling.mkdir()

    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        registered = await asyncio.gather(*[service.register(str(child)) for _ in range(8)])
        assert len({item.id for item in registered}) == 1
        with pytest.raises(ConflictError, match="重叠"):
            await service.register(str(parent))
        other = await service.register(str(sibling))
        nested = sibling / "nested"
        nested.mkdir()
        with pytest.raises(ConflictError, match="重叠"):
            await service.register(str(nested))
        await service.archive(other.id, True)
        with pytest.raises(ConflictError, match="重叠"):
            await service.register(str(nested))
        assert (await service.register(str(sibling))).id == other.id
        page, total = await service.page()
        assert total == 1 and page[0].id == registered[0].id
        archived, count = await service.page(archived=True)
        assert count == 1 and archived[0].id == other.id
    with_db(scenario)


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


def test_migration_deduplicates_preserves_history_and_freezes_old_empty_settings():
    migrate("e7b1c4d9a2f6")
    engine = legacy_sessions(["/host/project", "/host/project", None])
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO runs(id,session_id,status,started_at) VALUES('legacy-run','legacy-0','waiting',now())"))
        migrate("head")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM projects")).scalar() == 1
            rows = conn.execute(text("SELECT id,project_id,project_snapshot,title FROM sessions ORDER BY id")).all()
            assert rows[0].project_id == rows[1].project_id
            assert rows[0].project_snapshot["instructions"] is None
            assert rows[0].project_snapshot["initial_dirty"] is None
            assert rows[1].project_snapshot is None and rows[2].project_id is None
            assert all(row.title == "保留标题" for row in rows)
            assert conn.execute(text("SELECT status FROM runs WHERE id='legacy-run'")).scalar() == "waiting"
            assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name='sessions' AND column_name='project_path'")).scalar() == 0
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "f9c2a7b4d110"
    finally:
        engine.dispose()


def test_migration_nested_legacy_paths_rolls_back_without_data_loss():
    migrate("e7b1c4d9a2f6")
    engine = legacy_sessions(["/host/parent_%", "/host/parent_%/child"])
    try:
        with pytest.raises(Exception, match="嵌套"):
            migrate("head")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "e7b1c4d9a2f6"
            assert conn.execute(text("SELECT count(*) FROM sessions WHERE project_path IS NOT NULL")).scalar() == 2
            assert conn.execute(text("SELECT to_regclass('public.projects')")).scalar() is None
    finally:
        engine.dispose()


def test_migration_multiple_active_legacy_tasks_preserves_both_and_rejects():
    migrate("e7b1c4d9a2f6")
    engine = legacy_sessions(["/host/project", "/host/project"])
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO runs(id,session_id,status,started_at) VALUES('run-a','legacy-0','waiting',now()),('run-b','legacy-1','running',now())"))
        with pytest.raises(Exception, match="多个活动"):
            migrate("head")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "e7b1c4d9a2f6"
            assert conn.execute(text("SELECT count(*) FROM runs WHERE status IN ('running','waiting')")).scalar() == 2
    finally:
        engine.dispose()


def test_project_lock_holds_during_waiting_and_releases_on_terminal(tmp_path):
    first_path, second_path = tmp_path / "first", tmp_path / "second"
    first_path.mkdir()
    second_path.mkdir()

    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.register(str(first_path))
        other = await service.register(str(second_path))
        sessions = [await service.create_session(project.id) for _ in range(2)]
        independent = await service.create_session(other.id)
        ledger = RunLedger(factory)
        outcomes = await asyncio.gather(*[ledger.start(s.id) for s in sessions], return_exceptions=True)
        accepted = [r for r in outcomes if not isinstance(r, BaseException)]
        rejected = [r for r in outcomes if isinstance(r, BaseException)]
        assert len(accepted) == len(rejected) == 1
        run = accepted[0]
        assert isinstance(rejected[0], ProjectRunConflict)
        assert rejected[0].occupying_session_id == run.session_id
        waiting_session = next(s for s in sessions if s.id != run.session_id)
        await ledger.transition(run.session_id, run.id, RunStatus.WAITING)
        with pytest.raises(ProjectRunConflict):
            await ledger.start(waiting_session.id)
        with pytest.raises(ProjectRunConflict):
            await service.archive(project.id, True)
        parallel = await ledger.start(independent.id)
        assert parallel.status == RunStatus.RUNNING
        await ledger.transition(run.session_id, run.id, RunStatus.CANCELLED)
        replacement = await ledger.start(waiting_session.id)
        await ledger.transition(waiting_session.id, replacement.id, RunStatus.FAILED)
        await service.archive(project.id, True)
        with pytest.raises(ProjectRunConflict, match="归档"):
            await ledger.start(waiting_session.id)
        await service.archive(project.id, False)
        assert (await ledger.start(waiting_session.id)).status == RunStatus.RUNNING
        view = await service.detail(project.id)
        assert view["task_count"] == 2
        assert view["occupying_session_id"] == waiting_session.id
    with_db(scenario)


def test_first_acceptance_freezes_settings_and_detects_directory_replacement(tmp_path):
    path = tmp_path / "project"
    path.mkdir()

    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.register(str(path))
        await service.update(project.id, ProjectSettings(name="旧设置", instructions="旧说明",
            git_author_name="Old Author", git_author_email="old@example.test"))
        existing = await service.create_session(project.id)
        async with factory() as uow:
            assert (await uow.session.get_by_id(existing.id)).project_snapshot is None
        ledger = RunLedger(factory)

        async def accept(session):
            async def freeze(uow):
                current = await uow.session.get_by_id(session.id)
                await service.prepare_snapshot(uow, current)
            return await ledger.start(session.id, before_start=freeze)

        run = await accept(existing)
        await ledger.transition(existing.id, run.id, RunStatus.COMPLETED)
        await service.update(project.id, ProjectSettings(name="新设置", instructions="新说明"))
        run = await accept(existing)
        await ledger.transition(existing.id, run.id, RunStatus.COMPLETED)
        new = await service.create_session(project.id)
        await accept(new)
        async with factory() as uow:
            old_snapshot = (await uow.session.get_by_id(existing.id)).project_snapshot
            new_snapshot = (await uow.session.get_by_id(new.id)).project_snapshot
        assert old_snapshot.instructions == "旧说明"
        assert old_snapshot.git_environment()["GIT_AUTHOR_NAME"] == "Old Author"
        assert old_snapshot.initial_head is None and old_snapshot.initial_dirty is None
        assert new_snapshot.instructions == "新说明" and new_snapshot.git_environment() == {}
        moved = tmp_path / "moved"
        path.rename(moved)
        path.mkdir()
        with pytest.raises(ConflictError, match="替换"):
            service.validate_start(str(path.resolve()), old_snapshot.directory_identity)
        shutil.rmtree(path)
        moved.rename(path)
        service.validate_start(str(path.resolve()), old_snapshot.directory_identity)
    with_db(scenario)


def test_binding_and_first_acceptance_never_commit_incompatible_ownership(tmp_path):
    path = tmp_path / "project"
    path.mkdir()

    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.register(str(path))
        session = Session()
        async with factory() as uow:
            await uow.session.save(session)
        results = await asyncio.gather(service.bind(session.id, project.id),
            RunLedger(factory).start(session.id), return_exceptions=True)
        async with factory() as uow:
            current = await uow.session.get_by_id(session.id)
            runs = await uow.run.list_by_session(session.id)
        # 归属在受理读与锁之间改变时，受理必须拒绝；用户刷新后的手动重试可开始。
        if not runs:
            assert isinstance(results[1], ProjectRunConflict)
            assert current.project_id == project.id
            assert not isinstance(results[0], BaseException)
            await RunLedger(factory).start(session.id)
            async with factory() as uow:
                runs = await uow.run.list_by_session(session.id)
        assert len(runs) == 1
        if current.project_id is None:
            assert isinstance(results[0], (ConflictError, ProjectRunConflict))
        else:
            assert current.project_id == project.id
            assert not isinstance(results[0], BaseException)
    with_db(scenario)


def test_bind_lifecycle_and_public_project_contract(tmp_path):
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from app.application.services.session_service import SessionService
    from app.interfaces.endpoints import project_routes, session_routes
    from app.interfaces.errors.exception_handlers import register_exception_handlers
    from app.interfaces.service_dependencies import get_project_service, get_session_service

    path = tmp_path / "project"
    path.mkdir()

    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(project_routes.router)
        app.include_router(session_routes.router)
        app.dependency_overrides[get_project_service] = lambda: service
        app.dependency_overrides[get_session_service] = lambda: SessionService(factory, object)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://acceptance") as client:
            response = await client.post("/projects", json={"path": str(path)})
            assert response.status_code == 200, response.text
            project_id = response.json()["data"]["id"]
            listing = (await client.get("/projects")).json()["data"]
            assert listing["total"] == 1 and listing["projects"][0]["task_count"] == 0
            async with factory() as uow:
                assert (await uow.session.page())[1] == 0
            plain = (await client.post("/sessions")).json()["data"]["session_id"]
            bound = await client.put(f"/sessions/{plain}/project", json={"project_id": project_id})
            assert bound.status_code == 200 and bound.json()["data"]["id"] == project_id
            assert (await client.delete(f"/sessions/{plain}/project")).status_code == 200
            assert (await client.put(f"/sessions/{plain}/project", json={"path": str(path)})).status_code == 422
            created = await client.post("/sessions", json={"project_id": project_id})
            assert created.status_code == 200, created.text
            session_id = created.json()["data"]["session_id"]
            page = (await client.get(f"/projects/{project_id}/sessions")).json()["data"]
            assert page["total"] == 1 and page["sessions"][0]["project"]["id"] == project_id
            independent = (await client.get("/sessions", params={"independent": True})).json()["data"]
            assert independent["total"] == 1 and independent["sessions"][0]["project"] is None
            assert (await client.get(f"/projects/{project_id}/tree")).status_code == 200
            assert (await client.get(f"/sessions/{session_id}/project/tree")).status_code == 200
            assert (await client.get(f"/projects/{project_id}/git/status")).json()["data"]["state"] == "not_a_repository"
            run = await RunLedger(factory).start(session_id)
            locked = await client.delete(f"/sessions/{session_id}/project")
            assert locked.status_code == 409
            archived = await client.post(f"/projects/{project_id}/archive", json={"archived": True})
            assert archived.status_code == 409 and archived.json()["data"]["occupying_session_id"] == session_id
            await RunLedger(factory).transition(session_id, run.id, RunStatus.COMPLETED)
            archived = await client.post(f"/projects/{project_id}/archive", json={"archived": True})
            assert archived.status_code == 200
            assert (await client.post("/sessions", json={"project_id": project_id})).status_code == 409
            assert (await client.get(f"/sessions/{session_id}")).status_code == 200
    with_db(scenario)
