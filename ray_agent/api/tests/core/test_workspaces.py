"""文件夹工作区：新建与打开、移动识别、复制冲突、失联、标记不可写、删除不动用户文件、会话间的可访问范围隔离。

文件夹、标记与会话工作目录都在真实临时目录里，业务库是真实 SQLite；只有宿主选择器被一次性授权代替。
"""
import asyncio
import json
import os
import shutil
from pathlib import Path

import pytest

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, GoneError
from app.application.services.background_jobs import BackgroundJobRunner
from app.application.services.folder_grants import FolderGrants
from app.application.services.folder_policy import FolderPolicy
from app.application.services.root_access import RunFileAccess
from app.application.services.session_service import SessionService
from app.application.services.workspace_service import (
    WorkspaceRuntime, WorkspaceService, workspace_delete_handler,
)
from app.application.services.workspace_writer import WorkspaceWriter
from app.application.services.write_leases import WriteLeaseService
from app.domain.external.workspace_files import FileLimits
from app.domain.models.error import ErrorCode
from app.domain.models.operation import OperationKind, OperationStatus
from app.domain.models.workspace import ConflictResolution, FolderStatus, WorkspaceStatus
from app.domain.services.tools.file import FileTool
from app.infrastructure.external.file_storage.workspace_objects import LocalWorkspaceObjects
from app.infrastructure.external.workdir.session_workdir import SessionWorkdirs
from app.infrastructure.external.workspace_files.folders import PosixFolderAccess
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from tests.support.sqlite_db import with_database

INSTALL = "inst-test"


def marker_of(folder: Path) -> dict:
    return json.loads((folder / ".rayagent" / "workspace.json").read_text(encoding="utf-8"))


def files_factory(resolve, limits):
    return PosixWorkspaceFiles(resolve, limits)


class Env:
    """一个测试的运行环境：数据根、主目录与默认位置都在 tmp_path 下，系统目录黑名单为空（临时目录本身在系统目录里）。"""

    def __init__(self, tmp_path: Path, uow_factory, read_factory, jobs=None, install_id=INSTALL):
        self.tmp = tmp_path
        self.data = tmp_path / "data"
        self.home = tmp_path / "home"
        self.default = tmp_path / "home" / "RayAgent"
        self.home.mkdir(parents=True, exist_ok=True)
        self.uow_factory, self.read_factory, self.jobs = uow_factory, read_factory, jobs
        self.folders = PosixFolderAccess(FileLimits())
        self.runtime = WorkspaceRuntime(grants=FolderGrants(60, 16))
        self.workdirs = SessionWorkdirs(self.data)
        self.install_id = install_id
        self.policy = FolderPolicy(blocked=[], data_root=str(self.data), home=str(self.home))
        self.service = WorkspaceService(uow_factory, read_factory, self.folders, self.policy, self.runtime,
                                        install_id, str(self.default), jobs=jobs)
        self.sessions = SessionService(uow_factory, read_factory, workdirs=self.workdirs, jobs=jobs)
        self.instance_id = "core-instance-1"
        self._lease_services: dict = {}
        self.quiescent = True  # 停止收尾重试时，执行协程是否已确认退出
        self.objects = LocalWorkspaceObjects(tmp_path / "objects", tmp_path / "tmp", uow_factory)

    async def confirm(self, run_id: str) -> bool:
        return self.quiescent

    def leases(self, instance_id=None) -> WriteLeaseService:
        key = instance_id or self.instance_id
        if key not in self._lease_services:  # 同一实例一份：它记着进程内仍持有租约的写入者
            self._lease_services[key] = WriteLeaseService(self.uow_factory, self.read_factory, key, self.confirm)
        return self._lease_services[key]

    def writer(self, files) -> WorkspaceWriter:
        return WorkspaceWriter(files, self.uow_factory, self.read_factory, self.leases(), self.objects)

    def grant(self, path: Path) -> str:
        return self.runtime.grants.issue(str(path)).grant_id

    def folder(self, *parts: str) -> Path:
        path = self.tmp.joinpath("elsewhere", *parts)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def access(self) -> RunFileAccess:
        return RunFileAccess(self.read_factory, self.workdirs, FileLimits(), self.folders, files_factory, self.writer)

    async def scope_of(self, session):
        opened = await self.access().open(session.id, session.workspace_id, None, ensure=True)
        return opened


