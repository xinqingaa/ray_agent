"""工作区文件夹登记与写入保护的边界回归：嵌套与失联、移动与改绑期间的写入、外接卷重新挂载、标记兼容、
删除与写入的竞态、租约残留恢复、Unicode 等价名绕过、外部变更推送的异常恢复。

与 test_workspaces、test_write_protection 共用真实临时目录与真实 SQLite；这里只放那两处没有覆盖的复现场景。
"""
import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path

import pytest

from app.application.errors.exceptions import BadRequestError, ConflictError
from app.application.services.root_access import RootBindings
from app.application.services.workspace_changes import WorkspaceChangeFeed
from app.application.services.write_leases import WriteLeaseService
from app.domain.external.workspace_files import FileLimits, FolderSnapshot, WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.workspace import ConflictResolution
from app.domain.models.write_lease import LeaseState, WriterKind
from app.domain.services.file_rules import denied_reason, is_reserved
from app.domain.services.file_scope import WriteOwner
from app.domain.services.tools.file import FileTool
from app.infrastructure.external.workspace_files.folders import PosixFolderAccess
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from app.infrastructure.external.workspace_files.watcher import WatchfilesFolderWatcher
from tests.core.test_workspaces import Env, scenario
from tests.core.test_write_protection import run_tool, workspace, write


def test_nesting_is_checked_against_moved_workspaces_and_on_every_registration_path(tmp_path):
    async def body(env: Env):
        _, folder_a, _ = await workspace(env, "A")
        view_b, folder_b, ws_b = await workspace(env, "B")
        inside = folder_a / "B-inside-A"
        os.rename(folder_b, inside)  # 用户把 B 拖进 A（同卷，inode 不变）：重新打开 B 不能登记成 A 的子目录
        with pytest.raises(BadRequestError):
            await env.service.open_folder(env.grant(inside))
        assert (await env.service.get(ws_b, refresh=False)).folder.location == str(folder_b)

        # 失联的工作区被整体移走后，它新位置下的子目录不能登记成另一个工作区
        _, folder_c, _ = await workspace(env, "C")
        moved = folder_c.parent / "C-moved"
        os.rename(folder_c, moved)
        (moved / "sub").mkdir()
        with pytest.raises(BadRequestError):
            await env.service.open_folder(env.grant(moved / "sub"))
        reopened = await env.service.open_folder(env.grant(moved))  # 它自己仍可在新位置找回
        assert reopened.recognized == "moved" and reopened.view.folder.location == str(moved.resolve())
    scenario(tmp_path, body)


