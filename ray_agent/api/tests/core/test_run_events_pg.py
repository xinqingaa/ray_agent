"""W3 验收 1–4、6 与请求重建的数据库往返，W2 压缩与结果整形、W7.2 工具审批、W9 运行模式与手动压缩的往返：
使用真实临时 PostgreSQL。

设置 ``RAY_TEST_DATABASE_URI``（例如 ``postgresql+asyncpg://postgres:postgres@localhost:55432/postgres``）后运行；
未设置时跳过。每个测试前清空 public schema 并执行 ``alembic upgrade head``，不要指向开发库。
"""
import asyncio
import os
from typing import Awaitable, Callable

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.application.services import agent_service as agent_service_module
from app.application.services.agent_service import AgentService, pending_starts
from app.domain.models.event import (
    AttemptEvent,
    AttemptReason,
    DoneEvent,
    MessageEvent,
    RunEvent,
    TurnEvent,
    TurnPhase,
    TurnUsage,
)
from app.domain.models.run import RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.run_repository import ActiveRunExistsError
from app.domain.services.run_ledger import RunLedger
from app.domain.services.request_rebuild import rebuild_request
from app.infrastructure.repositories.db_uow import DBUnitOfWork
from app.infrastructure.logging import setup_logging
from tests.support.loop_harness import MemoryNotifier, input_task, make_loop, make_runner, start_run, submit
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text as reply, tool_call, usage

PG_URI = os.environ.get("RAY_TEST_DATABASE_URI")
pytestmark = pytest.mark.skipif(not PG_URI, reason="未设置 RAY_TEST_DATABASE_URI，跳过 PostgreSQL 验收测试")


@pytest.fixture(autouse=True)
def fresh_schema():
    engine = create_engine(PG_URI.replace("+asyncpg", "+psycopg2"))
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
        conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
    engine.dispose()
    previous = os.environ.get("SQLALCHEMY_DATABASE_URI")
    os.environ["SQLALCHEMY_DATABASE_URI"] = PG_URI
    try:
        command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini")), "head")
    finally:
        if previous is None:
            os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
        else:
            os.environ["SQLALCHEMY_DATABASE_URI"] = previous
        setup_logging()
    yield


def with_db(scenario: Callable[..., Awaitable[None]], timeout: float = 30):
    async def main():
        engine = create_async_engine(PG_URI, pool_size=40, max_overflow=80)
        factory = async_sessionmaker(bind=engine, autocommit=False, autoflush=False)

        def uow_factory():
            return DBUnitOfWork(factory)
        try:
            await scenario(uow_factory, engine)
        finally:
            await engine.dispose()
    asyncio.run(asyncio.wait_for(main(), timeout))


async def new_session(uow_factory, session_id="pg-session") -> Session:
    session = Session(id=session_id)
    async with uow_factory() as uow:
        await uow.session.save(session)
    return session


async def read(uow_factory, session_id):
    async with uow_factory() as uow:
        session = await uow.session.get_by_id(session_id)
        runs = await uow.run.list_by_session(session_id)
        events = await uow.event.list(session_id)
    return session, runs, events


# 1 --------------------------------------------------------------------------

def test_concurrent_writes_get_continuous_seq():
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        notifier = MemoryNotifier()
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        # 一半带运行（先锁运行行），一半不带（直接在主键冲突上重试）
        writes = [ledger.append(session.id, [MessageEvent(message=f"m{i}")], run_id=run.id if i % 2 else None)
                  for i in range(100)]
        results = await asyncio.gather(*writes)
        _, _, events = await read(uow_factory, session.id)
        assert [e.seq for e in events] == list(range(1, 102))
        assert sorted(written[0].seq for written in results) == list(range(2, 102))
        assert sorted(e.message for e in events if isinstance(e, MessageEvent)) == sorted(f"m{i}" for i in range(100))
        assert sorted(notifier.published) == list(range(1, 102))
    with_db(scenario)


# 2 --------------------------------------------------------------------------