def scenario(tmp_path, body, **options):
    async def run(uow_factory, read_factory, database):
        await body(Env(tmp_path, uow_factory, read_factory, **options))
    with_database(tmp_path, run)


def test_create_open_and_policy_rejections(tmp_path):
    async def body(env: Env):
        first = await env.service.create("项目 A")
        second = await env.service.create("项目 A")
        folders = {Path(first.folder.location), Path(second.folder.location)}
        assert folders == {env.default / "项目 A", env.default / "项目 A (2)"}
        entry = marker_of(Path(first.folder.location))["entries"]
        assert entry == [{"install_id": INSTALL, "workspace_id": first.workspace.id}]
        assert first.folder.marker_writable and first.folder.status is FolderStatus.AVAILABLE

        # 已有目录不会被新建复用：默认位置里手动建的同名目录保持原样
        (env.default / "手建").mkdir()
        (env.default / "手建" / "keep.txt").write_text("mine")
        created = await env.service.create("手建")
        assert Path(created.folder.location).name == "手建 (2)"
        assert (env.default / "手建" / "keep.txt").read_text() == "mine"

        # 打开已有文件夹需要一次性授权，用过即作废
        existing = env.folder("资料")
        (existing / "a.md").write_text("hello")
        (existing / "sub").mkdir()
        (existing / "sub" / "b.md").write_text("world")
        (existing / "node_modules").mkdir()
        (existing / "node_modules" / "x.js").write_text("ignored")
        grant = env.grant(existing)
        opened = await env.service.open_folder(grant, "资料")
        assert opened.status == "opened" and opened.recognized == "new"
        assert opened.scan.files == 2 and opened.scan.bytes == 10 and not opened.scan.truncated
        assert marker_of(existing)["entries"][0]["install_id"] == INSTALL
        with pytest.raises(GoneError):
            await env.service.open_folder(grant)
        with pytest.raises(GoneError):
            await env.service.open_folder("unknown-grant")

        # 同一个文件夹再次打开返回已有工作区，不新建
        again = await env.service.open_folder(env.grant(existing))
        assert again.recognized == "existing" and again.view.workspace.id == opened.view.workspace.id
        assert len(await env.service.list()) == 4

        # 打开范围的限制
        async def reason(path: Path) -> str:
            with pytest.raises(BadRequestError) as error:
                await env.service.open_folder(env.grant(path))
            return error.value.info.details["reason"]
        assert await reason(Path("/")) == "filesystem_root"
        assert await reason(env.home) == "home"
        assert await reason(env.home.parent) == "home"
        env.data.mkdir(parents=True, exist_ok=True)
        assert await reason(env.data) == "data_root"
        (env.data / "inside").mkdir()
        assert await reason(env.data / "inside") == "data_root"
        assert await reason(existing / "sub") == "nested"
        assert await reason(env.tmp / "elsewhere") == "nested"

    scenario(tmp_path, body)


def test_system_directories_are_rejected(tmp_path):
    async def body(env: Env):
        policy = FolderPolicy(blocked=["/usr", "/System"], data_root=str(env.data), home=str(env.home))
        with pytest.raises(BadRequestError) as error:
            policy.check_workspace(os.path.realpath("/usr/local"), [])
        assert error.value.info.details["reason"] == "system"
    scenario(tmp_path, body)