def test_rebind_and_conflict_rebind_refuse_while_a_writer_holds_the_folder(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        copy = folder.parent / "copy-of-project"
        shutil.copytree(folder, copy)
        opened = await env.service.open_folder(env.grant(copy))
        assert opened.status == "conflict"
        lease_id = await env.leases().acquire(ws, WriteOwner("s-a", "run-a"), "正在写")
        with pytest.raises(ConflictError):
            await env.service.resolve_conflict(opened.conflict.conflict_id, ConflictResolution.REBIND)
        assert (await env.service.get(ws, refresh=False)).folder.location == str(folder)
        await env.leases().release(lease_id)
        again = await env.service.open_folder(env.grant(copy))  # 一次冲突只能处理一次
        resolved = await env.service.resolve_conflict(again.conflict.conflict_id, ConflictResolution.REBIND)
        assert resolved.view.folder.location == str(copy.resolve())
    scenario(tmp_path, body)


def test_a_remount_that_only_changes_the_device_number_is_still_the_same_folder(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        record = view.folder
        async with env.uow_factory() as uow:  # 外接卷重新挂载后设备号变了：登记里留着旧值
            await uow.root.rebind_folder(record.ref.root_id, location=record.location, dev=record.dev + 7,
                                         ino=record.ino, marker_writable=True, checked_at=record.checked_at)
        again = await env.service.open_folder(env.grant(folder))
        assert (again.status, again.recognized) == ("opened", "existing")
        assert again.view.workspace.id == ws and again.view.folder.dev == record.dev
        assert again.view.folder.ref.root_id == record.ref.root_id
        assert len(await env.service.list()) == 1
    scenario(tmp_path, body)


def test_marker_rewrites_keep_fields_written_by_other_installs(tmp_path):
    folder = tmp_path / "w"
    (folder / ".rayagent").mkdir(parents=True)
    other = {"install_id": str(uuid.uuid4()), "workspace_id": str(uuid.uuid4()), "device_name": "Laptop-B", "added_at": 123}
    (folder / ".rayagent" / "workspace.json").write_text(
        json.dumps({"format": 1, "sync_hint": "keep-me", "entries": [other]}), encoding="utf-8")
    info = os.stat(folder)
    PosixFolderAccess._write_marker(str(folder), info.st_dev, info.st_ino, str(uuid.uuid4()), str(uuid.uuid4()))
    written = json.loads((folder / ".rayagent" / "workspace.json").read_text(encoding="utf-8"))
    assert written["sync_hint"] == "keep-me" and other in written["entries"] and len(written["entries"]) == 2


def test_delete_waits_for_a_writer_then_nothing_can_be_written_into_the_deleted_workspace(tmp_path):
    class Jobs:
        async def submit(self, uow, job):
            return job

        def wake(self):
            pass

    async def body(env: Env):
        env.service._jobs = Jobs()
        view, folder, ws = await workspace(env)
        env.service._quiesce_seconds = 0.2
        lease_id = await env.leases().acquire(ws, WriteOwner("s-a", "run-a"), "正在写")
        with pytest.raises(ConflictError):  # 写入者没有在期限内结束：不删除，不留下无归属的备份
            await env.service.delete(ws)
        assert (await env.service.get(ws, refresh=False)).workspace.id == ws

        env.service._quiesce_seconds = 5
        releasing = asyncio.get_running_loop().call_later(
            0.1, lambda: asyncio.ensure_future(env.leases().release(lease_id)))
        await env.service.delete(ws)  # 写入者结束后才删除
        releasing.cancel()
        with pytest.raises(WorkspaceFileError) as refused:
            await env.leases().acquire(ws, WriteOwner("s-a", "run-b"), "删除后的写入")
        assert refused.value.code is ErrorCode.NOT_FOUND
        assert folder.exists()  # 用户文件夹不受影响
    scenario(tmp_path, body)


def test_a_lease_without_a_live_writer_can_be_recovered_but_an_external_process_stays_blocked(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        live = env.leases()
        lease_id = await live.acquire(ws, WriteOwner("s-a", "run-a"), "正在写")
        with pytest.raises(WorkspaceFileError):  # 持有者还在进程内：不是残留，不能抢走
            await live.retry_settle(ws)
        # 释放时数据库出错留下的残留：同实例里已没有内存持有者，重试收尾可以回收
        successor = WriteLeaseService(env.uow_factory, env.read_factory, env.instance_id, env.confirm)
        assert (await successor.retry_settle(ws)).id == lease_id and await live.get(ws) is None

        await live.acquire(ws, WriteOwner("s-b", "run-b"), "外部进程写入", WriterKind.PROCESS)
        await live.mark((await live.get(ws)).id, LeaseState.BLOCKED)
        env.quiescent = False  # 外部进程写入者：核心无法确认它已结束
        with pytest.raises(WorkspaceFileError) as blocked:
            await successor.retry_settle(ws)
        assert "确认旧进程已结束" in str(blocked.value) and (await live.get(ws)).state is LeaseState.BLOCKED
    scenario(tmp_path, body)


def test_unicode_equivalent_names_do_not_bypass_reserved_credential_and_vcs_rules(tmp_path):
    for equivalent in ("id_r\u017fa", "\uff0egit", "server.\u212Aey", "\uff0eenv", ".r\u200bayagent", "\uff0erayagent"):
        assert denied_reason((equivalent,)) is not None, equivalent
    assert is_reserved(".r\u200bayagent") and is_reserved("\uff0erayagent") and not is_reserved(".rayagents")
    assert denied_reason(("notes.txt",)) is None and denied_reason(("\u212Aeys.txt",)) is None

    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / "id_rsa").write_text("PRIVATE KEY", encoding="utf-8")
        _, tool, _ = await run_tool(env, view, "run-1")
        for name in ("id_rsa", "id_r\u017fa"):
            result = await tool.read_file(name)
            assert not result.success and "PRIVATE KEY" not in str(result.data)
        assert not (await write(tool, "c1", ".r\u200bayagent/x.txt", "x")).success
    scenario(tmp_path, body)


def test_change_feed_survives_watch_task_failure_and_ignores_coverage_differences_of_truncated_snapshots(tmp_path):
    class Flaky:
        """第一次监视就以非 OSError 异常退出，之后恢复正常。"""

        def __init__(self):
            self.calls, self.real = 0, WatchfilesFolderWatcher(50, 200)

        async def watch(self, location, stop):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("watcher exploded")
            async for paths in self.real.watch(location, stop):
                yield paths

    class Snapshots(PosixWorkspaceFiles):
        """重扫的快照：先是完整的，之后因上限被截断（只覆盖一部分文件）。"""

        def __init__(self, *args):
            super().__init__(*args)
            self.sequence = [FolderSnapshot({"a.txt": (1, 1), "b.txt": (1, 1)}), FolderSnapshot({"a.txt": (1, 1)}, True),
                             FolderSnapshot({"a.txt": (1, 1)}, True)]

        async def snapshot(self, path):
            return self.sequence.pop(0) if len(self.sequence) > 1 else self.sequence[0]

    async def body(env: Env):
        view, folder, ws = await workspace(env)
        files = Snapshots(RootBindings(env.read_factory, env.data), FileLimits())
        watcher = Flaky()
        feed = WorkspaceChangeFeed(env.uow_factory, env.read_factory, env.folders, files, watcher,
                                   probe_seconds=0.2, rescan_seconds=0.3, paths_per_event=200)
        stream = feed.stream(ws)
        assert (await anext(stream)).available
        events = []

        async def collect():
            async for event in stream:
                events.append(event)
        collector = asyncio.create_task(collect())
        for _ in range(100):  # 异常退出后订阅者收到整体刷新，监视任务被重建
            await asyncio.sleep(0.1)
            if any(event.refresh for event in events) and watcher.calls >= 2:
                break
        assert any(event.refresh for event in events) and watcher.calls >= 2
        topic = feed._topics[ws]
        assert topic.task is not None and not topic.task.done()
        await asyncio.sleep(1.2)  # 经过几次重扫：截断快照不能让 b.txt 被报成被改动
        assert not any("b.txt" in (event.paths or []) for event in events)
        collector.cancel()
        await feed.shutdown()
    scenario(tmp_path, body)