def test_at_most_one_active_run_per_session():
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        other = await new_session(uow_factory, "pg-other")
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
        _, runs, events = await read(uow_factory, session.id)
        assert [(r.id, r.status) for r in runs] == [(first.id, RunStatus.COMPLETED), (second.id, RunStatus.RUNNING)]
        # 失败的 start 整笔回滚：只有两次成功创建各自的 running 事件
        assert [(e.run_id, e.status) for e in events if isinstance(e, RunEvent)] == [
            (first.id, "running"), (first.id, "waiting"), (first.id, "completed"), (second.id, "running")]
    with_db(scenario)


# 3 --------------------------------------------------------------------------

def test_commit_failure_leaves_nothing_visible_and_publishes_nothing():
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        notifier = MemoryNotifier()
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        published = list(notifier.published)
        # 延迟约束触发器：插入时不报错，提交（COMMIT）时才失败，模拟提交阶段的真实故障
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE FUNCTION fail_on_commit() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION '受控提交失败'; END; $$ LANGUAGE plpgsql"""))
            await conn.execute(text("""
                CREATE CONSTRAINT TRIGGER fail_on_commit AFTER INSERT ON events
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
                WHEN (NEW.payload->>'message' = 'boom') EXECUTE FUNCTION fail_on_commit()"""))
        with pytest.raises(Exception, match="受控提交失败"):
            await ledger.transition(session.id, run.id, RunStatus.COMPLETED,
                                    events_before=[MessageEvent(message="boom"), DoneEvent()])
        with pytest.raises(Exception, match="受控提交失败"):
            await ledger.append(session.id, [MessageEvent(message="boom")], run_id=run.id)
        stored, runs, events = await read(uow_factory, session.id)
        assert [e.type for e in events] == ["run"]
        assert runs[0].status == RunStatus.RUNNING and runs[0].ended_at is None
        assert stored.status == SessionStatus.RUNNING
        assert notifier.published == published
    with_db(scenario)


# 4 --------------------------------------------------------------------------

def test_startup_scan_interrupts_running_and_keeps_waiting():
    async def scenario(uow_factory, engine):
        running_session = await new_session(uow_factory, "pg-running")
        waiting_session = await new_session(uow_factory, "pg-waiting")
        done_session = await new_session(uow_factory, "pg-done")
        ledger = RunLedger(uow_factory)
        running = await ledger.start(running_session.id)
        await ledger.append(running_session.id, [MessageEvent(message="进行中")], run_id=running.id)
        waiting = await ledger.start(waiting_session.id)
        await ledger.transition(waiting_session.id, waiting.id, RunStatus.WAITING)
        done = await ledger.start(done_session.id)
        await ledger.transition(done_session.id, done.id, RunStatus.COMPLETED)

        interrupted = await RunLedger(uow_factory).interrupt_running()
        assert [r.id for r in interrupted] == [running.id]
        stored, runs, events = await read(uow_factory, running_session.id)
        assert (runs[0].status, runs[0].reason) == (RunStatus.INTERRUPTED, "api_restart")
        assert runs[0].ended_at is not None
        assert stored.status == SessionStatus.INTERRUPTED
        assert (events[-1].type, events[-1].status, events[-1].reason) == ("run", "interrupted", "api_restart")
        assert events[-1].summary["turns"] == 0
        stored, runs, _ = await read(uow_factory, waiting_session.id)
        assert runs[0].status == RunStatus.WAITING and stored.status == SessionStatus.WAITING
        _, runs, _ = await read(uow_factory, done_session.id)
        assert runs[0].status == RunStatus.COMPLETED
        assert await RunLedger(uow_factory).interrupt_running() == []
    with_db(scenario)


# 6 --------------------------------------------------------------------------

def test_sse_catch_up_gap_and_dropped_notification(monkeypatch):
    monkeypatch.setattr(agent_service_module, "FALLBACK_POLL_SECONDS", 0.3)

    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory)
        run = await ledger.start(session.id)
        for i in range(3):
            await ledger.append(session.id, [MessageEvent(message=f"历史{i}")], run_id=run.id)

        class GapNotifier(MemoryNotifier):
            """订阅建立前写入一条事件，它的通知发生在订阅之前，只能靠订阅后的补查得到。"""
            async def subscribe(self, session_id):
                await ledger.append(session_id, [MessageEvent(message="订阅空档")], run_id=run.id)
                return await super().subscribe(session_id)

        notifier = GapNotifier()
        ledger._notifier = notifier
        service = AgentService.__new__(AgentService)
        service._uow_factory, service._uow, service._notifier = uow_factory, uow_factory(), notifier
        stream = service.stream_events(session.id, after_seq=2)
        received = []

        async def take(n):
            for _ in range(n):
                received.append(await asyncio.wait_for(anext(stream), 5))

        await take(3)  # after_seq 之后的历史 2 条 + 订阅空档 1 条
        assert [e.seq for e in received] == [3, 4, 5]
        assert received[-1].message == "订阅空档"

        await ledger.append(session.id, [MessageEvent(message="正常通知")], run_id=run.id)
        await take(1)
        assert received[-1].message == "正常通知"

        notifier.drop = True
        loop = asyncio.get_running_loop()
        begin = loop.time()
        await ledger.append(session.id, [MessageEvent(message="通知丢失")], run_id=run.id)
        await take(1)
        assert received[-1].message == "通知丢失"
        assert loop.time() - begin < 2
        assert [e.seq for e in received] == [3, 4, 5, 6, 7]
        await stream.aclose()
    with_db(scenario)


# 8（数据库往返）-------------------------------------------------------------

def test_request_rebuild_survives_jsonb_round_trip():
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        h = make_loop([
            ScriptedResponse(content="先读再问", tool_calls=[
                ScriptedToolCall("read_file", {"filepath": "/中文.txt", "b": 1, "a": [2, {"z": 1, "y": 2}]}, id="c-r"),
                ScriptedToolCall("message_ask_user", {"text": "继续？"}, id="c-ask"),
            ], usage=usage(10, 2)),
        ], session=session, uow_factory=uow_factory)
        task = input_task()
        run = await start_run(h, task, "开始")
        await make_runner(h, run=run).invoke(task)

        second = make_loop([tool_call("echo", {"text": "x"}, id="c-e"), reply("完成")],
                           session=session, uow_factory=uow_factory)
        await second.ledger.transition(session.id, run.id, RunStatus.RUNNING,
                                       events_after=[MessageEvent(role="user", message="继续")])
        task2 = input_task()
        await submit(task2, "继续")
        async with uow_factory() as uow:
            waiting_run = await uow.run.get(run.id)
        await make_runner(second, run=waiting_run, prior_status=SessionStatus.WAITING).invoke(task2)

        async with uow_factory() as uow:
            stored = await uow.run.get(run.id)
            events = await uow.event.list(session.id)
        assert stored.status == RunStatus.COMPLETED
        assert stored.turns == 3 and stored.model_requests == 3 and stored.tool_calls == 2
        actual = [h.llm.requests[0], *second.llm.requests]
        for index, request in enumerate(actual, start=1):
            rebuilt = rebuild_request(events, stored, index)
            assert rebuilt.messages == request.messages
            assert rebuilt.tools == request.tools
    with_db(scenario)


# W2：压缩与结果整形的数据库往返 ----------------------------------------------

def test_compaction_and_shaping_survive_jsonb_round_trip():
    async def scenario(uow_factory, engine):
        from app.domain.models.event import CompactEvent, ToolEvent
        from app.domain.models.memory import Memory
        from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
        from tests.core.test_context_governance import LONG_FILE, SUMMARY, seeded_session
        from tests.support.loop_harness import InMemorySandbox

        session = await new_session(uow_factory, "pg-w2")
        _, seeded = seeded_session(10)
        async with uow_factory() as uow:
            await uow.session.save_memory(session.id, AGENT_MEMORY_NAME, Memory(messages=seeded))
            await uow.commit()
        sandbox = InMemorySandbox({"/data/big.txt": LONG_FILE})

        async def write_output(path, content):
            await sandbox.write_file(path, content)

        h = make_loop([reply(SUMMARY, usage=usage(8000, 100)),
                       tool_call("read_file", {"filepath": "/data/big.txt", "max_length": 100000}, id="c-big",
                                 usage=usage(9000, 5)),
                       reply("完成", usage=usage(9500, 3))],
                      session=session, uow_factory=uow_factory, sandbox=sandbox, write_output=write_output)
        task = input_task()
        run = await start_run(h, task, "继续")
        await make_runner(h, run=run, prior_status=SessionStatus.COMPLETED).invoke(task)

        async with uow_factory() as uow:
            stored = await uow.run.get(run.id)
            events = await uow.event.list(session.id)
        assert stored.status == RunStatus.COMPLETED
        assert stored.turns == 2 and stored.model_requests == 3 and stored.prompt_tokens == 8000 + 9000 + 9500
        compact = [e for e in events if isinstance(e, CompactEvent)]
        assert len(compact) == 1 and compact[0].summary == SUMMARY and compact[0].usage.attempts == 1
        called = [e for e in events if isinstance(e, ToolEvent) and e.status == "called"]
        assert called[0].shaping.full_output_path == "/home/ubuntu/.rayagent/outputs/c-big.txt"
        main = [r for r in h.llm.requests if r.tools]
        for index, request in enumerate(main, start=1):
            rebuilt = rebuild_request(events, stored, index)
            assert rebuilt.messages == request.messages
            assert rebuilt.tools == request.tools
    with_db(scenario)


def test_tool_approval_round_trip_and_startup_scan():
    """W7.2：审批事件与 reason=approval 存在既有列里；批准续接后请求可重建，等待审批时的启动扫描补结果。"""
    from unittest.mock import AsyncMock

    from app.domain.models.event import ApprovalEvent, ToolEvent
    from app.domain.services.approvals import interrupt_waiting_approvals
    from app.domain.services.flows.agent_loop import NOT_EXECUTED_APPROVAL, NOT_EXECUTED_STOPPED
    from tests.core.test_tool_approval import ASK_ECHO, ECHO_THEN_READ, make_service
    from tests.support.loop_harness import tool_results

    async def wait(session, uow_factory):
        h = make_loop([ECHO_THEN_READ], session=session, uow_factory=uow_factory, tool_policy=ASK_ECHO)
        task = input_task()
        run = await start_run(h, task, "回显 a 并读取 /b.txt")
        await make_runner(h, run=run).invoke(task)
        return h, run

    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory, "pg-w72")
        first, run = await wait(session, uow_factory)
        _, runs, _ = await read(uow_factory, session.id)
        assert (runs[0].status, runs[0].reason) == (RunStatus.WAITING, "approval")

        second = make_loop([reply("已回显")], session=session, uow_factory=uow_factory, tool_policy=ASK_ECHO)
        service = make_service(second)
        created = []

        async def create_task(s, rid, prior_status):
            t = input_task()
            t.invoke = AsyncMock()
            created.append((t, prior_status))
            return t
        service._create_task = create_task
        accepted = await service.reply_approval(session.id, "c-a", approve=True)
        await pending_starts()[accepted.run_id].worker
        task, prior_status = created[0]
        async with uow_factory() as uow:
            resumed = await uow.run.get(run.id)
        await make_runner(second, run=resumed, prior_status=prior_status).invoke(task)

        stored, runs, events = await read(uow_factory, session.id)
        assert runs[0].status == RunStatus.COMPLETED and runs[0].tool_calls == 1
        approvals = [e for e in events if isinstance(e, ApprovalEvent)]
        assert [(e.status, e.function_args) for e in approvals] == [("pending", {"text": "a"}),
                                                                    ("approved", {"text": "a"})]
        assert approvals[1].seq == accepted.seq and approvals[1].decided_at is not None
        assert second.recording.calls == ["echo:a"]
        assert tool_results(second.llm.requests[0].messages)["c-b"]["message"] == NOT_EXECUTED_APPROVAL
        for index, request in enumerate([*first.llm.requests, *second.llm.requests], start=1):
            rebuilt = rebuild_request(events, runs[0], index)
            assert rebuilt.messages == request.messages and rebuilt.tools == request.tools

        other = await new_session(uow_factory, "pg-w72-restart")
        _, waiting_run = await wait(other, uow_factory)
        interrupted = await interrupt_waiting_approvals(uow_factory, RunLedger(uow_factory))
        assert [r.id for r in interrupted] == [waiting_run.id]
        stored, runs, events = await read(uow_factory, other.id)
        assert (runs[0].status, runs[0].reason) == (RunStatus.INTERRUPTED, "api_restart")
        assert stored.status == SessionStatus.INTERRUPTED
        assert [e.status for e in events if isinstance(e, ApprovalEvent)] == ["pending", "expired"]
        assert not [e for e in events if isinstance(e, ToolEvent)]
        async with uow_factory() as uow:
            memory = await uow.session.get_memory(other.id, "agent")
        assert {k: v["message"] for k, v in tool_results(memory.messages).items()} == {
            "c-a": NOT_EXECUTED_STOPPED, "c-b": NOT_EXECUTED_STOPPED}
    with_db(scenario)


def test_plan_mode_and_manual_compaction_round_trip():
    """W9：runs.mode 列与 run 事件的 mode；手动压缩的两条事件不带 run_id、与记忆同一事务，下一次运行可重建。"""
    from app.domain.models.event import CompactEvent, ContextEvent
    from app.domain.models.memory import Memory
    from app.domain.models.run import RunMode
    from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
    from app.domain.services.prompts.compact import SUMMARY_MARKER
    from tests.core.test_context_governance import GOAL, SUMMARY, seeded_session
    from tests.core.test_tool_approval import make_service

    async def seed(uow_factory, session_id):
        session = await new_session(uow_factory, session_id)
        _, seeded = seeded_session(10)
        async with uow_factory() as uow:
            await uow.session.save_memory(session.id, AGENT_MEMORY_NAME, Memory(messages=seeded))
            await uow.session.update_status(session.id, SessionStatus.COMPLETED)
            await uow.commit()
        ledger = RunLedger(uow_factory)
        await ledger.append(session.id, [MessageEvent(role="user", message=GOAL)])
        plan = await ledger.start(session.id, mode=RunMode.PLAN)
        await ledger.transition(session.id, plan.id, RunStatus.COMPLETED)
        return session, seeded, plan

    def service_for(session, script, uow_factory):
        h = make_loop(script, session=session, uow_factory=uow_factory)
        service = make_service(h)
        service._llm, service._agent_config = h.llm, h.loop._config
        return h, service

    async def scenario(uow_factory, engine):
        session, seeded, plan = await seed(uow_factory, "pg-w9")
        stored, runs, events = await read(uow_factory, session.id)
        assert [(r.id, r.mode) for r in runs] == [(plan.id, RunMode.PLAN)]
        assert [(e.status, e.mode) for e in events if isinstance(e, RunEvent)] == [("running", "plan"),
                                                                                 ("completed", "plan")]

        h, service = service_for(session, [reply(SUMMARY, usage=usage(9000, 300))], uow_factory)
        result = await service.compact_session(session.id)
        stored, after_runs, events = await read(uow_factory, session.id)
        compact, context = events[-2:]
        assert isinstance(compact, CompactEvent) and isinstance(context, ContextEvent)
        assert (compact.trigger, compact.run_id, context.run_id) == ("manual", None, None)
        assert (result.compact_seq, result.context_seq) == (compact.seq, context.seq)
        assert compact.usage.prompt_tokens == 9000 and compact.before_estimate["total"] == result.before_total
        assert stored.status == SessionStatus.COMPLETED
        assert [r.model_dump() for r in after_runs] == [r.model_dump() for r in runs]
        async with uow_factory() as uow:
            memory = await uow.session.get_memory(session.id, AGENT_MEMORY_NAME)
        assert memory.messages[1:] == context.messages
        assert memory.messages[1]["content"].startswith(SUMMARY_MARKER) and memory.messages[2]["content"] == GOAL
        async with engine.connect() as conn:
            rows = (await conn.execute(text(
                "SELECT type, run_id FROM events WHERE session_id = :s ORDER BY seq DESC LIMIT 2"),
                {"s": session.id})).all()
        assert [(r.type, r.run_id) for r in rows] == [("context", None), ("compact", None)]

        nxt = make_loop([reply("继续完成")], session=session, uow_factory=uow_factory)
        task = input_task()
        started = await start_run(nxt, task, "接着汇总")
        await make_runner(nxt, run=started, prior_status=SessionStatus.COMPLETED).invoke(task)
        async with uow_factory() as uow:
            stored_run = await uow.run.get(started.id)
            events = await uow.event.list(session.id)
        assert stored_run.status == RunStatus.COMPLETED and stored_run.mode == RunMode.NORMAL
        request = nxt.llm.requests[0]
        assert request.messages[1]["content"].startswith(SUMMARY_MARKER)
        rebuilt = rebuild_request(events, stored_run, 1)
        assert rebuilt.messages == request.messages and rebuilt.tools == request.tools

        # 提交失败时两条事件与记忆一起回滚
        other, other_seeded, _ = await seed(uow_factory, "pg-w9-rollback")
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE FUNCTION fail_compact() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION '受控提交失败'; END; $$ LANGUAGE plpgsql"""))
            await conn.execute(text("""
                CREATE CONSTRAINT TRIGGER fail_compact AFTER INSERT ON events
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
                WHEN (NEW.type = 'context') EXECUTE FUNCTION fail_compact()"""))
        _, failing = service_for(other, [reply(SUMMARY)], uow_factory)
        before_events = len((await read(uow_factory, other.id))[2])
        with pytest.raises(Exception, match="受控提交失败"):
            await failing.compact_session(other.id)
        _, _, other_events = await read(uow_factory, other.id)
        async with uow_factory() as uow:
            other_memory = await uow.session.get_memory(other.id, AGENT_MEMORY_NAME)
        assert len(other_events) == before_events and other_memory.messages == other_seeded
    with_db(scenario)


