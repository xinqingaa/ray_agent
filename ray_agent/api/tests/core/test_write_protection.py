"""工作区文件夹的写保护：写入租约、写前备份、撤销本次修改、外部变更推送与清空业务数据。

用真实临时目录与真实 SQLite；只覆盖这批机制新增的风险，已有文件 IO 与工作区生命周期的行为见 test_workspace_files、
test_workspaces。
"""
import asyncio
import hashlib
import shutil
from pathlib import Path

import pytest

from app.application.errors.exceptions import AppException, ConflictError, NotFoundError
from app.application.services.background_jobs import BackgroundJobRunner
from app.application.services.data_service import RESET_CONFIRMATION, DataService, data_cleanup_handler
from app.application.services.file_history import FileHistoryService, ForceCurrent, UndoItem
from app.application.services.root_access import RootBindings
from app.application.services.workspace_changes import WorkspaceChangeFeed
from app.domain.external.workspace_files import FileLimits, WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.operation import OperationKind
from app.domain.models.run import Run, RunStatus
from app.domain.models.workspace import FolderStatus
from app.domain.models.write_lease import LeaseState, WriterKind
from app.domain.services.file_scope import WriteOwner
from app.domain.services.tools.file import FileTool
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from app.infrastructure.external.workspace_files.watcher import WatchfilesFolderWatcher
from app.interfaces.schemas.workspace_changes import (
    ChangePreviewResponse, RunChangesResponse, UndoItemResult, run_summary_view,
)
from tests.core.test_workspaces import INSTALL, Env, marker_of, scenario


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def workspace(env: Env, name: str = "项目"):
    view = await env.service.create(name)
    return view, Path(view.folder.location), view.workspace.id


async def run_tool(env: Env, view, run_id: str):
    session = await env.sessions.create_session(workspace_id=view.workspace.id)
    opened = await env.access().open(session.id, view.workspace.id, run_id, ensure=True)
    return session, FileTool(opened.scope), opened


async def write(tool: FileTool, call_id: str, path: str, content: str):
    return await tool.invoke_for_call("write_file", call_id, filepath=path, content=content)


def history(env: Env) -> FileHistoryService:
    files = PosixWorkspaceFiles(RootBindings(env.read_factory, env.data), FileLimits())
    return FileHistoryService(env.uow_factory, env.read_factory, files, env.writer(files), env.objects, env.leases(),
                              preview_bytes=256 * 1024, preview_lines=2000, default_runs=20)


