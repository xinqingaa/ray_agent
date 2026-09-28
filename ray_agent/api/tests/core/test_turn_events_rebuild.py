"""W3 验收 7、8：轮次事件配对与运行汇总；由事件重建的请求与 ScriptedLLM 实际收到的请求逐项一致。

运行器、Agent 循环、工具管线与 RunLedger 都是真实实现；模型、存储与沙箱用替身（事件经 JSON 往返保存）。
"""
import asyncio
from typing import Dict, List, Sequence
from unittest.mock import AsyncMock

import pytest

from app.domain.models.event import MessageEvent, RunEvent, ToolEvent, TurnEvent, TurnPhase
from app.domain.models.run import Run, RunStatus
from app.domain.models.session import SessionStatus
from app.domain.services.request_rebuild import TurnNotFoundError, rebuild_request
from tests.support.loop_harness import (
    event_at,
    inject,
    input_task,
    make_loop,
    make_runner,
    start_run,
    submit,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, ScriptedLLM, text, tool_call, usage


def turns(events, run_id, phase):
    return [e for e in events if isinstance(e, TurnEvent) and e.run_id == run_id and e.phase == phase]


def summary_of(events, run_id):
    return next(e.summary for e in reversed(events) if isinstance(e, RunEvent) and e.run_id == run_id
                and e.summary is not None)


def assert_turns_well_formed(events, run_id):
    """验收 7：started/completed 成对、序号连续；tool_call_ids 与该轮 called 事件一致；汇总等于逐轮之和。"""
    started = turns(events, run_id, TurnPhase.STARTED)
    completed = turns(events, run_id, TurnPhase.COMPLETED)
    assert [t.index for t in started] == list(range(1, len(started) + 1))
    assert [t.index for t in completed] == [t.index for t in started]
    for start, end in zip(started, completed):
        assert start.seq < end.seq
        assert start.context_window == 32000
        batch = [e for e in events if isinstance(e, ToolEvent) and e.run_id == run_id
                 and e.status == "called" and start.seq < e.seq < end.seq]
        assert end.tool_call_ids == [e.tool_call_id for e in batch]
        if end.error is None:
            assert end.attempts >= 1 and end.model_ms is not None and end.model_ms >= 0
    summary = summary_of(events, run_id)
    assert summary["turns"] == len(started)
    assert summary["model_requests"] == sum(t.attempts or 0 for t in completed)
    assert summary["prompt_tokens"] == sum((t.usage.prompt_tokens or 0) if t.usage else 0 for t in completed)
    assert summary["completion_tokens"] == sum((t.usage.completion_tokens or 0) if t.usage else 0 for t in completed)
    assert summary["tool_calls"] == len([e for e in events if isinstance(e, ToolEvent) and e.run_id == run_id
                                         and e.status == "called"])
    assert summary["duration_ms"] is not None and summary["duration_ms"] >= 0


def assert_rebuild_matches(events, run: Run, llm: ScriptedLLM, indexes: Sequence[int]):
    """验收 8：indexes 是由这个 llm 服务的轮次（按顺序）；每轮取其第一次尝试的实际请求比较。"""
    completed = {t.index: t for t in turns(events, run.id, TurnPhase.COMPLETED)}
    position = 0
    for index in indexes:
        rebuilt = rebuild_request(events, run, index)
        actual = llm.requests[position]
        assert rebuilt.messages == actual.messages, f"第 {index} 轮消息不一致"
        assert rebuilt.tools == actual.tools, f"第 {index} 轮工具不一致"
        position += (completed[index].attempts or 1) if index in completed else 1
    assert position == len(llm.requests)


def stored_run(h, run_id) -> Run:
    return h.runs[run_id].model_copy(deep=True)


def test_multi_turn_with_retry_truncation_and_batch():
    async def run():
        h = make_loop([
            ScriptedResponse(content="先读两份", tool_calls=[
                ScriptedToolCall("read_file", {"filepath": "/a.txt"}, id="c-a"),
                ScriptedToolCall("echo", {"text": "b"}, id="c-b"),
            ], usage=usage(100, 10)),
            ConnectionError("受控断连"),
            text("半截", finish_reason="length", usage=usage(150, 50)),
            text("完成", usage=usage(160, 5)),
        ])
        task = input_task()
        active = await start_run(h, task, "读取并总结")
        await make_runner(h, run=active).invoke(task)
        events = h.events
        assert h.runs[active.id].status == RunStatus.COMPLETED
        assert_turns_well_formed(events, active.id)
        completed = turns(events, active.id, TurnPhase.COMPLETED)
        assert [(t.attempts, t.finish_reason, t.tool_call_ids) for t in completed] == [
            (1, "tool_calls", ["c-a", "c-b"]), (2, "length", []), (1, "stop", [])]
        assert summary_of(events, active.id)["model_requests"] == 4
        assert_rebuild_matches(events, stored_run(h, active.id), h.llm, [1, 2, 3])
        # 同一顺序：最终消息 → turn(completed) → done → run(completed)
        assert [e.type for e in events[-4:]] == ["message", "turn", "done", "run"]
        with pytest.raises(TurnNotFoundError):
            rebuild_request(events, stored_run(h, active.id), 4)
    asyncio.run(asyncio.wait_for(run(), 5))


def test_ask_aborted_batch_completes_turn_and_resume_rebuilds():
    async def run():
        plan = [{"step": "确认路径", "status": "in_progress"}]
        first = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall("update_plan", {"plan": plan}, id="c-plan"),
            ScriptedToolCall("message_ask_user", {"text": "路径？"}, id="c-ask"),
            ScriptedToolCall("echo", {"text": "after"}, id="c-after"),
        ], usage=usage(50, 5))])
        task = input_task()
        active = await start_run(first, task, "核对文件")
        await make_runner(first, run=active).invoke(task)
        events = first.events
        completed = turns(events, active.id, TurnPhase.COMPLETED)
        assert len(completed) == 1 and completed[0].tool_call_ids == ["c-plan"]
        assert [e.type for e in events[-4:]] == ["message", "turn", "wait", "run"]
        assert first.runs[active.id].status == RunStatus.WAITING

        second = make_loop([tool_call("read_file", {"filepath": "/x.txt"}, id="c-read", usage=usage(80, 5)),
                            text("完成", usage=usage(90, 3))], session=first.session)
        reply = MessageEvent(role="user", message="/x.txt")
        await second.ledger.transition(first.session.id, active.id, RunStatus.RUNNING, events_after=[reply])
        task2 = input_task()
        await submit(task2, "/x.txt")
        await make_runner(second, run=first.runs[active.id], prior_status=SessionStatus.WAITING).invoke(task2)
        events = second.events
        assert_turns_well_formed(events, active.id)
        run_model = stored_run(second, active.id)
        assert_rebuild_matches(events, run_model, first.llm, [1])
        assert_rebuild_matches(events, run_model, second.llm, [2, 3])
    asyncio.run(asyncio.wait_for(run(), 5))