def test_folder_moved_with_mv_is_recognised_and_keeps_sessions(tmp_path):
    async def body(env: Env):
        view = await env.service.create("搬家")
        workspace_id, old = view.workspace.id, Path(view.folder.location)
        (old / "notes.txt").write_text("data")
        session = await env.sessions.create_session(workspace_id=workspace_id)
        new = env.tmp / "elsewhere" / "新位置"
        new.parent.mkdir(parents=True, exist_ok=True)
        os.rename(old, new)

        # 原位置失联：不可用，但会话可读，也不会在旧位置自动建空目录
        lost = await env.service.get(workspace_id)
        assert lost.folder.status is FolderStatus.UNAVAILABLE and not old.exists()
        assert (await env.sessions.get_session(session.id)).workspace_id == workspace_id

        result = await env.service.open_folder(env.grant(new))
        assert result.status == "opened" and result.recognized == "moved"  # 同一文件系统上的 mv 保留身份
        assert result.view.workspace.id == workspace_id and Path(result.view.folder.location) == new
        assert result.view.folder.status is FolderStatus.AVAILABLE
        assert len(await env.service.list()) == 1 and (new / "notes.txt").read_text() == "data"
    scenario(tmp_path, body)


def test_copied_folder_is_a_conflict_and_either_resolution_keeps_one_folder_per_workspace(tmp_path):
    async def body(env: Env):
        view = await env.service.create("原件")
        workspace_id, original = view.workspace.id, Path(view.folder.location)
        (original / "a.txt").write_text("x")
        # 别的机器的条目必须保留：只追加或更新本机条目
        marker = marker_of(original)
        marker["entries"].append({"install_id": "inst-other", "workspace_id": "ws-other"})
        (original / ".rayagent" / "workspace.json").write_text(json.dumps(marker))

        copy_one = env.tmp / "elsewhere" / "副本一"
        shutil.copytree(original, copy_one)
        conflict = await env.service.open_folder(env.grant(copy_one))
        assert conflict.status == "conflict" and conflict.view is None
        assert conflict.conflict.workspace_id == workspace_id and Path(conflict.conflict.bound_path) == original
        assert set(conflict.conflict.options) == {"as_new", "rebind"}
        assert len(await env.service.list()) == 1

        # 作为新工作区：副本重写本机条目并成为新工作区，原件不变
        as_new = await env.service.resolve_conflict(conflict.conflict.conflict_id, ConflictResolution.AS_NEW)
        new_id = as_new.view.workspace.id
        assert new_id != workspace_id and Path(as_new.view.folder.location) == copy_one
        entries = {entry["install_id"]: entry["workspace_id"] for entry in marker_of(copy_one)["entries"]}
        assert entries == {INSTALL: new_id, "inst-other": "ws-other"}
        assert marker_of(original)["entries"][0] == {"install_id": INSTALL, "workspace_id": workspace_id}
        with pytest.raises(AppException):  # 冲突只能处理一次
            await env.service.resolve_conflict(conflict.conflict.conflict_id, ConflictResolution.AS_NEW)

        # 改绑到这里：工作区搬到第二个副本，原文件夹解除绑定
        copy_two = env.tmp / "elsewhere" / "副本二"
        shutil.copytree(original, copy_two)
        second = await env.service.open_folder(env.grant(copy_two))
        assert second.status == "conflict"
        rebound = await env.service.resolve_conflict(second.conflict.conflict_id, ConflictResolution.REBIND)
        assert rebound.view.workspace.id == workspace_id and Path(rebound.view.folder.location) == copy_two
        locations = {w.workspace.id: Path(w.folder.location) for w in await env.service.list()}
        assert locations == {workspace_id: copy_two, new_id: copy_one}
        assert all(entry["install_id"] != INSTALL for entry in marker_of(original)["entries"])
        assert any(entry["install_id"] == "inst-other" for entry in marker_of(original)["entries"])
        # 解除绑定的原文件夹再次打开时是一个新工作区
        reopened = await env.service.open_folder(env.grant(original))
        assert reopened.recognized == "new" and reopened.view.workspace.id not in (workspace_id, new_id)
        assert len({w.folder.ref.root_id for w in await env.service.list()}) == 3
    scenario(tmp_path, body)