def test_attempt_ttft_and_message_attempt_survive_jsonb_round_trip():
    """失败尝试、首字延迟和助手消息的 attempt 存在既有 payload 里，不需要新迁移。"""
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory, "pg-w6")
        ledger = RunLedger(uow_factory, MemoryNotifier())
        run = await ledger.start(session.id)
        await ledger.append(session.id, [
            TurnEvent(
                phase=TurnPhase.COMPLETED, index=1, model_ms=20, attempts=2, ttft_ms=12,
                usage=TurnUsage(prompt_tokens=3, completion_tokens=1), finish_reason="stop",
            ),
            AttemptEvent(turn=1, attempt=1, reason=AttemptReason.STREAM_INTERRUPTED, chars=4, retried=True),
            MessageEvent(role="assistant", message="完成", attempt=2),
        ], run_id=run.id)
        _, _, events = await read(uow_factory, session.id)
        attempt = next(event for event in events if isinstance(event, AttemptEvent))
        assert (attempt.turn, attempt.attempt, attempt.reason, attempt.chars, attempt.retried) == (
            1, 1, AttemptReason.STREAM_INTERRUPTED, 4, True,
        )
        turn = next(event for event in events if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
        assert turn.ttft_ms == 12 and turn.usage.prompt_tokens == 3
        message = next(event for event in events if isinstance(event, MessageEvent) and event.role == "assistant")
        assert message.attempt == 2 and message.message == "完成"
    with_db(scenario)


def test_visual_ownership_roundtrip_and_expired_query_protects_waiting():
    from app.domain.models.file import File
    async def scenario(uow_factory, engine):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        active = await ledger.start(session.id)
        await ledger.transition(session.id, active.id, RunStatus.WAITING)
        async with uow_factory() as uow:
            await uow.file.save(File(id='temp', key='temp', visual={
                'temporary':True,'run_id':active.id,'session_id':session.id,
                'expires_at':1,'deleted_at':None,'sha256':'abc'}))
            await uow.file.save(File(id='permanent', key='permanent'))
        async with uow_factory() as uow:
            assert not await uow.file.expired_visual_files(2)
            assert (await uow.file.get_by_id('temp')).visual['sha256']=='abc'
        await ledger.transition(session.id, active.id, RunStatus.CANCELLED)
        async with uow_factory() as uow:
            expired = await uow.file.expired_visual_files(2)
            assert [f.id for f in expired]==['temp']
            expired[0].visual['deleted_at']=2
            await uow.file.save(expired[0])
        async with uow_factory() as uow:
            assert not await uow.file.expired_visual_files(3)
            assert await uow.file.get_by_id('permanent')
    with_db(scenario)
