"""工作区文件夹的界面文件操作：删除文件或空文件夹、重命名文件、新建文件夹。

经真实 SQLite 与真实临时目录：覆盖成功路径、越界与保留路径、同名冲突、版本不符、归档与占用、进入「最近修改」后的撤销，
以及迁移前已有的变更记录（没有条目类型）仍按文件读取。
"""
import sqlite3

import pytest

from app.application.errors.exceptions import AppException
from app.application.services.file_history import FileHistoryService, UndoItem
from app.application.services.root_access import RootBindings, RootFileService
from app.domain.external.workspace_files import FileLimits, FileVersion
from app.domain.models.error import ErrorCode
from app.domain.models.file_change import ChangeSource, EntryKind
from app.domain.models.write_lease import WriterKind
from app.domain.services.file_scope import WriteOwner
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from app.interfaces.schemas.workspace_changes import ChangePreviewResponse, RunChangesResponse, run_summary_view
from tests.core.test_workspaces import Env, scenario
from tests.core.test_write_protection import history, workspace


def entries(env: Env) -> RootFileService:
    bindings = RootBindings(env.read_factory, env.data)
    files = PosixWorkspaceFiles(bindings, FileLimits())
    return RootFileService(bindings, files, env.writer(files))


async def version_of(service: RootFileService, root: str, relative: str) -> FileVersion:
    entry = await service.stat(root, relative)
    assert entry.version is not None
    return entry.version


def code_of(info: AppException) -> ErrorCode:
    return info.info.code


async def expect_error(awaitable, code: ErrorCode) -> AppException:
    with pytest.raises(AppException) as info:
        await awaitable
    assert info.value.info.code is code, info.value.info
    return info.value


async def newest_run(env: Env, ws: str, path: str):
    """最近修改里最新的一条运行，并核对它包含该路径：界面操作每次都是独立的一条记录。"""
    runs = await history(env).recent_runs(ws)
    assert runs, "界面操作应进入最近修改"
    listing = await history(env).changes(ws, runs[0].run_id)
    assert path in {entry.relative_path for entry in listing.entries}, [entry.relative_path for entry in listing.entries]
    return runs[0], listing