def test_lost_folder_is_unavailable_for_file_tools_but_chat_keeps_working(tmp_path):
    async def body(env: Env):
        view = await env.service.create("会丢")
        folder = Path(view.folder.location)
        (folder / "a.txt").write_text("x")
        session = await env.sessions.create_session(workspace_id=view.workspace.id)
        opened = await env.scope_of(session)
        assert opened.workspace_problem is None
        shutil.rmtree(folder)

        again = await env.scope_of(session)
        assert again.workspace_problem and not folder.exists()
        # 工作目录退回会话工作目录；工作区文件夹仍在范围里，但文件工具对它返回不可用
        assert again.scope.working.path == str(again.workdir.path)
        result = await FileTool(again.scope).read_file(str(folder / "a.txt"))
        assert result.success is False
        written = await FileTool(again.scope).write_file(str(folder / "new.txt"), "x")
        assert written.success is False and not folder.exists()  # 不在旧位置自动建目录
        assert (await FileTool(again.scope).write_file("scratch.txt", "ok")).success
        assert (await env.service.get(view.workspace.id)).folder.status is FolderStatus.UNAVAILABLE

        # 文件夹原地被另一个目录替换（文件系统身份不符）同样不可用，不会把写入落进去
        folder.mkdir()
        replaced = await env.scope_of(session)
        assert replaced.workspace_problem
        assert not (await FileTool(replaced.scope).write_file(str(folder / "x.txt"), "x")).success
        assert list(folder.iterdir()) == []
    scenario(tmp_path, body)


def test_marker_not_writable_falls_back_to_path_and_identity(tmp_path):
    if os.geteuid() == 0:
        pytest.skip("root 不受目录权限限制")

    async def body(env: Env):
        locked = env.folder("只读")
        (locked / "a.txt").write_text("x")
        locked.chmod(0o555)
        try:
            opened = await env.service.open_folder(env.grant(locked))
            assert opened.status == "opened" and opened.view.folder.marker_writable is False
            assert not (locked / ".rayagent").exists()
            assert (await env.service.get(opened.view.workspace.id)).folder.status is FolderStatus.AVAILABLE
        finally:
            locked.chmod(0o755)
    scenario(tmp_path, body)


def test_deleting_a_workspace_reclaims_sessions_and_never_touches_user_files(tmp_path):
    async def run(uow_factory, read_factory, database):
        jobs = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        env = Env(tmp_path, uow_factory, read_factory, jobs=jobs)
        from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        jobs.register(OperationKind.WORKSPACE_DELETE,
                      workspace_delete_handler(env.folders, uow_factory, storage.remove_key, env.workdirs.remove),
                      requeue_on_restart=True)
        view = await env.service.create("要删")
        folder = Path(view.folder.location)
        (folder / "report.md").write_text("用户文件")
        marker = marker_of(folder)
        marker["entries"].append({"install_id": "inst-other", "workspace_id": "ws-other"})
        (folder / ".rayagent" / "workspace.json").write_text(json.dumps(marker))
        session = await env.sessions.create_session(workspace_id=view.workspace.id)
        opened = await env.scope_of(session)
        workdir = opened.workdir.path
        (workdir / "scratch.txt").write_text("临时")
        other = await env.service.create("保留")

        jobs.start()
        job = await env.service.delete(view.workspace.id)
        for _ in range(200):
            job = await jobs.get(job.operation_id)
            if job.status.terminal:
                break
            await asyncio.sleep(0.02)
        await jobs.stop()
        assert job.status == OperationStatus.SUCCEEDED, job.error
        assert (folder / "report.md").read_text() == "用户文件"  # 用户文件与文件夹都在
        assert not workdir.exists() and await env.sessions.get_session(session.id) is None
        remaining = json.loads((folder / ".rayagent" / "workspace.json").read_text())["entries"]
        assert remaining == [{"install_id": "inst-other", "workspace_id": "ws-other"}]  # 只移除本机条目
        assert [w.workspace.id for w in await env.service.list()] == [other.workspace.id]
        with pytest.raises(AppException):
            await env.service.get(view.workspace.id)
    with_database(tmp_path, run)