def test_second_session_gets_an_immediate_lease_conflict_and_the_holder_reenters(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        session_a, tool_a, _ = await run_tool(env, view, "run-a")
        _, tool_b, _ = await run_tool(env, view, "run-b")
        leases = env.leases()

        lease_id = await leases.acquire(ws, WriteOwner(session_a.id, "run-a"), "正在写")
        blocked = await write(tool_b, "c1", "b.txt", "B")
        assert not blocked.success and "占用" in blocked.message and "正在写" in blocked.message
        assert not (folder / "b.txt").exists()
        holder = await leases.get(ws)
        assert holder.owner_session_id == session_a.id and holder.owner_run_id == "run-a"

        assert (await write(tool_a, "c2", "a.txt", "A")).success  # 同一运行重入
        assert (await leases.get(ws)).id == lease_id  # 内层写入结束不释放外层持有
        await leases.release(lease_id)
        assert await leases.get(ws) is None

        assert (await write(tool_b, "c3", "b.txt", "B")).success
        assert await leases.get(ws) is None  # 写入结束即释放
    scenario(tmp_path, body)


def test_stop_releases_blocks_and_retries_without_touching_a_newer_lease(tmp_path):
    async def body(env: Env):
        _, _, ws = await workspace(env)
        leases = env.leases()
        owner_a, owner_b = WriteOwner("s-a", "run-a"), WriteOwner("s-b", "run-b")

        await leases.acquire(ws, owner_a, "写")
        await leases.begin_settle("run-a")
        assert (await leases.get(ws)).state is LeaseState.SETTLING
        with pytest.raises(WorkspaceFileError) as info:
            await leases.acquire(ws, owner_b, "写")
        assert info.value.code is ErrorCode.CONFLICT and info.value.details["lease"]["state"] == "settling"

        # 期限内无法确认执行协程退出：转 blocked，重试在仍未确认时保持阻止，确认后释放
        await leases.finish_settle("run-a", confirmed=False)
        assert (await leases.get(ws)).state is LeaseState.BLOCKED
        env.quiescent = False
        with pytest.raises(WorkspaceFileError):
            await leases.retry_settle(ws)
        assert (await leases.get(ws)).state is LeaseState.BLOCKED
        env.quiescent = True
        await leases.retry_settle(ws)
        assert await leases.get(ws) is None

        # 迟到的结果按租约身份释放，不会释放后来取得的租约；运行收尾也只按运行归属处理
        late_id = await leases.acquire(ws, owner_a, "写")
        await leases.finish_settle("run-a", confirmed=True)
        newer_id = await leases.acquire(ws, owner_b, "写")
        assert await leases.release(late_id) is False
        await leases.finish_settle("run-a", confirmed=True)
        assert (await leases.get(ws)).id == newer_id
    scenario(tmp_path, body)


def test_startup_scan_releases_old_core_tool_leases_and_keeps_external_writers_blocked(tmp_path):
    async def body(env: Env):
        _, _, first = await workspace(env, "一")
        _, _, second = await workspace(env, "二")
        old = env.leases("core-instance-old")
        await old.acquire(first, WriteOwner("s1", "run-x"), "旧实例的文件工具")
        await old.acquire(second, WriteOwner("s2", "run-y"), "外部进程", kind=WriterKind.PROCESS)

        released = await env.leases().scan_startup()
        assert [lease.workspace_id for lease in released] == [first]
        assert await env.leases().get(first) is None
        kept = await env.leases().get(second)
        assert kept.state is LeaseState.BLOCKED and kept.writer_kind is WriterKind.PROCESS
    scenario(tmp_path, body)


def test_overwrite_keeps_a_deduplicated_workspace_backup_and_a_failed_backup_blocks_the_write(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / "a.txt").write_text("原始", encoding="utf-8")
        _, tool, _ = await run_tool(env, view, "run-1")

        for call, text in (("c1", "第一次"), ("c2", "第二次"), ("c3", "第一次"), ("c4", "最后")):
            assert (await write(tool, call, "a.txt", text)).success
        assert (await write(tool, "c5", "n.txt", "新文件")).success
        async with env.read_factory() as uow:
            rows = await uow.change.for_run(ws, "run-1")
            backups = await uow.change.get_objects(ws, [row.before_object_id for row in rows if row.before_object_id])
        assert [(row.relative_path, row.operation.value, row.tool_call_id) for row in rows] == [
            ("a.txt", "modify", "c1"), ("a.txt", "modify", "c2"), ("a.txt", "modify", "c3"),
            ("a.txt", "modify", "c4"), ("n.txt", "create", "c5")]
        assert backups[rows[0].before_object_id].sha256 == sha("原始")
        assert backups[rows[1].before_object_id].sha256 == sha("第一次")
        assert rows[3].before_object_id == rows[1].before_object_id  # 同内容在工作区内只保存一份
        assert rows[4].before_object_id is None and rows[3].after.sha256 == sha("最后")

        original = env.objects.put

        async def full_disk(workspace_id, source):
            raise WorkspaceFileError(ErrorCode.UNAVAILABLE, "磁盘空间不足，已停止发布新版本")
        env.objects.put = full_disk
        refused = await write(tool, "c6", "a.txt", "不应写入")
        env.objects.put = original
        assert not refused.success and "磁盘空间不足" in refused.message
        assert (folder / "a.txt").read_text(encoding="utf-8") == "最后"
        assert await env.leases().get(ws) is None
        async with env.read_factory() as uow:
            assert len(await uow.change.for_run(ws, "run-1")) == len(rows)
    scenario(tmp_path, body)


def test_undo_restores_the_pre_run_versions_and_removes_only_files_the_run_created(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / "a.txt").write_text("原始", encoding="utf-8")
        (folder / "b.txt").write_text("会被删除", encoding="utf-8")
        (folder / "other.txt").write_text("无关文件", encoding="utf-8")
        session, tool, opened = await run_tool(env, view, "run-1")
        assert (await write(tool, "c1", "a.txt", "第一次")).success
        assert (await write(tool, "c2", "a.txt", "第二次")).success
        assert (await write(tool, "c3", "new.txt", "新建")).success
        scope = opened.scope
        target = scope.resolve("b.txt")
        await scope.delete(target, (await scope.files.stat(target)).version)
        assert not (folder / "b.txt").exists()

        service = history(env)
        listing = await service.changes(ws, "run-1")
        entries = {entry.relative_path: entry for entry in listing.entries}
        assert set(entries) == {"a.txt", "new.txt", "b.txt"} and not listing.run_active
        assert (entries["a.txt"].operation.value, entries["a.txt"].writes, entries["a.txt"].status) == (
            "modify", 2, "undoable")
        assert entries["a.txt"].before.sha256 == sha("原始") and entries["a.txt"].after.sha256 == sha("第二次")
        assert (entries["new.txt"].operation.value, entries["b.txt"].operation.value) == ("create", "delete")
        assert all(entry.status == "undoable" for entry in entries.values())
        preview = await service.preview(ws, "run-1", "a.txt")
        assert preview.kind == "diff" and "-第二次" in preview.diff and "+原始" in preview.diff
        wire = RunChangesResponse.of(listing).model_dump(mode="json")  # 接口投影能序列化
        assert {entry["relative_path"]: entry["status"] for entry in wire["entries"]}["a.txt"] == "undoable"
        assert ChangePreviewResponse.of(preview).model_dump(mode="json")["kind"] == "diff"
        assert [run_summary_view(run).changed_files for run in await service.recent_runs(ws)] == [3]

        with pytest.raises(NotFoundError):
            await service.undo(ws, "run-1", [UndoItem("other.txt")])  # 与本运行无关的文件不会被处理
        outcomes = await service.undo(ws, "run-1", [UndoItem("a.txt"), UndoItem("new.txt"), UndoItem("b.txt")])
        assert [outcome.status for outcome in outcomes] == ["restored", "removed", "restored"]
        assert UndoItemResult.of(outcomes[0]).model_dump(mode="json")["status"] == "restored"
        assert (folder / "a.txt").read_text(encoding="utf-8") == "原始"
        assert not (folder / "new.txt").exists()
        assert (folder / "b.txt").read_text(encoding="utf-8") == "会被删除"
        assert (folder / "other.txt").read_text(encoding="utf-8") == "无关文件"
        async with env.read_factory() as uow:
            assert await uow.change.object_by_hash(ws, sha("第二次")) is not None  # 撤销前备份
            assert await uow.change.object_by_hash(ws, sha("新建")) is not None
        assert await env.leases().get(ws) is None
        assert [entry.status for entry in (await service.changes(ws, "run-1")).entries] == ["restored"] * 3
        again = await service.undo(ws, "run-1", [UndoItem("a.txt")])
        assert again[0].status == "unchanged"

        # 撤销本身也是一次可列出、可撤回的操作：撤销前备份的版本能找回
        runs = {run.run_id: run for run in await service.recent_runs(ws)}
        undo_run = next(run for run in runs.values() if run.kind == "undo")
        assert set(runs) == {"run-1", undo_run.run_id} and runs["run-1"].kind == "run"
        assert undo_run.undo_of_run_id == "run-1" and undo_run.changed_files == 3
        assert run_summary_view(undo_run).kind == "undo"
        listing = await service.changes(ws, undo_run.run_id)
        assert listing.kind == "undo" and listing.undo_of_run_id == "run-1" and not listing.run_active
        reverted = await service.undo(ws, undo_run.run_id, [UndoItem("a.txt"), UndoItem("new.txt"), UndoItem("b.txt")])
        assert [outcome.status for outcome in reverted] == ["restored", "restored", "removed"]
        assert (folder / "a.txt").read_text(encoding="utf-8") == "第二次"
        assert (folder / "new.txt").read_text(encoding="utf-8") == "新建" and not (folder / "b.txt").exists()
        assert (await service.changes(ws, "run-1")).entries[0].relative_path  # 原运行记录不受影响

        # 另一个会话占用文件夹时，撤销整体返回带占用者的冲突，且不改动文件
        assert (await write(tool, "c4", "a.txt", "又改了")).success
        other_session, _, _ = await run_tool(env, view, "run-2")
        lease_id = await env.leases().acquire(ws, WriteOwner(other_session.id, "run-2"), "别人在写")
        with pytest.raises(AppException) as info:
            await service.undo(ws, "run-1", [UndoItem("a.txt")])
        assert info.value.info.code is ErrorCode.CONFLICT and info.value.info.details["lease"]["owner_run_id"] == "run-2"
        assert (folder / "a.txt").read_text(encoding="utf-8") == "又改了"
        await env.leases().release(lease_id)

        # 运行仍在进行时不能撤销
        async with env.uow_factory() as uow:
            await uow.run.create(Run(id="run-live", session_id=session.id, status=RunStatus.RUNNING))
        live_tool = FileTool((await env.access().open(session.id, view.workspace.id, "run-live", ensure=True)).scope)
        assert (await write(live_tool, "c9", "live.txt", "进行中")).success
        with pytest.raises(ConflictError):
            await service.undo(ws, "run-live", [UndoItem("live.txt")])
        assert (folder / "live.txt").exists()
    scenario(tmp_path, body)


def test_undo_does_not_silently_drop_an_external_edit_made_between_two_writes_of_the_same_run(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / "a.txt").write_text("原始A", encoding="utf-8")
        _, tool, opened = await run_tool(env, view, "run-1")
        assert (await write(tool, "c1", "a.txt", "运行第一次")).success
        (folder / "a.txt").write_text("用户在运行期间改的内容，比较长", encoding="utf-8")
        assert (await write(tool, "c2", "a.txt", "运行第二次")).success
        assert (await write(tool, "c3", "n.txt", "运行新建")).success
        (folder / "n.txt").write_text("用户改写的新文件，也比较长", encoding="utf-8")
        scope = opened.scope
        target = scope.resolve("n.txt")
        await scope.delete(target, (await scope.files.stat(target)).version)  # 新建后被外部改写，又被运行删除

        service = history(env)
        entries = {entry.relative_path: entry for entry in (await service.changes(ws, "run-1")).entries}
        assert set(entries) == {"a.txt", "n.txt"}  # 新建后删除通常没有净变化，但这里外部版本被删掉了，要能看到
        for entry in entries.values():
            assert (entry.status, entry.conflict_reason, entry.can_force) == ("conflict", "modified_during_run", True)
        assert entries["n.txt"].operation.value == "delete"
        assert [run.changed_files for run in await service.recent_runs(ws)] == [2]
        assert (await service.preview(ws, "run-1", "a.txt")).warning
        assert "modified_during_run" in RunChangesResponse.of(await service.changes(ws, "run-1")).model_dump_json()

        first = await service.undo(ws, "run-1", [UndoItem("a.txt"), UndoItem("n.txt")])
        assert [outcome.status for outcome in first] == ["conflict", "conflict"]
        assert (folder / "a.txt").read_text(encoding="utf-8") == "运行第二次" and not (folder / "n.txt").exists()
        seen = [ForceCurrent(True, outcome.current.size, outcome.current.modified_ns) if outcome.current
                else ForceCurrent(False) for outcome in first]
        forced = await service.undo(ws, "run-1", [UndoItem("a.txt", seen[0]), UndoItem("n.txt", seen[1])])
        assert [outcome.status for outcome in forced] == ["restored", "restored"]
        assert (folder / "a.txt").read_text(encoding="utf-8") == "原始A"
        assert (folder / "n.txt").read_text(encoding="utf-8") == "用户改写的新文件，也比较长"
    scenario(tmp_path, body)


def test_undo_conflicts_after_external_edits_and_only_an_explicit_force_overwrites(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / "c.txt").write_text("原始C", encoding="utf-8")
        _, tool, _ = await run_tool(env, view, "run-1")
        assert (await write(tool, "c1", "c.txt", "智能体版本")).success
        assert (await write(tool, "c2", "d.txt", "智能体新建")).success
        (folder / "c.txt").write_text("用户后来改的内容", encoding="utf-8")
        (folder / "d.txt").write_text("用户改过的新文件", encoding="utf-8")
        service = history(env)

        entries = {entry.relative_path: entry for entry in (await service.changes(ws, "run-1")).entries}
        assert entries["c.txt"].status == entries["d.txt"].status == "conflict"
        assert entries["c.txt"].can_force and not entries["d.txt"].can_force

        first = (await service.undo(ws, "run-1", [UndoItem("c.txt"), UndoItem("d.txt")]))
        assert [outcome.status for outcome in first] == ["conflict", "conflict"]
        assert (folder / "c.txt").read_text(encoding="utf-8") == "用户后来改的内容"
        assert (folder / "d.txt").read_text(encoding="utf-8") == "用户改过的新文件"  # 改动过的新建文件不删除

        current = first[0].current
        stale = ForceCurrent(exists=True, size=current.size + 1, modified_ns=current.modified_ns)
        assert (await service.undo(ws, "run-1", [UndoItem("c.txt", force=stale)]))[0].status == "conflict"
        forced = await service.undo(ws, "run-1", [
            UndoItem("c.txt", force=ForceCurrent(exists=True, size=current.size, modified_ns=current.modified_ns))])
        assert forced[0].status == "restored"
        assert (folder / "c.txt").read_text(encoding="utf-8") == "原始C"
        async with env.read_factory() as uow:
            assert await uow.change.object_by_hash(ws, sha("用户后来改的内容")) is not None  # 覆盖前先备份

        # 新建的文件即使带 force 也不删除
        forced_new = await service.undo(ws, "run-1", [UndoItem("d.txt", force=ForceCurrent(exists=True))])
        assert forced_new[0].status == "conflict" and (folder / "d.txt").exists()
    scenario(tmp_path, body)



def test_force_version_round_trips_over_http_without_losing_nanoseconds(tmp_path):
    import os
    import httpx
    from fastapi import FastAPI
    from app.interfaces.endpoints.workspace_history_routes import router
    from app.interfaces.service_dependencies import get_file_history

    async def body(env: Env):
        view, folder, ws = await workspace(env)
        path = folder / "note.txt"
        path.write_text("运行前", encoding="utf-8")
        _, tool, _ = await run_tool(env, view, "run-http")
        assert (await write(tool, "c1", "note.txt", "运行写入")).success
        path.write_text("外部修改", encoding="utf-8")
        os.utime(path, ns=(1770000000123456789, 1770000000123456789))
        stamp = path.stat().st_mtime_ns
        assert stamp > 2**53
        service = history(env)
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_file_history] = lambda: service
        base = f"/api/workspaces/{ws}/runs/run-http"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            entry = (await client.get(f"{base}/changes")).json()["data"]["entries"][0]
            assert entry["current"]["modified_ns"] == str(stamp)
            force = {"exists": True, "size": entry["current"]["size"], "modified_ns": str(stamp)}

            async def undo(version):
                return await client.post(f"{base}/undo", json={"items": [{"relative_path": "note.txt", "force": version}]})

            # 不接受可能已经丢失精度的数字，也不接受非整数字符串。
            for invalid in (float(stamp), "1.77e18", "not-a-version"):
                assert (await undo({**force, "modified_ns": invalid})).status_code == 422
            stale = await undo({**force, "modified_ns": str(stamp + 1)})
            assert stale.json()["data"]["results"][0]["status"] == "conflict"
            assert path.read_text(encoding="utf-8") == "外部修改"
            latest = stale.json()["data"]["results"][0]["current"]
            response = await undo({"exists": True, "size": latest["size"], "modified_ns": latest["modified_ns"]})
            assert response.json()["data"]["results"][0]["status"] == "restored"
            assert path.read_text(encoding="utf-8") == "运行前"
            async with env.read_factory() as uow:
                assert await uow.change.object_by_hash(ws, sha("外部修改")) is not None
    scenario(tmp_path, body)


