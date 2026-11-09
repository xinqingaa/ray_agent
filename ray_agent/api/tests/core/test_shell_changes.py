"""真实文件、进程与 SQLite：Shell 前清单、收尾后摘要、等待续接与未知／截断边界。"""
import shutil
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI

from app.application.services.execution_leases import ShellWriteLease
from app.application.services.shell_changes import KEY, ShellChanges
from app.domain.external.workspace_files import FolderSnapshot
from app.domain.models.run import Run, RunStatus
from app.infrastructure.external.execution import shell_bridge
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import ensure_supervisor, stop_supervisor
from app.interfaces.endpoints import session_routes, workspace_history_routes
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_shell_changes
from tests.core.test_workspaces import scenario


async def prepared(env):
    view = await env.service.create('脚本文件观察')
    session = await env.sessions.create_session(workspace_id=view.workspace.id)
    run = Run(session_id=session.id)
    async with env.uow_factory() as uow:
        await uow.run.create(run)
    opened = await env.access().open(session.id, view.workspace.id, run.id, ensure=True)
    return view, session, run, opened.scope


def test_real_shell_manifest_wait_resume_summary_and_http_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_bridge, 'EXEC_FOREGROUND_SECONDS', 0.05)
    async def check(env):
        view, session, run, scope = await prepared(env)
        folder = Path(view.folder.location)
        (folder / 'old.txt').write_text('before')
        (folder / 'gone.txt').write_text('gone')
        (folder / 'node_modules').mkdir()
        observations = ShellChanges(env.uow_factory, env.read_factory)
        lease = ShellWriteLease(env.leases(), view.workspace.id, session.id, run.id,
                                changes=observations, scope=scope)
        execution_root = tempfile.mkdtemp(prefix='ra-observe-', dir='/tmp')
        executor = None
        try:
            executor = SupervisedProcessExecutor(SupervisorClient(await ensure_supervisor(execution_root)))
            bridge = LocalShellBridge(executor, files=scope, session_id=session.id, run_id=run.id,
                                      before_start=lease.acquire, on_close=lease.settle)
            result = await bridge.exec_command('s', str(folder),
                'printf after-content > old.txt; printf new > new.txt; rm gone.txt; '
                'printf ignored > node_modules/ignored; sleep 60')
            assert result.data['status'] == 'running'
            async with env.read_factory() as uow:
                stored = (await uow.run.get(run.id)).config_snapshot[KEY]
            assert stored['roots'][0]['before']['files']
            assert all(root['after'] is None for root in stored['roots'])
            # 续接和服务重建不把已经变更的文件当成“运行前”。
            async with env.uow_factory() as uow:
                await uow.run.transition(run.id, RunStatus.WAITING)
            reopened = ShellChanges(env.uow_factory, env.read_factory)
            await reopened.begin(run.id, scope)
            assert (await reopened.view(session.id, run.id, offset=0, limit=100))['state'] == 'observing'
            (folder / 'external.txt').write_text('external concurrent writer')
            assert await bridge.destroy()
            assert await env.leases().get(view.workspace.id) is None
            summary = await reopened.view(session.id, run.id, offset=0, limit=100)
            operations = {item['relative_path']: item['operation'] for item in summary['entries']}
            assert operations == {'old.txt': 'modify', 'gone.txt': 'delete', 'new.txt': 'create', 'external.txt': 'create'}
            assert summary['state'] == 'complete' and summary['attribution'] == 'unknown'
            assert summary['undo_available'] is False
            assert (await reopened.view(session.id, run.id, offset=0, limit=1))['has_more']
            app = FastAPI()
            app.include_router(session_routes.router, prefix='/api')
            app.include_router(workspace_history_routes.router, prefix='/api')
            register_exception_handlers(app)
            app.dependency_overrides[get_shell_changes] = lambda: reopened
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                url = f'/api/sessions/{session.id}/runs/{run.id}/shell-changes'
                response = await client.get(url)
                assert response.status_code == 200, response.text
                assert response.json()['data']['total'] == 4
                assert (await client.get(f'/api/sessions/wrong/runs/{run.id}/shell-changes')).status_code == 404
                assert (await client.get(f'/api/workspaces/wrong/runs/{run.id}/shell-changes')).status_code == 404
        finally:
            if executor:
                await executor.client.close()
            await stop_supervisor(execution_root)
            shutil.rmtree(execution_root)
    scenario(tmp_path, check)


def test_partial_scans_do_not_claim_unseen_files_created_or_deleted(tmp_path):
    async def check(env):
        _, session, run, scope = await prepared(env)
        observations = ShellChanges(env.uow_factory, env.read_factory)
        results = iter([FolderSnapshot({'missing': (1, 1)}, True), FolderSnapshot({}, False),
                        FolderSnapshot({'appeared': (1, 2)}, True), FolderSnapshot({}, False)])
        class Files:
            async def snapshot(self, path): return next(results)
        scope.files = Files()
        await observations.begin(run.id, scope)
        await observations.finish(run.id, scope, True)
        result = await observations.view(session.id, run.id, offset=0, limit=100)
        assert {item['operation'] for item in result['entries']} == {'unclassified'}
        assert result['roots'][0]['partial']
    scenario(tmp_path, check)


def test_unknown_or_crashed_writer_has_no_invented_after_snapshot(tmp_path):
    async def check(env):
        _, session, run, scope = await prepared(env)
        observations = ShellChanges(env.uow_factory, env.read_factory)
        await observations.begin(run.id, scope)
        async with env.uow_factory() as uow:
            await uow.run.transition(run.id, RunStatus.INTERRUPTED)
        result = await ShellChanges(env.uow_factory, env.read_factory).view(session.id, run.id, offset=0, limit=100)
        assert result['state'] == 'unknown' and not result['entries']
        await observations.finish(run.id, scope, False)
        result = await observations.view(session.id, run.id, offset=0, limit=100)
        assert result['state'] == 'unknown' and all(root['after_files'] is None for root in result['roots'])
    scenario(tmp_path, check)


def test_waiting_across_core_restart_never_adopts_old_observation_interval(tmp_path):
    async def check(env):
        _, session, run, scope = await prepared(env)
        old = ShellChanges(env.uow_factory, env.read_factory, instance_id='old-core')
        await old.begin(run.id, scope)
        async with env.uow_factory() as uow:
            await uow.run.transition(run.id, RunStatus.WAITING)
        new = ShellChanges(env.uow_factory, env.read_factory, instance_id='new-core')
        assert (await new.view(session.id, run.id, offset=0, limit=100))['state'] == 'unknown'
        # 即使旧核心正常退出时确认了子树，也不能将重启后的续接当成同一连续区间。
        await old.finish(run.id, scope, True)
        assert (await new.view(session.id, run.id, offset=0, limit=100))['state'] == 'unknown'
        await new.begin(run.id, scope)
        await new.finish(run.id, scope, True)
        result = await new.view(session.id, run.id, offset=0, limit=100)
        assert result['state'] == 'unknown' and not result['entries']
    scenario(tmp_path, check)