def test_accessible_roots_are_isolated_between_workspaces_and_standalone_chats(tmp_path):
    async def body(env: Env):
        first = await env.service.create("甲")
        second = await env.service.create("乙")
        folder_a, folder_b = Path(first.folder.location), Path(second.folder.location)
        (folder_a / "a.txt").write_text("甲的文件")
        (folder_b / "b.txt").write_text("乙的文件")
        in_a = await env.sessions.create_session(workspace_id=first.workspace.id)
        in_b = await env.sessions.create_session(workspace_id=second.workspace.id)
        alone = await env.sessions.create_session()
        scope_a, scope_b, scope_alone = [(await env.scope_of(s)) for s in (in_a, in_b, alone)]

        # 工作区会话的相对路径指向工作区文件夹，也能访问自己的会话工作目录
        assert (await FileTool(scope_a.scope).read_file("a.txt")).data["content"] == "甲的文件"
        assert (await FileTool(scope_a.scope).write_file("out/new.md", "写入")).success
        assert (folder_a / "out" / "new.md").read_text() == "写入"
        scratch = str(scope_a.workdir.path / "scratch.txt")
        assert (await FileTool(scope_a.scope).write_file(scratch, "草稿")).success

        # 访问另一个工作区、另一个会话的工作目录都被拒绝，独立对话也看不到任何工作区文件夹
        for tool, forbidden in [
            (FileTool(scope_a.scope), str(folder_b / "b.txt")),
            (FileTool(scope_b.scope), str(folder_a / "a.txt")),
            (FileTool(scope_a.scope), str(scope_alone.workdir.path / "x")),
            (FileTool(scope_alone.scope), str(folder_a / "a.txt")),
            (FileTool(scope_alone.scope), str(scope_a.workdir.path / "scratch.txt")),
            (FileTool(scope_a.scope), "../乙/b.txt"),
        ]:
            denied = await tool.read_file(forbidden)
            assert denied.success is False and "可访问范围" in denied.message
            assert not (await tool.write_file(forbidden, "x")).success
        assert (folder_b / "b.txt").read_text() == "乙的文件"
        assert [root.kind.value for root in scope_alone.scope.roots] == ["session_workdir"]
        assert {root.kind.value for root in scope_a.scope.roots} == {"workspace_folder", "session_workdir"}
        # 工作区的 .rayagent 不可读、不可写、不出现在列表里
        assert not (await FileTool(scope_a.scope).read_file(".rayagent/workspace.json")).success
        listing = await FileTool(scope_a.scope).list_dir(str(folder_a))
        assert ".rayagent" not in json.dumps(listing.data)
    scenario(tmp_path, body)


def test_archived_workspace_refuses_writes_and_new_sessions_and_session_workspace_is_fixed(tmp_path):
    async def body(env: Env):
        view = await env.service.create("归档")
        session = await env.sessions.create_session(workspace_id=view.workspace.id)
        scope = await env.scope_of(session)
        archived = await env.service.archive(view.workspace.id, view.workspace.version)
        assert archived.workspace.status is WorkspaceStatus.ARCHIVED
        assert not (await FileTool(scope.scope).write_file("a.txt", "x")).success  # 写入口拒绝；同一份范围对象也一样
        with pytest.raises(ConflictError):
            await env.sessions.create_session(workspace_id=view.workspace.id)
        with pytest.raises(ConflictError):  # 版本不符
            await env.service.rename(view.workspace.id, "新名", view.workspace.version)
        restored = await env.service.unarchive(view.workspace.id, archived.workspace.version)
        assert restored.workspace.status is WorkspaceStatus.ACTIVE
        assert (await FileTool(scope.scope).write_file("a.txt", "x")).success
        # 会话的工作区创建后不会被改写
        async with env.uow_factory() as uow:
            stored = await uow.session.get_by_id(session.id)
            stored.workspace_id = "other"
            await uow.session.save(stored)
        assert (await env.sessions.get_session(session.id)).workspace_id == view.workspace.id
    scenario(tmp_path, body)


