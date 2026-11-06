"""真实 SQLite 业务库上的运行、事件、输入与后台任务：并发冲突、唯一约束、崩溃窗口、通知失败、旧代次回调与忙碌。

每个用例在 pytest 临时目录建立独立数据根并执行迁移，不连接外部服务。
"""
import asyncio
import os
import sqlite3
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.application.errors.exceptions import ConflictError
from app.application.services import agent_service as agent_service_module
from app.application.services.agent_service import AgentService, pending_starts
from app.application.services.background_jobs import BackgroundJobRunner, JobContext, cleanup_handler, cleanup_job
from app.application.services.session_service import SessionService
from app.domain.models.background_job import BackgroundJob
from app.domain.models.event import (
    ApprovalEvent, AttemptEvent, AttemptReason, ContextEvent, DoneEvent, MessageEvent, RunEvent, ToolEvent, TurnEvent,
    TurnPhase, TurnUsage,
)
from app.domain.models.operation import OperationKind, OperationScope, OperationScopeKind, OperationStatus
from app.domain.models.run import RunStatus
from app.domain.models.run_input import RunInputStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.run_repository import ActiveRunExistsError
from app.domain.services.approvals import interrupt_waiting_approvals
from app.domain.services.request_rebuild import rebuild_request
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.workdir.session_workdir import SessionWorkdirs
from app.infrastructure.storage.sqlite import DataRootLocked, DatabaseBusyError, InstanceLock, SchemaTooNew, migrate
from tests.support.loop_harness import MemoryNotifier, input_task, make_loop, make_runner, resume_run, start_run
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text as reply, tool_call, usage
from tests.support.sqlite_db import factories, open_database, with_database


async def new_session(uow_factory, session_id="sqlite-session") -> Session:
    session = Session(id=session_id)
    async with uow_factory() as uow:
        await uow.session.save(session)
    return session


async def read(read_factory, session_id):
    async with read_factory() as uow:
        session = await uow.session.get_by_id(session_id)
        runs = await uow.run.list_by_session(session_id)
        events = await uow.event.list(session_id)
    return session, runs, events


def service_for(uow_factory, read_factory, ledger, notifier=None):
    service = AgentService.__new__(AgentService)
    service._uow_factory, service._read_uow_factory = uow_factory, read_factory
    service._uow, service._ledger, service._notifier = uow_factory(), ledger, notifier
    return service


async def deferred_violation(uow) -> None:
    """推迟外键检查并写入一条悬空引用：语句本身成功，提交（COMMIT）时才失败。"""
    await uow.db_session.execute(text("PRAGMA defer_foreign_keys = ON"))
    await uow.db_session.execute(text(
        "INSERT INTO run_inputs (session_id, run_id, message_seq, status, created_at) "
        "VALUES ('missing-session', 'missing-run', 1, 'pending', '2026-11-06 00:00:00')"))


# 序号、唯一约束与串行写入 --------------------------------------------------------

