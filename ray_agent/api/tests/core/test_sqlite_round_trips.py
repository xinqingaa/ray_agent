"""真实 SQLite 业务库上的往返：请求重建、压缩与结果整形、计划模式与手动压缩、视觉产物到期查询、计划承接并发。"""
import asyncio
from pathlib import Path

import pytest
from sqlalchemy import text

from app.domain.models.event import MessageEvent, RunEvent
from app.domain.models.run import RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.services.request_rebuild import rebuild_request
from app.domain.services.run_ledger import RunLedger
from tests.core.test_sqlite_storage import deferred_violation, new_session, read
from tests.support.loop_harness import MemoryNotifier, input_task, make_loop, make_runner, resume_run, start_run
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text as reply, tool_call, usage
from tests.support.sqlite_db import with_database


def test_request_rebuild_survives_json_round_trip(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        h = make_loop([
            ScriptedResponse(content="先读再问", tool_calls=[
                ScriptedToolCall("read_file", {"filepath": "/中文.txt", "b": 1, "a": [2, {"z": 1, "y": 2}]}, id="c-r"),
                ScriptedToolCall("message_ask_user", {"text": "继续？"}, id="c-ask"),
            ], usage=usage(10, 2)),
        ], session=session, uow_factory=uow_factory)
        run = await start_run(h, input_task(), "开始")
        await make_runner(h, run=run).invoke(input_task())

        second = make_loop([tool_call("echo", {"text": "x"}, id="c-e"), reply("完成")],
                           session=session, uow_factory=uow_factory)
        waiting_run = await resume_run(second, run.id, "继续")
        await make_runner(second, run=waiting_run, prior_status=SessionStatus.WAITING).invoke(input_task())

        _, runs, events = await read(read_factory, session.id)
        stored = runs[0]
        assert stored.status == RunStatus.COMPLETED
        assert stored.turns == 3 and stored.model_requests == 3 and stored.tool_calls == 2
        for index, request in enumerate([h.llm.requests[0], *second.llm.requests], start=1):
            rebuilt = rebuild_request(events, stored, index)
            assert rebuilt.messages == request.messages
            assert rebuilt.tools == request.tools
    with_database(tmp_path, scenario)


def test_compaction_and_shaping_survive_json_round_trip(tmp_path):
    from app.domain.models.event import CompactEvent, ToolEvent
    from app.domain.models.memory import Memory
    from app.domain.services.agent_task_runner import AgentTaskRunner
    from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
    from app.infrastructure.external.workdir.session_workdir import SessionWorkdirs
    from tests.core.test_context_governance import LONG_FILE, SUMMARY, seeded_session
    from tests.support.loop_harness import InMemorySandbox

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory, "sqlite-w2")
        _, seeded = seeded_session(10)
        async with uow_factory() as uow:
            await uow.session.save_memory(session.id, AGENT_MEMORY_NAME, Memory(messages=seeded))
        workdirs = SessionWorkdirs(tmp_path / "data")
        workdir = workdirs.resolve(*workdirs.new_root(session.id))
        sandbox = InMemorySandbox({"/data/big.txt": LONG_FILE})

        async def write_output(path, content):
            await AgentTaskRunner._write_output(type("R", (), {"_workdir": workdir})(), path, content)

        h = make_loop([reply(SUMMARY, usage=usage(8000, 100)),
                       tool_call("read_file", {"filepath": "/data/big.txt", "max_length": 100000}, id="c-big",
                                 usage=usage(9000, 5)),
                       reply("完成", usage=usage(9500, 3))],
                      session=session, uow_factory=uow_factory, sandbox=sandbox, write_output=write_output,
                      output_dir=str(workdir.outputs))
        run = await start_run(h, input_task(), "继续")
        await make_runner(h, run=run, prior_status=SessionStatus.COMPLETED).invoke(input_task())

        _, runs, events = await read(read_factory, session.id)
        stored = runs[0]
        assert stored.status == RunStatus.COMPLETED
        assert stored.turns == 2 and stored.model_requests == 3 and stored.prompt_tokens == 8000 + 9000 + 9500
        compact = [e for e in events if isinstance(e, CompactEvent)]
        assert len(compact) == 1 and compact[0].summary == SUMMARY and compact[0].usage.attempts == 1
        called = [e for e in events if isinstance(e, ToolEvent) and e.status == "called"]
        assert called[0].shaping.full_output_path == str(workdir.outputs / "c-big.txt")
        assert LONG_FILE in Path(called[0].shaping.full_output_path).read_text(encoding="utf-8")
        for index, request in enumerate([r for r in h.llm.requests if r.tools], start=1):
            rebuilt = rebuild_request(events, stored, index)
            assert rebuilt.messages == request.messages
            assert rebuilt.tools == request.tools
    with_database(tmp_path, scenario)