def test_copy_then_delete_original_is_recognised_as_moved(tmp_path):
    """跨文件系统的移动（复制后删除原件）没有保留文件系统身份，由标记识别。"""
    async def body(env: Env):
        view = await env.service.create("跨盘")
        workspace_id, old = view.workspace.id, Path(view.folder.location)
        (old / "a.txt").write_text("x")
        new = env.tmp / "elsewhere" / "跨盘新位置"
        shutil.copytree(old, new)
        shutil.rmtree(old)
        result = await env.service.open_folder(env.grant(new))
        assert result.status == "opened" and result.recognized == "moved"
        assert result.view.workspace.id == workspace_id and Path(result.view.folder.location) == new
        assert len(await env.service.list()) == 1
    scenario(tmp_path, body)


def test_agent_writes_into_the_workspace_folder_and_delivers_a_stable_version(tmp_path):
    """脚本模型经 write_file 把文件写进工作区文件夹，再 deliver_files 交付：交付保存内容对象并记录来源根与相对路径，
    之后改动文件夹里的文件不影响已交付版本。"""
    from types import SimpleNamespace
    from app.domain.models.event import ToolEvent
    from app.domain.models.run import RunStatus
    from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
    from tests.support.loop_harness import input_task, make_loop, make_runner, start_run
    from tests.support.scripted_llm import text, tool_call

    async def run(uow_factory, read_factory, database):
        env = Env(tmp_path, uow_factory, read_factory)
        view = await env.service.create("交付")
        folder = Path(view.folder.location)
        created = await env.sessions.create_session(workspace_id=view.workspace.id)
        session = await env.sessions.get_session(created.id)
        opened = await env.scope_of(session)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        holder = {}

        async def deliver(path):
            return await holder["runner"]._deliver_file(path)

        files = SimpleNamespace(scope=opened.scope, files=opened.scope.files)
        target = str(folder.resolve() / "报告" / "结论.md")
        h = make_loop([tool_call("update_plan", {"plan": [{"step": "写结论", "status": "completed"}], "artifacts": [
                           {"name": "结论", "delivery": "file", "path": target}]}, id="p"),
                       tool_call("write_file", {"filepath": "报告/结论.md", "content": "版本一"}, id="w"),
                       tool_call("deliver_files", {"paths": [target]}, id="d"),
                       text("已交付")],
                      session=session, uow_factory=uow_factory, files=files, deliver_file=deliver)
        started = await start_run(h, input_task(), "写结论并交付")
        runner = make_runner(h, run=started)
        runner._file_storage = storage
        holder["runner"] = runner
        await runner.invoke(input_task())

        assert (folder / "报告" / "结论.md").read_text(encoding="utf-8") == "版本一"
        from tests.core.test_sqlite_storage import read
        _, runs, events = await read(read_factory, session.id)
        async with read_factory() as uow:
            delivered = await uow.file.list_by_session(session.id)
        assert runs[0].status is RunStatus.COMPLETED, runs[0].reason
        assert [e.denied_by for e in events if isinstance(e, ToolEvent) and e.denied_by] == []
        assert len(delivered) == 1
        record = delivered[0]
        assert record.root_id == view.folder.ref.root_id and record.relative_path == "报告/结论.md"
        assert record.filepath == str(folder.resolve() / "报告" / "结论.md")
        (folder / "报告" / "结论.md").write_text("版本二", encoding="utf-8")
        stream, info = await storage.download_file(record.id)
        with stream:
            assert stream.read() == "版本一".encode()  # 已交付版本不随后续修改变化
    with_database(tmp_path, run, timeout=60)