def test_concurrent_writes_are_serialized_with_continuous_seq(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        notifier = MemoryNotifier()
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        writes = [ledger.append(session.id, [MessageEvent(message=f"m{i}")], run_id=run.id if i % 2 else None)
                  for i in range(100)]
        results = await asyncio.gather(*writes)
        _, _, events = await read(read_factory, session.id)
        assert [e.seq for e in events] == list(range(1, 102))
        assert sorted(written[0].seq for written in results) == list(range(2, 102))
        assert sorted(notifier.published) == list(range(1, 102))
        async with read_factory() as uow:
            assert (await uow.db_session.execute(text(
                "SELECT next_event_seq FROM sessions WHERE id = :id"), {"id": session.id})).scalar_one() == 102
    with_database(tmp_path, scenario)


def test_write_transactions_never_overlap_and_nested_writes_fail_fast(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        active, peak = 0, 0

        async def writer(index):
            nonlocal active, peak
            async with uow_factory() as uow:
                active += 1
                peak = max(peak, active)
                await asyncio.sleep(0.005)
                await uow.event.add(session.id, MessageEvent(message=f"w{index}"))
                active -= 1
        await asyncio.gather(*(writer(i) for i in range(20)))
        assert peak == 1
        async with uow_factory():
            with pytest.raises(RuntimeError, match="嵌套写事务"):
                async with uow_factory():
                    pass
        async with read_factory() as uow:
            with pytest.raises(Exception, match="readonly"):
                await uow.db_session.execute(text("DELETE FROM sessions"))
    with_database(tmp_path, scenario)


def test_at_most_one_active_run_and_unique_session_seq(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        other = await new_session(uow_factory, "sqlite-other")
        ledger = RunLedger(uow_factory)
        results = await asyncio.gather(*[ledger.start(session.id) for _ in range(5)], return_exceptions=True)
        started = [r for r in results if not isinstance(r, BaseException)]
        assert len(started) == 1
        assert all(isinstance(r, ActiveRunExistsError) for r in results if isinstance(r, BaseException))
        first = started[0]
        await ledger.transition(session.id, first.id, RunStatus.WAITING)
        with pytest.raises(ActiveRunExistsError):
            await ledger.start(session.id)
        assert await ledger.start(other.id) is not None
        await ledger.transition(session.id, first.id, RunStatus.COMPLETED)
        second = await ledger.start(session.id)
        _, runs, events = await read(read_factory, session.id)
        assert [(r.id, r.status) for r in runs] == [(first.id, RunStatus.COMPLETED), (second.id, RunStatus.RUNNING)]
        assert [(e.run_id, e.status) for e in events if isinstance(e, RunEvent)] == [
            (first.id, "running"), (first.id, "waiting"), (first.id, "completed"), (second.id, "running")]

        # 绕过仓库复核直接写入时，条件唯一索引与主键仍然拒绝
        async with uow_factory() as uow:
            with pytest.raises(IntegrityError):
                async with uow.db_session.begin_nested():
                    await uow.db_session.execute(text(
                        "INSERT INTO runs (id, session_id, status, mode, started_at, turns, model_requests, tool_calls,"
                        " prompt_tokens, completion_tokens, config_snapshot) VALUES ('dup', :s, 'waiting', 'normal',"
                        " '2026-11-06 00:00:00', 0, 0, 0, 0, 0, '{}')"), {"s": session.id})
            with pytest.raises(IntegrityError):
                async with uow.db_session.begin_nested():
                    await uow.db_session.execute(text(
                        "INSERT INTO events (session_id, seq, type, payload, created_at) "
                        "VALUES (:s, 1, 'message', '{}', '2026-11-06 00:00:00')"), {"s": session.id})
    with_database(tmp_path, scenario)


# 提交失败、通知失败与订阅补读 -------------------------------------------------------

def test_commit_failure_leaves_nothing_visible_and_publishes_nothing(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        notifier = MemoryNotifier()
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        published = list(notifier.published)
        with pytest.raises(IntegrityError, match="FOREIGN KEY"):
            await ledger.transition(session.id, run.id, RunStatus.COMPLETED,
                                    events_before=[MessageEvent(message="boom"), DoneEvent()], apply=deferred_violation)
        with pytest.raises(IntegrityError, match="FOREIGN KEY"):
            await ledger.append(session.id, [MessageEvent(message="boom")], run_id=run.id, apply=deferred_violation)
        stored, runs, events = await read(read_factory, session.id)
        assert [e.type for e in events] == ["run"]
        assert runs[0].status == RunStatus.RUNNING and runs[0].ended_at is None
        assert stored.status == SessionStatus.RUNNING
        assert notifier.published == published
        # 回滚后序号不出现空洞，写协调器仍可用
        await ledger.append(session.id, [MessageEvent(message="after")], run_id=run.id)
        assert [e.seq for e in (await read(read_factory, session.id))[2]] == [1, 2]
    with_database(tmp_path, scenario)


def test_notification_failure_after_commit_keeps_events_and_subscribers_catch_up(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_service_module, "FALLBACK_POLL_SECONDS", 0.2)

    class BrokenNotifier(MemoryNotifier):
        broken = False

        async def publish(self, session_id, seq):
            self.published.append(seq)
            if self.broken:
                raise RuntimeError("通知通道不可用")
            for queue in list(self._queues):
                queue.put_nowait(seq)

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        notifier = BrokenNotifier()
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        service = service_for(uow_factory, read_factory, ledger, notifier)
        stream = service.stream_events(session.id, after_seq=1)
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0.05)
        notifier.broken = True
        written = await ledger.append(session.id, [MessageEvent(message="通知失败")], run_id=run.id)
        assert written and written[0].seq == 2
        event = await asyncio.wait_for(pending, 2)
        assert event.message == "通知失败" and event.seq == 2
        _, _, events = await read(read_factory, session.id)
        assert [e.seq for e in events] == [1, 2]
        await stream.aclose()
    with_database(tmp_path, scenario)


def test_sse_catch_up_gap_and_dropped_notification(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_service_module, "FALLBACK_POLL_SECONDS", 0.3)

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory)
        run = await ledger.start(session.id)
        for i in range(3):
            await ledger.append(session.id, [MessageEvent(message=f"历史{i}")], run_id=run.id)

        class GapNotifier(MemoryNotifier):
            async def subscribe(self, session_id):
                await ledger.append(session_id, [MessageEvent(message="订阅空档")], run_id=run.id)
                return await super().subscribe(session_id)

        notifier = GapNotifier()
        ledger._notifier = notifier
        service = service_for(uow_factory, read_factory, ledger, notifier)
        stream = service.stream_events(session.id, after_seq=2)
        received = []

        async def take(n):
            for _ in range(n):
                received.append(await asyncio.wait_for(anext(stream), 5))

        await take(3)
        assert [e.seq for e in received] == [3, 4, 5] and received[-1].message == "订阅空档"
        await ledger.append(session.id, [MessageEvent(message="正常通知")], run_id=run.id)
        await take(1)
        assert received[-1].message == "正常通知"
        notifier.drop = True
        loop = asyncio.get_running_loop()
        begin = loop.time()
        await ledger.append(session.id, [MessageEvent(message="通知丢失")], run_id=run.id)
        await take(1)
        assert received[-1].message == "通知丢失" and loop.time() - begin < 2
        await stream.aclose()
    with_database(tmp_path, scenario)


# 受理与幂等 --------------------------------------------------------------------

def test_double_request_race_accepts_once_and_conflicts_on_different_content(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        service = service_for(uow_factory, read_factory, ledger)
        service._create_task = AsyncMock(return_value=SimpleNamespace(invoke=AsyncMock(), cancel=lambda: True))
        results = await asyncio.gather(*[service.chat(session.id, "同一请求", request_id="req-1") for _ in range(4)])
        assert len({(r.run_id, r.seq, r.route) for r in results}) == 1
        for start in list(pending_starts().values()):
            await start.worker
        _, runs, events = await read(read_factory, session.id)
        assert len(runs) == 1 and [e.message for e in events if isinstance(e, MessageEvent)] == ["同一请求"]
        async with read_factory() as uow:
            inputs = await uow.run_input.pending(runs[0].id)
        assert [item.message_seq for item in inputs] == [results[0].seq] and inputs[0].request_id == "req-1"
        assert await service.accepted_request(session.id, "req-1") == results[0]
        with pytest.raises(ConflictError):
            await service.chat(session.id, "另一内容", request_id="req-1")
        with pytest.raises(Exception, match="受理记录"):
            await service.accepted_request(session.id, "never-sent")
        assert len([e for e in (await read(read_factory, session.id))[2] if isinstance(e, MessageEvent)]) == 1
    with_database(tmp_path, scenario)


def test_first_message_title_reads_config_through_the_service_factories(tmp_path, monkeypatch):
    from app.application.services import title_service
    loaded = []

    async def auto_generate(self, session_id, first_message):
        loaded.append((await self._config()).llm_config.model_name)

    monkeypatch.setattr(title_service.TitleService, "auto_generate", auto_generate)

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        service = service_for(uow_factory, read_factory, RunLedger(uow_factory, MemoryNotifier()))
        service._create_task = AsyncMock(return_value=SimpleNamespace(invoke=AsyncMock(), cancel=lambda: True))
        await service.chat(session.id, "第一条消息")
        for start in list(pending_starts().values()):
            await start.worker
        for _ in range(50):
            if loaded:
                break
            await asyncio.sleep(0.02)
        assert loaded == ["deepseek-flash"]
    with_database(tmp_path, scenario)


# 崩溃窗口：输入受理与消费之间 ------------------------------------------------------

def test_crash_between_acceptance_and_consumption_keeps_input_visible_and_resumable(tmp_path):
    async def scenario():
        database = await open_database(tmp_path)
        uow_factory, read_factory = factories(database)
        session = await new_session(uow_factory, "crash-session")
        ledger = RunLedger(uow_factory, MemoryNotifier())
        service = service_for(uow_factory, read_factory, ledger)
        service._create_task = AsyncMock(side_effect=asyncio.CancelledError())  # 进程在执行开始前退出
        accepted = await service.chat(session.id, "崩溃前受理", request_id="crash-1")
        await asyncio.gather(*(start.worker for start in pending_starts().values()), return_exceptions=True)
        await database.shutdown()

        database = await open_database(tmp_path)  # 重启：新的连接与启动扫描
        uow_factory, read_factory = factories(database)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        interrupted = await ledger.interrupt_running()
        assert [run.id for run in interrupted] == [accepted.run_id]
        sessions = SessionService(uow_factory, read_factory)
        detail = await sessions.get_session_detail(session.id)
        assert detail.session.status == SessionStatus.INTERRUPTED
        assert [(i.run_id, i.message_seq, i.request_id) for i in detail.unconsumed_inputs] == [
            (accepted.run_id, accepted.seq, "crash-1")]

        service = service_for(uow_factory, read_factory, ledger)
        created = []

        async def create_task(s, run_id, prior_status, approval=None):
            created.append((run_id, prior_status))
            return SimpleNamespace(invoke=AsyncMock(), cancel=lambda: True)
        service._create_task = create_task
        resumed = await service.resume_input(session.id, detail.unconsumed_inputs[0].id)
        await asyncio.gather(*(start.worker for start in pending_starts().values()))
        assert resumed.route == "started" and resumed.run_id != accepted.run_id and resumed.seq == accepted.seq
        with pytest.raises(ConflictError):
            await service.resume_input(session.id, detail.unconsumed_inputs[0].id)

        h = make_loop([reply("已处理")], session=detail.session, uow_factory=uow_factory)
        async with read_factory() as uow:
            run = await uow.run.get(resumed.run_id)
        await make_runner(h, run=run, prior_status=SessionStatus.INTERRUPTED).invoke(input_task())
        stored, runs, events = await read(read_factory, session.id)
        assert stored.status == SessionStatus.COMPLETED
        assert [m.message for m in events if isinstance(m, MessageEvent) and m.role == "user"] == ["崩溃前受理"]
        async with read_factory() as uow:
            item = await uow.run_input.get(detail.unconsumed_inputs[0].id)
            memory = await uow.session.get_memory(session.id, "agent")
        context = next(e for e in events if isinstance(e, ContextEvent) and e.seq == item.consumed_seq)
        assert item.status == RunInputStatus.CONSUMED and context.run_id == resumed.run_id
        assert [m["content"] for m in memory.messages if m["role"] == "user"] == ["崩溃前受理"]
        assert (await SessionService(uow_factory, read_factory).get_session_detail(session.id)).unconsumed_inputs == []
        await database.shutdown()
    asyncio.run(asyncio.wait_for(scenario(), 30))


def test_crash_after_consumption_does_not_offer_the_input_again(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory, "consumed-session")
        gate = asyncio.Event()
        h = make_loop([ScriptedResponse(content="处理中", hold=gate)], session=session, uow_factory=uow_factory)
        run = await start_run(h, input_task(), "已进入模型历史")
        execution = asyncio.create_task(make_runner(h, run=run).invoke(input_task()))
        for _ in range(100):
            async with read_factory() as uow:
                if not await uow.run_input.pending(run.id):
                    break
            await asyncio.sleep(0.02)
        execution.cancel()  # 模型请求进行中进程退出
        with pytest.raises(asyncio.CancelledError):
            await execution
        await RunLedger(uow_factory).interrupt_running()
        detail = await SessionService(uow_factory, read_factory).get_session_detail(session.id)
        assert detail.session.status == SessionStatus.INTERRUPTED and detail.unconsumed_inputs == []
        async with read_factory() as uow:
            memory = await uow.session.get_memory(session.id, "agent")
        assert [m["content"] for m in memory.messages if m["role"] == "user"] == ["已进入模型历史"]
    with_database(tmp_path, scenario)


# 提问与审批重启 ------------------------------------------------------------------

def test_question_survives_restart_and_resumes_same_run(tmp_path):
    async def scenario():
        database = await open_database(tmp_path)
        uow_factory, read_factory = factories(database)
        session = await new_session(uow_factory, "ask-session")
        h = make_loop([tool_call("message_ask_user", {"text": "路径？"}, id="ask-1")], session=session,
                      uow_factory=uow_factory)
        run = await start_run(h, input_task(), "核对文件")
        await make_runner(h, run=run).invoke(input_task())
        await database.shutdown()

        database = await open_database(tmp_path)
        uow_factory, read_factory = factories(database)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        assert await ledger.interrupt_running() == [] and await interrupt_waiting_approvals(uow_factory, ledger) == []
        stored, runs, _ = await read(read_factory, session.id)
        assert stored.status == SessionStatus.WAITING and runs[0].status == RunStatus.WAITING
        second = make_loop([reply("核对完成")], session=stored, uow_factory=uow_factory)
        resumed = await resume_run(second, run.id, "/hello.txt")
        await make_runner(second, run=resumed, prior_status=SessionStatus.WAITING).invoke(input_task())
        stored, runs, events = await read(read_factory, session.id)
        assert stored.status == SessionStatus.COMPLETED and [r.id for r in runs] == [run.id]
        assert [e.status for e in events if isinstance(e, RunEvent)] == ["running", "waiting", "running", "completed"]
        request = second.llm.requests[0].messages
        assert any(m.get("role") == "tool" and "/hello.txt" in m["content"] for m in request)
        await database.shutdown()
    asyncio.run(asyncio.wait_for(scenario(), 30))


def test_tool_approval_round_trip_and_restart_expires_pending_approval(tmp_path):
    from app.domain.services.flows.agent_loop import NOT_EXECUTED_APPROVAL, NOT_EXECUTED_STOPPED
    from tests.core.test_tool_approval import ASK_ECHO, ECHO_THEN_READ
    from tests.support.loop_harness import tool_results

    async def wait(session, uow_factory):
        h = make_loop([ECHO_THEN_READ], session=session, uow_factory=uow_factory, tool_policy=ASK_ECHO)
        run = await start_run(h, input_task(), "回显 a 并读取 /b.txt")
        await make_runner(h, run=run).invoke(input_task())
        return h, run

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory, "approval-session")
        first, run = await wait(session, uow_factory)
        assert [(r.status, r.reason) for r in (await read(read_factory, session.id))[1]] == [(RunStatus.WAITING, "approval")]
        second = make_loop([reply("已回显")], session=session, uow_factory=uow_factory, tool_policy=ASK_ECHO)
        service = service_for(uow_factory, read_factory, second.ledger)
        created = []

        async def create_task(s, rid, prior_status, approval=None):
            created.append((rid, prior_status, approval))
            return SimpleNamespace(invoke=AsyncMock(), cancel=lambda: True)
        service._create_task = create_task
        accepted = await service.reply_approval(session.id, "c-a", approve=True)
        await pending_starts()[accepted.run_id].worker
        rid, prior_status, approval = created[0]
        async with read_factory() as uow:
            resumed = await uow.run.get(rid)
        await make_runner(second, run=resumed, prior_status=prior_status, approval=approval).invoke(input_task())
        stored, runs, events = await read(read_factory, session.id)
        assert runs[0].status == RunStatus.COMPLETED and runs[0].tool_calls == 1
        assert [(e.status, e.function_args) for e in events if isinstance(e, ApprovalEvent)] == [
            ("pending", {"text": "a"}), ("approved", {"text": "a"})]
        assert second.recording.calls == ["echo:a"]
        assert tool_results(second.llm.requests[0].messages)["c-b"]["message"] == NOT_EXECUTED_APPROVAL
        for index, request in enumerate([*first.llm.requests, *second.llm.requests], start=1):
            rebuilt = rebuild_request(events, runs[0], index)
            assert rebuilt.messages == request.messages and rebuilt.tools == request.tools

        other = await new_session(uow_factory, "approval-restart")
        _, waiting_run = await wait(other, uow_factory)
        interrupted = await interrupt_waiting_approvals(uow_factory, RunLedger(uow_factory))
        assert [r.id for r in interrupted] == [waiting_run.id]
        stored, runs, events = await read(read_factory, other.id)
        assert (runs[0].status, runs[0].reason) == (RunStatus.INTERRUPTED, "api_restart")
        assert [e.status for e in events if isinstance(e, ApprovalEvent)] == ["pending", "expired"]
        assert not [e for e in events if isinstance(e, ToolEvent)]
        async with read_factory() as uow:
            memory = await uow.session.get_memory(other.id, "agent")
        assert {k: v["message"] for k, v in tool_results(memory.messages).items()} == {
            "c-a": NOT_EXECUTED_STOPPED, "c-b": NOT_EXECUTED_STOPPED}
    with_database(tmp_path, scenario)


def test_startup_scan_interrupts_running_and_keeps_waiting(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        running_session = await new_session(uow_factory, "scan-running")
        waiting_session = await new_session(uow_factory, "scan-waiting")
        done_session = await new_session(uow_factory, "scan-done")
        ledger = RunLedger(uow_factory)
        running = await ledger.start(running_session.id)
        await ledger.append(running_session.id, [MessageEvent(message="进行中")], run_id=running.id)
        waiting = await ledger.start(waiting_session.id)
        await ledger.transition(waiting_session.id, waiting.id, RunStatus.WAITING)
        done = await ledger.start(done_session.id)
        await ledger.transition(done_session.id, done.id, RunStatus.COMPLETED)

        interrupted = await RunLedger(uow_factory).interrupt_running()
        assert [r.id for r in interrupted] == [running.id]
        stored, runs, events = await read(read_factory, running_session.id)
        assert (runs[0].status, runs[0].reason) == (RunStatus.INTERRUPTED, "api_restart")
        assert runs[0].ended_at is not None and runs[0].ended_at.tzinfo is not None
        assert stored.status == SessionStatus.INTERRUPTED
        assert (events[-1].type, events[-1].status, events[-1].reason) == ("run", "interrupted", "api_restart")
        stored, runs, _ = await read(read_factory, waiting_session.id)
        assert runs[0].status == RunStatus.WAITING and stored.status == SessionStatus.WAITING
        assert (await read(read_factory, done_session.id))[1][0].status == RunStatus.COMPLETED
        assert await RunLedger(uow_factory).interrupt_running() == []
    with_database(tmp_path, scenario)


# 数据库忙碌 --------------------------------------------------------------------

def test_database_busy_is_bounded_and_retried_only_before_work_starts(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory)
        run = await ledger.start(session.id)
        other = sqlite3.connect(database.path, isolation_level=None)
        try:
            other.execute("BEGIN IMMEDIATE")
            loop = asyncio.get_running_loop()
            begin = loop.time()
            with pytest.raises(DatabaseBusyError):
                await ledger.append(session.id, [MessageEvent(message="忙碌")], run_id=run.id)
            assert loop.time() - begin < 3
            async with read_factory() as uow:  # WAL 下读取不受写锁阻塞
                assert len(await uow.event.list(session.id)) == 1
            loop.call_later(0.1, other.execute, "ROLLBACK")
            written = await ledger.append(session.id, [MessageEvent(message="稍后成功")], run_id=run.id)
            assert written[0].seq == 2
        finally:
            other.close()
        assert [e.type for e in (await read(read_factory, session.id))[2]] == ["run", "message"]
    with_database(tmp_path, scenario, busy_timeout_ms=150, begin_attempts=2)


# 后台任务：旧代次回调、取消、重启接管 ---------------------------------------------------

def test_background_job_rejects_late_generation_and_recovers_after_restart(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        removed = []
        first = BackgroundJobRunner(uow_factory, "instance-a", read_uow_factory=read_factory)
        first.register(OperationKind.DATA_CLEANUP, cleanup_handler(removed.append, removed.append),
                       requeue_on_restart=True)
        planned = cleanup_job(objects=["aa/1", "bb/2"], directories=["sessions/x"]).model_copy(
            update={"idempotency_key": "cleanup:x"})
        async with uow_factory() as uow:
            job = await first.submit(uow, planned)
            again = await first.submit(uow, planned.model_copy(update={"operation_id": "other"}))
        assert again.operation_id == job.operation_id
        async with uow_factory() as uow:
            claimed = await uow.job.claim("instance-a", [OperationKind.DATA_CLEANUP])
        assert claimed.status == OperationStatus.RUNNING and claimed.owner_instance == "instance-a"

        # 核心重启：新实例接管运行中的任务，代次递增；旧实例迟到的进度与结果被拒绝
        second = BackgroundJobRunner(uow_factory, "instance-b", read_uow_factory=read_factory)
        second.register(OperationKind.DATA_CLEANUP, cleanup_handler(removed.append, removed.append),
                        requeue_on_restart=True)
        recovered = await second.recover()
        assert [j.operation_id for j in recovered] == [claimed.operation_id]
        async with uow_factory() as uow:
            assert not await uow.job.progress(claimed.operation_id, claimed.generation, "instance-a", completed=1)
            assert not await uow.job.finish(claimed.operation_id, claimed.generation, "instance-a",
                                            OperationStatus.SUCCEEDED)
            requeued = await uow.job.get(claimed.operation_id)
        assert requeued.status == OperationStatus.QUEUED and requeued.generation == claimed.generation + 1
        with pytest.raises(Exception):
            await JobContext(first, claimed).progress(completed=1)

        second.start()
        for _ in range(100):
            current = await second.get(claimed.operation_id)
            if current.status.terminal:
                break
            await asyncio.sleep(0.02)
        await second.stop()
        assert current.status == OperationStatus.SUCCEEDED and current.progress.completed == 3
        assert removed == ["aa/1", "bb/2", "sessions/x"]
        assert (await second.retry(claimed.operation_id)).status == OperationStatus.SUCCEEDED
    with_database(tmp_path, scenario)


def test_background_job_cancel_and_retry_follow_operation_contract(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        gate = asyncio.Event()

        async def slow(context: JobContext):
            await context.progress(phase="等待", total=1)
            await gate.wait()
            await context.check_cancel()
            return {"done": True}

        async def broken(context: JobContext):
            raise OSError("磁盘不可写")

        runner = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        runner.register(OperationKind.DATA_CLEANUP, slow, requeue_on_restart=True)
        queued = BackgroundJob(operation_id="queued", kind=OperationKind.DATA_CLEANUP,
                               scope=OperationScope(kind=OperationScopeKind.APP), retry_supported=True)
        async with uow_factory() as uow:
            await runner.submit(uow, queued)
        cancelled = await runner.cancel("queued")
        assert cancelled.status == OperationStatus.CANCELLED and cancelled.cancel_requested_at is not None
        async with uow_factory() as uow:
            await runner.submit(uow, queued.model_copy(update={"operation_id": "running"}))
        runner.start()
        for _ in range(100):
            if (await runner.get("running")).status == OperationStatus.RUNNING:
                break
            await asyncio.sleep(0.02)
        requested = await runner.cancel("running")
        assert requested.status == OperationStatus.RUNNING and requested.cancel_requested_at is not None
        gate.set()
        for _ in range(100):
            current = await runner.get("running")
            if current.status.terminal:
                break
            await asyncio.sleep(0.02)
        assert current.status == OperationStatus.CANCELLED and current.can_retry
        runner.register(OperationKind.DATA_CLEANUP, broken, requeue_on_restart=True)
        retried = await runner.retry("running")
        assert retried.status == OperationStatus.QUEUED and retried.generation == current.generation + 1
        runner.wake()
        for _ in range(100):
            current = await runner.get("running")
            if current.status.terminal:
                break
            await asyncio.sleep(0.02)
        await runner.stop()
        assert current.status == OperationStatus.FAILED and "磁盘不可写" in current.error.message
        assert current.error.retryable is True
    with_database(tmp_path, scenario)


# 会话删除回收、实例锁与 schema 版本 ------------------------------------------------

def test_session_delete_records_cleanup_and_removes_workdir_and_objects(tmp_path):
    from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
    from fastapi import UploadFile
    import io

    async def scenario(uow_factory, read_factory, database):
        workdirs = SessionWorkdirs(tmp_path)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        jobs = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        jobs.register(OperationKind.DATA_CLEANUP, cleanup_handler(storage.remove_key, workdirs.remove),
                      requeue_on_restart=True)
        sessions = SessionService(uow_factory, read_factory, workdirs=workdirs, jobs=jobs)
        session = await sessions.create_session()
        async with read_factory() as uow:
            root, location = await uow.root.session_workdir(session.id)
        workdir = workdirs.resolve(root, location).ensure()
        (workdir.outputs / "c.txt").write_text("full output")
        file = await storage.upload_file(UploadFile(filename="a.txt", file=io.BytesIO(b"attachment")),
                                         session_id=session.id)
        assert storage.object_path(file.key).read_bytes() == b"attachment" and file.sha256
        jobs.start()
        await sessions.delete_session(session.id)
        assert await sessions.get_session(session.id) is None
        async with read_factory() as uow:
            assert await uow.file.get_by_id(file.id) is None
            job = await uow.job.latest(OperationKind.DATA_CLEANUP, session_id=session.id)
        for _ in range(100):
            job = await jobs.get(job.operation_id)
            if job.status.terminal:
                break
            await asyncio.sleep(0.02)
        await jobs.stop()
        assert job.status == OperationStatus.SUCCEEDED
        assert not workdir.path.exists() and not storage.object_path(file.key).exists()
    with_database(tmp_path, scenario)


def test_data_reset_is_blocked_by_active_runs_then_clears_everything_through_one_job(tmp_path):
    from app.application.errors.exceptions import BadRequestError
    from app.application.services.data_service import RESET_CONFIRMATION, DataService
    from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
    from fastapi import UploadFile
    import io

    async def scenario(uow_factory, read_factory, database):
        workdirs = SessionWorkdirs(tmp_path)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        jobs = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        jobs.register(OperationKind.DATA_CLEANUP, cleanup_handler(storage.remove_key, workdirs.remove),
                      requeue_on_restart=True)
        sessions = SessionService(uow_factory, read_factory, workdirs=workdirs, jobs=jobs)
        data = DataService(uow_factory, jobs)
        first, second = await sessions.create_session(), await sessions.create_session()
        directories = []
        for session in (first, second):
            async with read_factory() as uow:
                root, location = await uow.root.session_workdir(session.id)
            directories.append(workdirs.resolve(root, location).ensure().path)
        file = await storage.upload_file(UploadFile(filename="a.txt", file=io.BytesIO(b"attachment")),
                                         session_id=first.id)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        run = await ledger.start(second.id)

        preview = await data.preview()
        assert preview.counts["sessions"] == 2 and preview.counts["files"] == 1
        assert preview.blocked_reason and preview.occupying_session_id == second.id
        with pytest.raises(ConflictError):
            await data.start(RESET_CONFIRMATION)
        await ledger.transition(second.id, run.id, RunStatus.CANCELLED)
        with pytest.raises(BadRequestError):
            await data.start("清空")

        jobs.start()
        task = await data.start(RESET_CONFIRMATION)
        assert set(task.session_ids) == {first.id, second.id}
        with pytest.raises(ConflictError):
            await data.start(RESET_CONFIRMATION)
        for _ in range(100):
            task = await data.get(task.id)
            if task.state != "running":
                break
            await asyncio.sleep(0.02)
        await jobs.stop()
        assert task.state == "completed"
        assert all(not path.exists() for path in directories) and not storage.object_path(file.key).exists()
        async with read_factory() as uow:
            assert (await uow.session.page(offset=0, limit=10))[1] == 0
            assert await uow.file.list_all() == []
        assert (await data.preview()).blocked_reason is None
    with_database(tmp_path, scenario)


def test_instance_lock_and_newer_schema_are_refused(tmp_path):
    lock = InstanceLock(tmp_path / "core.lock")
    lock.acquire()
    with pytest.raises(DataRootLocked):
        InstanceLock(tmp_path / "core.lock").acquire()
    lock.release()
    again = InstanceLock(tmp_path / "core.lock")
    again.acquire()
    again.release()

    database = tmp_path / "rayagent.db"
    assert migrate(database) == "0001_baseline"
    assert migrate(database) == "0001_baseline"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        connection.execute("UPDATE alembic_version SET version_num = '9999_future'")
    with pytest.raises(SchemaTooNew):
        migrate(database)


def test_attempt_and_plan_payloads_survive_json_round_trip(tmp_path):
    from app.domain.models.plan import Artifact, ExecutionStatus, Plan, Step, Verification
    from app.domain.models.event import PlanEvent

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        run = await ledger.start(session.id)
        await ledger.append(session.id, [
            TurnEvent(phase=TurnPhase.COMPLETED, index=1, model_ms=20, attempts=2, ttft_ms=12,
                      usage=TurnUsage(prompt_tokens=3, completion_tokens=1), finish_reason="stop"),
            AttemptEvent(turn=1, attempt=1, reason=AttemptReason.STREAM_INTERRUPTED, chars=4, retried=True),
            MessageEvent(role="assistant", message="完成", attempt=2),
        ], run_id=run.id)
        plan = Plan(title='标题', description='说明', goal='目标', scope='范围', source_seq=1,
                    steps=[Step(id='stage', description='阶段', status=ExecutionStatus.RUNNING),
                           Step(id='child', kind='step', parent_id='stage', description='步骤')],
                    artifacts=[Artifact(id='output', name='成果', path='/a', version='v', state='generated')],
                    verifications=[Verification(key='check', artifact_id='output', condition='条件', version='v',
                                                call_id='call', state='passed')])
        await ledger.transition(session.id, run.id, RunStatus.COMPLETED,
                                events_after=[PlanEvent(plan=plan), DoneEvent(outcome='partial', missing=['成果'])])
        _, runs, events = await read(read_factory, session.id)
        attempt = next(e for e in events if isinstance(e, AttemptEvent))
        assert (attempt.turn, attempt.attempt, attempt.reason, attempt.chars, attempt.retried) == (
            1, 1, AttemptReason.STREAM_INTERRUPTED, 4, True)
        assert next(e for e in events if isinstance(e, PlanEvent)).plan.model_dump() == plan.model_dump()
        assert next(e for e in events if isinstance(e, DoneEvent)).missing == ['成果']
        assert runs[0].summary().duration_ms is not None and all(e.created_at.tzinfo for e in events)
    with_database(tmp_path, scenario)