def test_entry_operations_are_recorded_as_manual_runs_and_undo_in_reverse(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        root = view.folder.ref.root_id
        service = entries(env)
        (folder / "a.txt").write_text("原始", encoding="utf-8")

        # 新建文件夹：一条运行，记为目录创建
        made = await service.create_folder(root, "", "资料")
        assert made.kind.value == "directory" and (folder / "资料").is_dir()
        run_mk, listing = await newest_run(env, ws, "资料")
        assert run_mk.kind == "manual" and run_mk.run_status == "completed" and run_mk.session_id == ""
        (entry,) = listing.entries
        assert (entry.kind, entry.operation.value, entry.status) == ("directory", "create", "undoable")
        assert ChangePreviewResponse.of(await history(env).preview(ws, run_mk.run_id, "资料")).kind == "directory"
        assert RunChangesResponse.of(listing).model_dump(mode="json")["kind"] == "manual"
        assert run_summary_view(run_mk).kind == "manual"

        # 重命名：原名删除与新名创建同属一组；原文件字节保存为撤销前的备份
        renamed = await service.rename_entry(root, "a.txt", "新名.txt", await version_of(service, root, "a.txt"))
        assert renamed.name == "新名.txt" and not (folder / "a.txt").exists()
        run_rn, listing = await newest_run(env, ws, "新名.txt")
        by_path = {entry.relative_path: entry for entry in listing.entries}
        assert set(by_path) == {"a.txt", "新名.txt"} and run_rn.changed_files == 2
        assert by_path["a.txt"].operation.value == "delete" and by_path["新名.txt"].operation.value == "create"
        assert by_path["a.txt"].before.sha256 is not None

        # 删除文件：需要当前版本；之后删除空文件夹
        removed = await service.delete_entry(root, "新名.txt", await version_of(service, root, "新名.txt"))
        assert removed[1].value == "file" and not (folder / "新名.txt").exists()
        run_del, _ = await newest_run(env, ws, "新名.txt")
        assert run_del.run_id != run_rn.run_id
        removed_dir = await service.delete_entry(root, "资料", None)
        assert removed_dir[1].value == "directory" and not (folder / "资料").exists()
        run_rmdir, listing = await newest_run(env, ws, "资料")
        assert [(entry.kind, entry.operation.value) for entry in listing.entries] == [("directory", "delete")]

        # 撤销按时间倒序：先撤销删空文件夹（重新建立），再撤销删除文件（恢复内容），再撤销重命名（移除新名、恢复旧名）
        restored_dir = await history(env).undo(ws, run_rmdir.run_id, [UndoItem("资料")])
        assert restored_dir[0].status == "restored" and (folder / "资料").is_dir()
        restored_file = await history(env).undo(ws, run_del.run_id, [UndoItem("新名.txt")])
        assert restored_file[0].status == "restored"
        assert (folder / "新名.txt").read_text(encoding="utf-8") == "原始"
        outcomes = await history(env).undo(ws, run_rn.run_id, [UndoItem("a.txt"), UndoItem("新名.txt")])
        assert [outcome.status for outcome in outcomes] == ["restored", "removed"]
        assert (folder / "a.txt").read_text(encoding="utf-8") == "原始" and not (folder / "新名.txt").exists()
        undone = await history(env).undo(ws, run_mk.run_id, [UndoItem("资料")])
        assert undone[0].status == "removed" and not (folder / "资料").exists()

        # 撤销本身也出现在最近修改里，并且是撤销类型
        assert (await history(env).recent_runs(ws))[0].kind == "undo"
    scenario(tmp_path, body)


def test_entry_operations_refuse_conflicts_stale_versions_and_bad_names(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        root = view.folder.ref.root_id
        service = entries(env)
        (folder / "a.txt").write_text("一", encoding="utf-8")
        (folder / "b.txt").write_text("二", encoding="utf-8")
        (folder / "非空").mkdir()
        (folder / "非空" / "inner.txt").write_text("内容", encoding="utf-8")
        version_a = await version_of(service, root, "a.txt")

        # 同名不覆盖：改名到已有文件、新建已有名字的文件夹都冲突
        await expect_error(service.rename_entry(root, "a.txt", "b.txt", version_a), ErrorCode.CONFLICT)
        assert (folder / "a.txt").read_text(encoding="utf-8") == "一"
        await expect_error(service.create_folder(root, "", "非空"), ErrorCode.CONFLICT)
        await expect_error(service.create_folder(root, "", "a.txt"), ErrorCode.CONFLICT)

        # 版本不符：文件已被外部改动，删除与改名都不执行，返回当前版本
        (folder / "a.txt").write_text("外部改动后更长的内容", encoding="utf-8")
        stale = await expect_error(service.delete_entry(root, "a.txt", version_a), ErrorCode.CONFLICT)
        assert stale.info.resource_version is not None and (folder / "a.txt").exists()
        await expect_error(service.rename_entry(root, "a.txt", "c.txt", version_a), ErrorCode.CONFLICT)

        # 非空文件夹不删除；删除文件必须带版本；改名不接受目录与空名
        await expect_error(service.delete_entry(root, "非空", None), ErrorCode.CONFLICT)
        assert (folder / "非空" / "inner.txt").exists()
        await expect_error(service.delete_entry(root, "b.txt", None), ErrorCode.INVALID_REQUEST)
        await expect_error(service.rename_entry(root, "非空", "其他", FileVersion(size=0, modified_ns=0)),
                           ErrorCode.INVALID_REQUEST)
        for name in ("", ".", "..", "x/y", "a\\b", "bad\nname", ".rayagent", "x" * 300):
            await expect_error(service.create_folder(root, "", name), ErrorCode.INVALID_REQUEST)
        await expect_error(service.rename_entry(root, "b.txt", "b.txt", await version_of(service, root, "b.txt")),
                           ErrorCode.INVALID_REQUEST)

        # 大小写只改：同一文件改名成功，目录里只剩新名字
        await service.rename_entry(root, "b.txt", "B.TXT", await version_of(service, root, "b.txt"))
        assert sorted(p.name for p in folder.iterdir() if p.is_file()) == ["B.TXT", "a.txt"]
    scenario(tmp_path, body)


def test_entry_operations_reject_out_of_root_reserved_and_denied_paths(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        root = view.folder.ref.root_id
        service = entries(env)
        (folder / ".env").write_text("K=1", encoding="utf-8")
        (folder / "x.txt").write_text("x", encoding="utf-8")
        (folder / ".git").mkdir()

        for relative in ("../outside.txt", "/etc/passwd", "docs/../../x", "a\x00b"):
            await expect_error(service.delete_entry(root, relative, FileVersion(size=1, modified_ns=1)),
                               ErrorCode.INVALID_REQUEST)
        await expect_error(service.delete_entry(root, ".rayagent/workspace.json", None), ErrorCode.FORBIDDEN)
        await expect_error(service.delete_entry(root, ".git", None), ErrorCode.FORBIDDEN)
        await expect_error(service.delete_entry(root, "", None), ErrorCode.INVALID_REQUEST)
        await expect_error(service.rename_entry(root, ".env", "env.bak", FileVersion(size=3, modified_ns=1)),
                           ErrorCode.FORBIDDEN)
        await expect_error(service.rename_entry(root, "x.txt", ".env", await version_of(service, root, "x.txt")),
                           ErrorCode.FORBIDDEN)
        await expect_error(service.create_folder(root, ".git", "hooks"), ErrorCode.FORBIDDEN)
        await expect_error(service.create_folder(root, "missing", "新"), ErrorCode.NOT_FOUND)
        await expect_error(service.create_folder(root, "x.txt", "新"), ErrorCode.INVALID_REQUEST)
        assert (folder / ".env").exists() and (folder / ".git").is_dir() and (folder / "x.txt").exists()
        assert not (folder.parent / "outside.txt").exists()
    scenario(tmp_path, body)


def test_entry_operations_refuse_archived_and_busy_workspaces(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        root = view.folder.ref.root_id
        service = entries(env)
        (folder / "a.txt").write_text("一", encoding="utf-8")
        version = await version_of(service, root, "a.txt")

        # 归档后只读：三种操作都拒绝，文件与文件夹保持原样
        archived = await env.service.archive(ws, view.workspace.version)
        await expect_error(service.create_folder(root, "", "新"), ErrorCode.FORBIDDEN)
        await expect_error(service.rename_entry(root, "a.txt", "b.txt", version), ErrorCode.FORBIDDEN)
        await expect_error(service.delete_entry(root, "a.txt", version), ErrorCode.FORBIDDEN)
        assert (folder / "a.txt").exists() and not (folder / "新").exists()
        await env.service.unarchive(ws, archived.workspace.version)

        # 另一个会话占用文件夹：返回带占用者的冲突，不改动文件
        other = await env.sessions.create_session(workspace_id=ws)
        lease_id = await env.leases().acquire(ws, WriteOwner(other.id, "run-other", source="tool"), "别人在写",
                                              kind=WriterKind.CORE_TOOL)
        blocked = await expect_error(service.delete_entry(root, "a.txt", version), ErrorCode.CONFLICT)
        assert blocked.info.details["lease"]["owner_run_id"] == "run-other"
        assert (folder / "a.txt").exists()
        await env.leases().release(lease_id)
        await service.delete_entry(root, "a.txt", version)
        assert not (folder / "a.txt").exists()
    scenario(tmp_path, body)


def test_legacy_change_rows_without_entry_kind_read_as_files(tmp_path):
    """0014 之前的变更记录没有条目类型：迁移后按文件读取，撤销行为与升级前一致，记录本身不改动。"""
    from alembic import command
    from app.infrastructure.storage.sqlite import _alembic_config, migrate

    database = tmp_path / "rayagent.db"
    config = _alembic_config(database)
    command.upgrade(config, "0013_usage_total_tokens")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO file_changes (workspace_id, session_id, run_id, tool_call_id, root_id, relative_path, "
            "operation, source, undo_of_run_id, before_object_id, after_size, after_mtime_ns, after_sha256, created_at) "
            "VALUES ('ws-1', 's-1', 'run-old', NULL, 'root-1', 'a.txt', 'delete', 'tool', NULL, NULL, NULL, NULL, NULL, "
            "'2026-01-01 00:00:00')")
        connection.commit()

    assert migrate(database) == "0014_file_change_entries"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT entry_kind, relative_path FROM file_changes").fetchall() == [("file", "a.txt")]

    from app.infrastructure.models.write_protection import FileChangeModel
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    engine = create_engine(f"sqlite:///{database}")
    with Session(engine) as session:
        (row,) = session.query(FileChangeModel).all()
        change = row.to_domain()
        assert change.entry_kind is EntryKind.FILE and change.source is ChangeSource.TOOL and change.run_id == "run-old"
    engine.dispose()
    assert migrate(database) == "0014_file_change_entries"  # 再次打开不重复迁移