def test_workspace_migration_keeps_existing_rows_and_downgrades(tmp_path):
    import sqlite3
    from alembic import command
    from app.infrastructure.storage.sqlite import _alembic_config, migrate

    database = tmp_path / "rayagent.db"
    config = _alembic_config(database)
    command.upgrade(config, "0001_baseline")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO sessions (id, title, title_source, status, unread_message_count, latest_message, "
            "next_event_seq, memories, files, created_at, updated_at) VALUES "
            "('s1', 't', 'default', 'pending', 0, '', 1, '{}', '[]', '2026-01-01 00:00:00', '2026-01-01 00:00:00')")
        connection.execute("INSERT INTO roots (id, kind, session_id, location, created_at) VALUES "
                           "('r1', 'session_workdir', 's1', 'sessions/s1', '2026-01-01 00:00:00')")
    assert migrate(database) == "0003_write_protection"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT workspace_id FROM sessions WHERE id='s1'").fetchone() == (None,)
        assert connection.execute("SELECT location, fs_dev, fs_ino FROM roots WHERE id='r1'").fetchone() == (
            "sessions/s1", None, None)
        assert connection.execute("SELECT count(*) FROM workspaces").fetchone() == (0,)
    command.downgrade(config, "0001_baseline")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT id FROM sessions").fetchall() == [("s1",)]
        assert connection.execute("SELECT id FROM roots").fetchall() == [("r1",)]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "workspaces" not in tables
    assert migrate(database) == "0003_write_protection"


def test_attachments_are_copied_into_the_workspace_folder_without_overwriting(tmp_path):
    """工作区会话的附件放进工作区文件夹根目录，同名不覆盖；文件夹失联时退回会话工作目录的 uploads。"""
    import io
    from fastapi import UploadFile
    from app.domain.models.event import MessageEvent
    from app.domain.services.agent_task_runner import AgentTaskRunner
    from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage

    async def run(uow_factory, read_factory, database):
        env = Env(tmp_path, uow_factory, read_factory)
        view = await env.service.create("附件")
        folder = Path(view.folder.location)
        (folder / "资料.txt").write_text("用户原有")
        session = await env.sessions.create_session(workspace_id=view.workspace.id)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)

        async def upload(name: str, body: bytes):
            return await storage.upload_file(UploadFile(filename=name, file=io.BytesIO(body)), session_id=session.id)

        async def runner_for(scope_owner):
            runner = AgentTaskRunner.__new__(AgentTaskRunner)
            runner._session_id, runner._uow_factory = session.id, uow_factory
            runner._files, runner._workdir, runner._file_storage = scope_owner.scope, scope_owner.workdir, storage
            return runner

        opened = await env.scope_of(session)
        first, second = await upload("资料.txt", b"A"), await upload("资料.txt", b"B")
        event = MessageEvent(role="user", message="看附件", attachments=[first, second])
        await (await runner_for(opened))._place_attachments(event)
        assert (folder / "资料.txt").read_text() == "用户原有"
        assert [Path(item.filepath).name for item in event.attachments] == ["资料 (2).txt", "资料 (3).txt"]
        assert (folder / "资料 (2).txt").read_bytes() == b"A" and (folder / "资料 (3).txt").read_bytes() == b"B"
        assert all(item.root_id == view.folder.ref.root_id and item.relative_path for item in event.attachments)

        # 再次取用同一条输入不再放第二份
        again = MessageEvent(role="user", message="再看", attachments=[first])
        await (await runner_for(opened))._place_attachments(again)
        assert Path(again.attachments[0].filepath).name == "资料 (2).txt" and not (folder / "资料 (4).txt").exists()

        # 模型文件工具读不了的名字（凭据）不放进文件夹，留在模型可读的会话工作目录
        secret = MessageEvent(role="user", message="凭据", attachments=[await upload(".env", b"K=1")])
        await (await runner_for(opened))._place_attachments(secret)
        assert Path(secret.attachments[0].filepath).parent == opened.workdir.uploads and not (folder / ".env").exists()

        shutil.rmtree(folder)
        lost = await env.scope_of(session)
        third = await upload("新.txt", b"C")
        fallback = MessageEvent(role="user", message="文件夹丢了", attachments=[third])
        await (await runner_for(lost))._place_attachments(fallback)
        assert Path(fallback.attachments[0].filepath).parent == lost.workdir.uploads and not folder.exists()
    with_database(tmp_path, run)