def test_external_changes_are_pushed_and_a_moved_folder_becomes_unavailable(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        files = PosixWorkspaceFiles(RootBindings(env.read_factory, env.data), FileLimits())
        feed = WorkspaceChangeFeed(env.uow_factory, env.read_factory, env.folders, files,
                                   WatchfilesFolderWatcher(50, 200), probe_seconds=0.2, rescan_seconds=0.5,
                                   paths_per_event=200)
        stream = feed.stream(ws)

        async def until(predicate):
            async def pump():
                async for event in stream:
                    if predicate(event):
                        return event
            return await asyncio.wait_for(pump(), 10)

        ready = await anext(stream)
        assert ready.kind == "ready" and ready.available
        await asyncio.sleep(0.5)  # 监视建立之后再改动
        (folder / "外部.txt").write_text("x", encoding="utf-8")
        changed = await until(lambda event: event.kind == "changed" and ("外部.txt" in event.paths or event.refresh))
        assert changed.available

        moved = folder.parent / "moved-away"
        folder.rename(moved)
        lost = await until(lambda event: event.kind == "availability" and not event.available)
        assert lost.reason
        async with env.read_factory() as uow:
            assert (await uow.root.workspace_folder(ws)).status is FolderStatus.UNAVAILABLE
        moved.rename(folder)
        assert (await until(lambda event: event.kind == "availability" and event.available)).available
        await stream.aclose()
        await feed.shutdown()
    scenario(tmp_path, body)


def test_relocate_rebinds_without_marker_refuses_busy_or_taken_targets_and_retargets_the_watcher(tmp_path):
    async def body(env: Env):
        view, old, ws = await workspace(env)
        session = await env.sessions.create_session(workspace_id=ws)
        target = env.folder("新位置")
        version = view.workspace.version
        wrong = env.grant(target)
        with pytest.raises(ConflictError):
            await env.service.relocate(ws, wrong, version + 1)

        # 有写入租约或活动运行时不改绑
        lease_id = await env.leases().acquire(ws, WriteOwner(session.id, "run-a"), "写")
        with pytest.raises(ConflictError) as busy:
            await env.service.relocate(ws, env.grant(target), version)
        assert busy.value.info.details["lease"]["id"] == lease_id
        await env.leases().release(lease_id)
        async with env.uow_factory() as uow:
            await uow.run.create(Run(id="run-live", session_id=session.id, status=RunStatus.RUNNING))
        with pytest.raises(ConflictError) as running:
            await env.service.relocate(ws, env.grant(target), version)
        assert running.value.info.details["run_id"] == "run-live"
        async with env.uow_factory() as uow:
            await uow.run.transition("run-live", RunStatus.COMPLETED)

        # 目标已绑定其他工作区，或标记属于本机另一个工作区
        other, other_folder, other_id = await workspace(env, "另一个")
        with pytest.raises(ConflictError) as bound:
            await env.service.relocate(ws, env.grant(other_folder), version)
        assert bound.value.info.details["reason"] == "already_bound"
        copied = env.folder("副本")
        shutil.copytree(other_folder / ".rayagent", copied / ".rayagent")
        with pytest.raises(ConflictError) as marked:
            await env.service.relocate(ws, env.grant(copied), version)
        assert marked.value.info.details == {"reason": "marker_other_workspace", "workspace_id": other_id,
                                             "workspace_name": "另一个"}

        # 标记不可写时仍可改绑：位置、身份与可用性更新，旧位置的标记条目被移除
        files = PosixWorkspaceFiles(RootBindings(env.read_factory, env.data), FileLimits())
        feed = WorkspaceChangeFeed(env.uow_factory, env.read_factory, env.folders, files,
                                   WatchfilesFolderWatcher(50, 200), probe_seconds=0.2, rescan_seconds=0.5,
                                   paths_per_event=200)
        stream = feed.stream(ws)
        assert (await anext(stream)).available
        target.chmod(0o555)
        try:
            moved = await env.service.relocate(ws, env.grant(target), version)
        finally:
            target.chmod(0o755)
        assert moved.folder.location == str(target.resolve()) and moved.folder.status is FolderStatus.AVAILABLE
        assert moved.folder.marker_writable is False and moved.workspace.version > version
        assert not (old / ".rayagent" / "workspace.json").exists()
        assert not (target / ".rayagent").exists()

        # 外部变更订阅切到新位置：旧位置不再触发，新位置的改动被推送
        await feed.restart(ws)
        await asyncio.sleep(0.5)
        (old / "旧.txt").write_text("x", encoding="utf-8")
        (target / "新.txt").write_text("x", encoding="utf-8")

        async def pump():
            async for event in stream:
                assert "旧.txt" not in event.paths
                if event.kind == "changed" and "新.txt" in event.paths:
                    return event
        assert (await asyncio.wait_for(pump(), 10)).available
        await stream.aclose()
        await feed.shutdown()
    scenario(tmp_path, body)


def test_file_tools_refuse_credentials_and_vcs_internals_in_the_workspace_folder_only(tmp_path):
    async def body(env: Env):
        view, folder, ws = await workspace(env)
        (folder / ".env").write_text("SECRET=1", encoding="utf-8")
        (folder / ".hg").mkdir()
        (folder / ".hg" / "hgrc").write_text("[ui]", encoding="utf-8")
        _, tool, opened = await run_tool(env, view, "run-1")

        refused = [await tool.invoke_for_call("read_file", "r1", filepath=".env"),
                   await tool.invoke_for_call("read_file", "r2", filepath=".hg/hgrc"),
                   await write(tool, "w1", ".git/config", "改坏"),
                   await write(tool, "w2", "server.pem", "KEY"),
                   await write(tool, "w3", "data/app.sqlite", "db"),
                   await tool.invoke_for_call("read_file", "r3", filepath=".rayagent/workspace.json")]
        assert all(not result.success and "不允许" in result.message for result in refused), [r.message for r in refused]
        assert (folder / ".env").read_text(encoding="utf-8") == "SECRET=1"
        assert (folder / ".hg" / "hgrc").read_text(encoding="utf-8") == "[ui]"
        assert not (folder / ".git").exists() and not (folder / "server.pem").exists()
        assert not (folder / "data").exists()

        # 依赖缓存目录只从列举与扫描里排除，显式读写仍然允许；会话工作目录不受这条规则影响
        assert (await write(tool, "w4", "node_modules/pkg/index.js", "module.exports = 1")).success
        assert (await write(tool, "w5", str(opened.workdir.path / ".env"), "scratch")).success
    scenario(tmp_path, body)


def test_clearing_business_data_removes_workspaces_and_backups_but_never_user_files(tmp_path):
    from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage

    async def run(uow_factory, read_factory, database):
        jobs = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        env = Env(tmp_path, uow_factory, read_factory, jobs=jobs)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        jobs.register(OperationKind.DATA_CLEANUP,
                      data_cleanup_handler(env.folders, storage.remove_key, env.workdirs.remove),
                      requeue_on_restart=True)
        view, folder, ws = await workspace(env, "清空")
        (folder / "用户.txt").write_text("用户文件", encoding="utf-8")
        session, tool, _ = await run_tool(env, view, "run-1")
        assert (await write(tool, "c1", "用户.txt", "改过")).success
        async with read_factory() as uow:
            rows = await uow.change.for_run(ws, "run-1")
            backup = (await uow.change.get_objects(ws, [rows[0].before_object_id]))[rows[0].before_object_id]
        assert storage.object_path(backup.key).is_file()
        residue = await env.leases().acquire(ws, WriteOwner(session.id, "run-2"), "残留租约")

        data = DataService(uow_factory, jobs, INSTALL)
        assert (await data.preview()).counts["workspaces"] == 1
        # 写入者还在（含没有运行身份的上传与撤销）时不清空，否则写前备份会落进已回收的范围
        assert (await data.preview()).blocked_reason
        with pytest.raises(ConflictError):
            await data.start(RESET_CONFIRMATION)
        await env.leases().mark(residue, LeaseState.BLOCKED)  # 停止后未能确认静止的残留租约不阻止清空
        jobs.start()
        task = await data.start(RESET_CONFIRMATION)
        for _ in range(200):
            task = await data.get(task.id)
            if task.state != "running":
                break
            await asyncio.sleep(0.02)
        await jobs.stop()
        assert task.state == "completed", task.error

        assert folder.is_dir() and (folder / "用户.txt").read_text(encoding="utf-8") == "改过"  # 文件夹与用户文件都在
        assert not storage.object_path(backup.key).exists()
        async with read_factory() as uow:
            assert await uow.workspace.list() == [] and await uow.root.workspace_folders() == []
            assert await uow.change.for_run(ws, "run-1") == [] and await uow.lease.list() == []
            assert await uow.session.get_by_id(session.id) is None
        marker = folder / ".rayagent" / "workspace.json"
        assert not marker.exists() or INSTALL not in [entry["install_id"] for entry in marker_of(folder)["entries"]]
    from tests.support.sqlite_db import with_database
    with_database(tmp_path, run)