def test_mid_run_injection_is_rebuilt():
    async def run():
        h = make_loop([
            tool_call("echo", {"text": "old"}, id="c-old", usage=usage(40, 4)),
            text("两件事都完成", usage=usage(60, 6)),
        ])
        task = input_task()
        active = await start_run(h, task, "做第一件事")

        async def on_publish(seq):
            e = event_at(h, seq)
            if isinstance(e, ToolEvent) and e.tool_call_id == "c-old" and e.status == "calling":
                await inject(h, task, active.id, "顺便做第二件事")
        h.notifier.on_publish = on_publish
        await make_runner(h, run=active).invoke(task)
        assert h.llm.requests[1].messages[-1] == {"role": "user", "content": "顺便做第二件事"}
        assert_turns_well_formed(h.events, active.id)
        assert_rebuild_matches(h.events, stored_run(h, active.id), h.llm, [1, 2])
    asyncio.run(asyncio.wait_for(run(), 5))


def test_resume_after_stop_is_rebuilt():
    async def run():
        first = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall("echo", {"text": "long"}, id="c-long"),
            ScriptedToolCall("echo", {"text": "next"}, id="c-next"),
        ], usage=usage(30, 3))])
        started = asyncio.Event()

        async def block(_):
            started.set()
            await asyncio.Event().wait()
        first.recording.hook = block
        task = input_task()
        stopped = await start_run(first, task, "长任务")
        execution = asyncio.create_task(make_runner(first, run=stopped).invoke(task))
        await started.wait()
        await first.ledger.transition(first.session.id, stopped.id, RunStatus.CANCELLED, "user_stop")
        execution.cancel()
        with pytest.raises(asyncio.CancelledError):
            await execution
        # 没有运行器快照时，终态事务为被中止的轮次补一条只带原因的 completed，轮次仍成对
        closing = turns(first.events, stopped.id, TurnPhase.COMPLETED)
        assert [(t.index, t.error, t.attempts, t.tool_call_ids) for t in closing] == [(1, "user_stop", None, [])]
        assert summary_of(first.events, stopped.id)["turns"] == 1

        second = make_loop([text("按新要求处理", usage=usage(70, 7))], session=first.session)
        task2 = input_task()
        next_run = await start_run(second, task2, "换个做法")
        await make_runner(second, run=next_run, prior_status=SessionStatus.CANCELLED).invoke(task2)
        events = second.events
        assert_turns_well_formed(events, next_run.id)
        assert_rebuild_matches(events, stored_run(second, stopped.id), first.llm, [1])
        assert_rebuild_matches(events, stored_run(second, next_run.id), second.llm, [1])
    asyncio.run(asyncio.wait_for(run(), 5))


def test_tool_set_change_on_resume_is_recorded_as_revision():
    async def run():
        from app.domain.services.tools.base import BaseTool, tool
        from app.domain.models.tool_result import ToolResult

        class ExtraTool(BaseTool):
            name = "extra"

            @tool(name="extra_ping", description="新接入的工具", parameters={}, required=[])
            async def extra_ping(self) -> ToolResult:
                return ToolResult(success=True)

        first = make_loop([tool_call("message_ask_user", {"text": "继续吗？"}, id="c-ask")])
        task = input_task()
        active = await start_run(first, task, "开始")
        await make_runner(first, run=active).invoke(task)

        second = make_loop([text("好的")], session=first.session, extra_tools=[ExtraTool()])
        await second.ledger.transition(first.session.id, active.id, RunStatus.RUNNING,
                                       events_after=[MessageEvent(role="user", message="继续")])
        task2 = input_task()
        await submit(task2, "继续")
        await make_runner(second, run=first.runs[active.id], prior_status=SessionStatus.WAITING).invoke(task2)
        snapshot = second.runs[active.id].config_snapshot
        assert [r["from_turn"] for r in snapshot["tool_revisions"]] == [2]
        run_model = stored_run(second, active.id)
        assert_rebuild_matches(second.events, run_model, first.llm, [1])
        assert_rebuild_matches(second.events, run_model, second.llm, [2])
        assert "extra_ping" not in [t["function"]["name"] for t in rebuild_request(second.events, run_model, 1).tools]
    asyncio.run(asyncio.wait_for(run(), 5))