def test_plan_mode_and_manual_compaction_round_trip(tmp_path):
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

    async def scenario(uow_factory, read_factory, database):
        session, seeded, plan = await seed(uow_factory, "sqlite-w9")
        stored, runs, events = await read(read_factory, session.id)
        assert [(r.id, r.mode) for r in runs] == [(plan.id, RunMode.PLAN)]
        assert [(e.status, e.mode) for e in events if isinstance(e, RunEvent)] == [("running", "plan"),
                                                                                 ("completed", "plan")]
        h, service = service_for(session, [reply(SUMMARY, usage=usage(9000, 300))], uow_factory)
        result = await service.compact_session(session.id)
        stored, after_runs, events = await read(read_factory, session.id)
        compact, context = events[-2:]
        assert isinstance(compact, CompactEvent) and isinstance(context, ContextEvent)
        assert (compact.trigger, compact.run_id, context.run_id) == ("manual", None, None)
        assert (result.compact_seq, result.context_seq) == (compact.seq, context.seq)
        assert stored.status == SessionStatus.COMPLETED
        assert [r.model_dump() for r in after_runs] == [r.model_dump() for r in runs]
        async with read_factory() as uow:
            memory = await uow.session.get_memory(session.id, AGENT_MEMORY_NAME)
            rows = (await uow.db_session.execute(text(
                "SELECT type, run_id FROM events WHERE session_id = :s ORDER BY seq DESC LIMIT 2"),
                {"s": session.id})).all()
        assert memory.messages[1:] == context.messages
        assert memory.messages[1]["content"].startswith(SUMMARY_MARKER) and memory.messages[2]["content"] == GOAL
        assert [(r.type, r.run_id) for r in rows] == [("context", None), ("compact", None)]

        nxt = make_loop([reply("继续完成")], session=session, uow_factory=uow_factory)
        started = await start_run(nxt, input_task(), "接着汇总")
        await make_runner(nxt, run=started, prior_status=SessionStatus.COMPLETED).invoke(input_task())
        async with read_factory() as uow:
            stored_run = await uow.run.get(started.id)
            events = await uow.event.list(session.id)
        assert stored_run.status == RunStatus.COMPLETED and stored_run.mode == RunMode.NORMAL
        request = nxt.llm.requests[0]
        assert request.messages[1]["content"].startswith(SUMMARY_MARKER)
        rebuilt = rebuild_request(events, stored_run, 1)
        assert rebuilt.messages == request.messages and rebuilt.tools == request.tools

        # 提交失败时两条事件与记忆一起回滚
        other, other_seeded, _ = await seed(uow_factory, "sqlite-w9-rollback")
        _, failing = service_for(other, [reply(SUMMARY)], uow_factory)
        before_events = len((await read(read_factory, other.id))[2])
        original_append = failing._ledger.append

        async def append_with_commit_failure(session_id, events, run_id=None, apply=None, after_terminal=False):
            async def failing_apply(uow):
                if apply is not None:
                    await apply(uow)
                await deferred_violation(uow)
            return await original_append(session_id, events, run_id=run_id, apply=failing_apply,
                                         after_terminal=after_terminal)
        failing._ledger.append = append_with_commit_failure
        with pytest.raises(Exception, match="FOREIGN KEY"):
            await failing.compact_session(other.id)
        _, _, other_events = await read(read_factory, other.id)
        async with read_factory() as uow:
            other_memory = await uow.session.get_memory(other.id, AGENT_MEMORY_NAME)
        assert len(other_events) == before_events and other_memory.messages == other_seeded
    with_database(tmp_path, scenario)


