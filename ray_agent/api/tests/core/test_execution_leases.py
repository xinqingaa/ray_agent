"""真实进程与业务库：Shell 互斥、停止后的子树确认、未知写入者与显式释放。"""
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from app.application.services.execution_leases import ShellWriteLease
from app.domain.external.process_executor import ProcessOwner
from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.write_lease import LeaseState, WriterKind
from app.domain.services.file_scope import WriteOwner
from app.infrastructure.external.execution import shell_bridge
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import ensure_supervisor, stop_supervisor
from tests.core.test_workspaces import scenario


def test_shell_holds_workspace_until_its_process_tree_stops(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_bridge, 'EXEC_FOREGROUND_SECONDS', 0.05)
    async def check(env):
        view = await env.service.create('Shell 工作区')
        wid = view.workspace.id
        execution_root = tempfile.mkdtemp(prefix='ra-lease-', dir='/tmp')
        executor = None
        try:
            socket = await ensure_supervisor(execution_root)
            executor = SupervisedProcessExecutor(SupervisorClient(socket))
            lease = ShellWriteLease(env.leases(), wid, 'session-a', 'run-a')
            bridge = LocalShellBridge(executor, root_id='root', root_location=view.folder.location,
                                      owner=ProcessOwner(session_id='session-a', run_id='run-a'),
                                      before_start=lease.acquire, on_close=lease.settle)
            pid_file = Path(view.folder.location) / 'child.pid'
            result = await bridge.exec_command('shell-a', view.folder.location,
                                               'sleep 60 & child=$!; echo $child > child.pid; wait')
            assert result.success and result.data['status'] == 'running'
            current = await env.leases().get(wid)
            assert current.writer_kind is WriterKind.PROCESS and current.state is LeaseState.HELD
            with pytest.raises(WorkspaceFileError):
                await env.leases().acquire(wid, WriteOwner('session-b', 'run-b'), '另一写入者')
            child_pid = int(pid_file.read_text())
            assert await bridge.destroy() is True
            assert await env.leases().get(wid) is None
            with pytest.raises(ProcessLookupError):
                os.kill(child_pid, 0)
            with pytest.raises(RuntimeError, match='已结束'):
                await bridge.exec_command('new', view.folder.location, 'echo unsafe')
        finally:
            if executor:
                await executor.client.close()
            await stop_supervisor(execution_root)
            shutil.rmtree(execution_root)
    scenario(tmp_path, check)


def test_unknown_process_keeps_lease_and_old_identity_cannot_release_new_lease(tmp_path):
    async def check(env):
        view = await env.service.create('未知写入者')
        wid = view.workspace.id
        lease = ShellWriteLease(env.leases(), wid, 'session-a', 'run-a')
        await lease.acquire()
        old = await env.leases().get(wid)
        await lease.settle(False)
        blocked = await env.leases().get(wid)
        assert blocked.state is LeaseState.BLOCKED
        with pytest.raises(WorkspaceFileError):
            await env.leases().confirm_release(wid, 'stale-lease')
        await env.leases().confirm_release(wid, old.id)
        assert await env.leases().get(wid) is None
        newer = await env.leases().acquire(wid, WriteOwner('session-b', 'run-b'), '新写入者')
        with pytest.raises(WorkspaceFileError):
            await env.leases().confirm_release(wid, old.id)
        await lease.settle(True)
        assert (await env.leases().get(wid)).id == newer
    scenario(tmp_path, check)


def test_file_tool_lease_is_upgraded_when_a_process_reenters(tmp_path):
    async def check(env):
        view = await env.service.create('同一运行')
        wid = view.workspace.id
        owner = WriteOwner('session-a', 'run-a')
        first = await env.leases().acquire(wid, owner, '文件工具')
        second = await env.leases().acquire(wid, owner, 'Shell', kind=WriterKind.PROCESS)
        assert first == second
        await env.leases().release(first)
        assert (await env.leases().get(wid)).writer_kind is WriterKind.PROCESS
        await env.leases('restarted').scan_startup()
        assert (await env.leases().get(wid)).state is LeaseState.BLOCKED
    scenario(tmp_path, check)


def test_cancel_during_lease_admission_never_starts_a_late_process():
    from unittest.mock import AsyncMock
    async def check():
        admitted, finish = asyncio.Event(), asyncio.Event()
        async def before():
            admitted.set()
            await finish.wait()
        executor = AsyncMock()
        executor.relative_to_root.return_value = ''
        # 仅考察准入期间的取消，文件解析用已知目录。
        executor.register_root = lambda *args: None
        executor.relative_to_root = lambda *args: ''
        bridge = LocalShellBridge(executor, root_id='r', root_location='/tmp',
                                  owner=ProcessOwner(run_id='r'), before_start=before)
        task = asyncio.create_task(bridge.exec_command('s', '/tmp', 'echo must-not-run'))
        await admitted.wait()
        task.cancel()
        await asyncio.sleep(0)
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        executor.start.assert_not_awaited()
        assert bridge.closed
    asyncio.run(asyncio.wait_for(check(), 5))