def test_visual_ownership_roundtrip_and_expired_query_protects_waiting(tmp_path):
    from app.domain.models.file import File

    async def scenario(uow_factory, read_factory, database):
        session = await new_session(uow_factory)
        ledger = RunLedger(uow_factory, MemoryNotifier())
        active = await ledger.start(session.id)
        await ledger.transition(session.id, active.id, RunStatus.WAITING)
        async with uow_factory() as uow:
            await uow.file.save(File(id='temp', key='te/temp', session_id=session.id, visual={
                'temporary': True, 'run_id': active.id, 'session_id': session.id,
                'expires_at': 1, 'deleted_at': None, 'sha256': 'abc'}))
            await uow.file.save(File(id='permanent', key='pe/permanent'))
        async with read_factory() as uow:
            assert not await uow.file.expired_visual_files(2)
            assert (await uow.file.get_by_id('temp')).visual['sha256'] == 'abc'
        await ledger.transition(session.id, active.id, RunStatus.CANCELLED)
        async with uow_factory() as uow:
            expired = await uow.file.expired_visual_files(2)
            assert [f.id for f in expired] == ['temp'] and expired[0].session_id == session.id
            expired[0].visual['deleted_at'] = 2
            await uow.file.save(expired[0])
        async with read_factory() as uow:
            assert not await uow.file.expired_visual_files(3)
            assert await uow.file.get_by_id('permanent')
    with_database(tmp_path, scenario)


def test_plan_acceptance_atomic_replay_stale_and_concurrent_requests(tmp_path):
    from app.domain.models.event import PlanEvent
    from app.domain.models.plan import Plan, Step
    from app.domain.models.plan_acceptance import PlanAcceptance, PlanAlreadyAccepted, PlanAcceptanceConflict
    from app.domain.models.run import RunMode

    async def scenario(factory, read_factory, database):
        session = await new_session(factory)
        ledger = RunLedger(factory)
        proposal = await ledger.start(session.id, mode=RunMode.PLAN)
        event = PlanEvent(plan=Plan(steps=[Step(description='执行')]))
        await ledger.append(session.id, [event], run_id=proposal.id)
        await ledger.transition(session.id, proposal.id, RunStatus.COMPLETED)
        ref = PlanAcceptance(source_run_id=proposal.id, plan_id=event.plan.id, source_seq=event.seq, request_id='confirm-1')
        for wrong in [ref.model_copy(update={'source_seq': 1}), ref.model_copy(update={'source_run_id': 'other'})]:
            with pytest.raises(PlanAcceptanceConflict):
                await ledger.start(session.id, events_after=[MessageEvent(role='user', message='执行')], execute_plan=wrong)

        async def accept(reference):
            try:
                run = await RunLedger(factory).start(session.id,
                    events_after=[MessageEvent(role='user', message='执行')], execute_plan=reference)
                return run.id
            except PlanAlreadyAccepted as replay:
                return replay.run.id
        ids = await asyncio.gather(*[accept(ref) for _ in range(6)])
        assert len(set(ids)) == 1
        async with read_factory() as uow:
            runs = await uow.run.list_by_session(session.id)
            events = await uow.event.list(session.id, run_id=ids[0])
        assert len(runs) == 2
        adopted = next(e for e in events if isinstance(e, PlanEvent))
        assert adopted.plan == event.plan and adopted.progress_state == 'preparing' and adopted.accepted_from == ref
        assert len([e for e in events if isinstance(e, MessageEvent)]) == 1
        with pytest.raises(PlanAcceptanceConflict):
            await accept(ref.model_copy(update={'request_id': 'second-click'}))
        await ledger.transition(session.id, ids[0], RunStatus.COMPLETED)
        assert await accept(ref) == ids[0]
        other = await new_session(factory, 'other-session')
        with pytest.raises(PlanAcceptanceConflict):
            await ledger.start(other.id, events_after=[MessageEvent(role='user', message='执行')], execute_plan=ref)
    with_database(tmp_path, scenario)
