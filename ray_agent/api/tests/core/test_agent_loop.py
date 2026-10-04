"""W1 单循环验收：用 ScriptedLLM 驱动真实 AgentLoop 与工具管线，编号对应子计划“验收·自动测试”。"""
import asyncio
import json

import pytest

from app.domain.models.event import (
    DoneEvent,
    ErrorEvent,
    MessageEvent,
    PlanEvent,
    PlanEventStatus,
    TitleEvent,
    ToolEvent,
    ToolEventStatus,
    TurnEvent,
    TurnPhase,
    WaitEvent,
)
from app.domain.models.file import File
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.plan import ExecutionStatus
from app.domain.models.session import DEFAULT_SESSION_TITLE, Session, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.agent_loop import (
    AGENT_MEMORY_NAME,
    INTERRUPTED_FAILED,
    INTERRUPTED_STOPPED,
    NOT_EXECUTED_FAILED,
    NOT_EXECUTED_STOPPED,
    NOT_EXECUTED_WAITING,
    TRUNCATION_PROMPT,
    RunEndReason,
)
from tests.support.loop_harness import assert_no_dangling, make_loop, memory_messages, tool_results
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call, usage


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


async def collect(loop, message="任务", **kwargs):
    return [event.model_copy(deep=True) async for event in loop.invoke(Message(message=message), **kwargs)]


def called(events):
    return [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED]


def turns_completed(events):
    return [e for e in events if isinstance(e, TurnEvent) and e.phase == TurnPhase.COMPLETED]


def assert_clean_script(h):
    assert h.llm.remaining == 0 and h.llm.exhausted_calls == 0


# 1 --------------------------------------------------------------------------

def test_batch_with_two_calls_and_update_plan_runs_in_order_and_pairs_by_id():
    plan = [{"step": "读取资料", "status": "completed"}, {"step": "整理结论", "status": "in_progress"},
            {"step": "交付", "status": "pending"}]
    h = make_loop([
        ScriptedResponse(content="先读两份资料并写计划", tool_calls=[
            ScriptedToolCall("echo", {"text": "a"}, id="c-a"),
            ScriptedToolCall("update_plan", {"plan": plan}, id="c-plan"),
            ScriptedToolCall("echo", {"text": "b"}, id="c-b"),
        ]),
        text("完成"),
        text("仍有未完成条目"),
    ])
    events = run(collect(h.loop))

    assert_clean_script(h)
    assert h.recording.calls == ["echo:a", "echo:b"]
    assert [e.tool_call_id for e in called(events)] == ["c-a", "c-plan", "c-b"]
    # 事件顺序：called(plan) 之后紧跟 PlanEvent，再执行下一个调用
    kinds = [(type(e).__name__, getattr(e, "tool_call_id", None)) for e in events
             if isinstance(e, (ToolEvent, PlanEvent)) and getattr(e, "status", None) != ToolEventStatus.CALLING]
    assert kinds == [("ToolEvent", "c-a"), ("ToolEvent", "c-plan"), ("PlanEvent", None), ("ToolEvent", "c-b")]
    plan_event = next(e for e in events if isinstance(e, PlanEvent))
    assert plan_event.status == PlanEventStatus.UPDATED
    assert [(s.id, s.description, s.status) for s in plan_event.plan.steps] == [
        ("1", "读取资料", ExecutionStatus.COMPLETED),
        ("2", "整理结论", ExecutionStatus.RUNNING),
        ("3", "交付", ExecutionStatus.PENDING),
    ]

    second = h.llm.requests[1].messages
    assistant = next(m for m in second if m.get("role") == "assistant")
    assert [c["id"] for c in assistant["tool_calls"]] == ["c-a", "c-plan", "c-b"]
    assert [m["tool_call_id"] for m in second if m.get("role") == "tool"] == ["c-a", "c-plan", "c-b"]
    results = tool_results(second)
    assert results["c-a"]["data"] == {"echo": "a"} and results["c-b"]["data"] == {"echo": "b"}
    assert results["c-plan"]["success"] is True
    assert isinstance(events[-1], DoneEvent) and h.loop.end_reason == RunEndReason.COMPLETED
    assert [e.message for e in events if isinstance(e, MessageEvent)][0] == "先读两份资料并写计划"
    assert "执行记录仍有未完成项" in [e.message for e in events if isinstance(e, MessageEvent)][-1]
    assert h.loop._completion_feedbacks == 1
    assert not any(isinstance(e, TitleEvent) for e in events)


@pytest.mark.parametrize("title", [DEFAULT_SESSION_TITLE, "已有标题"])
def test_title_is_managed_outside_agent_loop(title):
    h = make_loop([text("好")], session=Session(id="w1-title", title=title))
    events = run(collect(h.loop, message="  " + "一二三四五六七八九十" * 4))
    titles = [e.title for e in events if isinstance(e, TitleEvent)]
    assert titles == []
    assert h.llm.call_count == 1


# 2 --------------------------------------------------------------------------

def test_unknown_tool_bad_json_and_schema_errors_become_results_and_loop_continues():
    h = make_loop([
        ScriptedResponse(tool_calls=[
            ScriptedToolCall("no_such_tool", {}, id="c-unknown"),
            ScriptedToolCall("echo", "{not json", id="c-json"),
            ScriptedToolCall("echo", {}, id="c-missing"),
            ScriptedToolCall("echo", {"text": 3}, id="c-type"),
        ]),
        text("已处理"),
    ])
    events = run(collect(h.loop))

    assert_clean_script(h)
    assert h.recording.calls == []
    results = tool_results(h.llm.requests[1].messages)
    assert {k: v["success"] for k, v in results.items()} == {
        "c-unknown": False, "c-json": False, "c-missing": False, "c-type": False}
    assert "未知工具" in results["c-unknown"]["message"]
    assert "JSON" in results["c-json"]["message"]
    assert "缺少必填参数" in results["c-missing"]["message"]
    assert "类型" in results["c-type"]["message"]
    # 短路调用只有 called 事件，没有 calling
    assert not [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLING]
    assert len(called(events)) == 4
    assert not any(isinstance(e, ErrorEvent) for e in events)
    assert isinstance(events[-1], DoneEvent)


# 3 --------------------------------------------------------------------------

def test_tool_exception_runs_once_and_becomes_failed_result():
    h = make_loop([tool_call("boom", id="c-boom"), text("换个办法")])
    events = run(collect(h.loop))

    assert_clean_script(h)
    assert h.recording.calls == ["boom"]
    result = tool_results(h.llm.requests[1].messages)["c-boom"]
    assert result["success"] is False and "受控异常" in result["message"]
    assert [e.status for e in events if isinstance(e, ToolEvent)] == [ToolEventStatus.CALLING, ToolEventStatus.CALLED]
    assert isinstance(events[-1], DoneEvent)


# 4 --------------------------------------------------------------------------

def test_ask_in_middle_of_batch_waits_and_resume_repairs_following_calls():
    first = make_loop([ScriptedResponse(content="先确认文件名", tool_calls=[
        ScriptedToolCall("echo", {"text": "before"}, id="c-before"),
        ScriptedToolCall("message_ask_user", {"text": "文件名用什么？"}, id="c-ask"),
        ScriptedToolCall("echo", {"text": "after"}, id="c-after"),
    ])])
    events = run(collect(first.loop))

    assert_clean_script(first)
    assert first.recording.calls == ["echo:before"]
    assert isinstance(events[-1], WaitEvent) and first.loop.end_reason == RunEndReason.WAITING
    assert [e.message for e in events if isinstance(e, MessageEvent)] == ["先确认文件名", "文件名用什么？"]
    assert "c-ask" not in {e.tool_call_id for e in events if isinstance(e, ToolEvent)}

    first.session.status = SessionStatus.WAITING  # 运行器收到 WaitEvent 后写入
    second = make_loop([text("好的，已记下")], session=first.session)
    events = run(collect(second.loop, message="a.json"))

    assert_clean_script(second)
    assert second.recording.calls == []
    request = second.llm.requests[0].messages
    assert_no_dangling(request)
    results = tool_results(request)
    assert results["c-ask"]["success"] is True and results["c-ask"]["data"]["reply"] == "a.json"
    assert results["c-after"] == {"success": False, "message": NOT_EXECUTED_WAITING, "data": None}
    # 回复已作为提问结果，不重复追加为用户消息
    assert not [m for m in request if m.get("role") == "user" and m.get("content") == "a.json"]
    assert request[-1]["role"] == "tool"
    assert isinstance(events[-1], DoneEvent)


# 5 --------------------------------------------------------------------------

def test_injected_message_is_appended_before_next_request_without_interrupting_tool():
    h = make_loop([tool_call("echo", {"text": "slow"}, id="c-slow"), text("按补充要求完成")])
    inbox = []

    async def hook(_):
        inbox.append(Message(message="补充：结果用英文"))

    async def drain():
        taken = list(inbox)
        inbox.clear()
        return taken

    h.recording.hook = hook
    events = run(collect(h.loop, drain_injected_messages=drain))

    assert_clean_script(h)
    assert h.recording.calls == ["echo:slow"]
    assert [e.tool_call_id for e in called(events)] == ["c-slow"]
    assert not any(m.get("content") == "补充：结果用英文" for m in h.llm.requests[0].messages)
    second = h.llm.requests[1].messages
    assert [m["role"] for m in second[-3:]] == ["assistant", "tool", "user"]
    assert second[-2]["tool_call_id"] == "c-slow"
    assert second[-1]["content"] == "补充：结果用英文"
    assert isinstance(events[-1], DoneEvent)


# 6 --------------------------------------------------------------------------

@pytest.mark.parametrize("exists", [True, False])
def test_deliver_files_attaches_existing_file_and_reports_missing(exists):
    path = "/home/ubuntu/out.json" if exists else "/home/ubuntu/missing.json"
    delivered = []

    async def deliver_file(p):
        if p != "/home/ubuntu/out.json":
            raise FileNotFoundError(f"沙箱中不存在文件 {p}，请先写入文件再交付")
        delivered.append(p)
        return File(id="file-1", filename="out.json", filepath=p, size=12)

    h = make_loop([tool_call("deliver_files", {"paths": [path], "note": "请查收"}, id="c-deliver"), text("完成")] + ([] if exists else [text("文件未交付")]),
                  deliver_file=deliver_file)
    events = run(collect(h.loop))

    assert_clean_script(h)
    result = tool_results(h.llm.requests[1].messages)["c-deliver"]
    attachment_messages = [e for e in events if isinstance(e, MessageEvent) and e.attachments]
    assert result["data"]["items"][0]["path"] == path
    if exists:
        assert delivered == [path]
        assert result["success"] is True and result["data"]["items"][0]["file"]["id"] == "file-1"
        assert len(attachment_messages) == 1
        assert attachment_messages[0].message == "请查收"
        assert [f.id for f in attachment_messages[0].attachments] == ["file-1"]
        # 附件消息紧跟交付调用的 called 事件
        index = events.index(next(e for e in called(events) if e.tool_call_id == "c-deliver"))
        assert events[index + 1] is not None and events[index + 1].attachments
    else:
        assert result["success"] is False
        assert result["data"]["items"][0]["success"] is False
        assert "不存在" in result["data"]["items"][0]["error"]
        assert attachment_messages == []
    assert isinstance(events[-1], DoneEvent)


# 7 --------------------------------------------------------------------------

def test_length_truncation_discards_calls_retries_once_then_fails():
    h = make_loop([
        tool_call("echo", {"text": "半截"}, id="c-cut", finish_reason="length", usage=usage(100, 50)),
        text("还是太长", finish_reason="length"),
    ])
    events = run(collect(h.loop))

    assert_clean_script(h)
    assert h.recording.calls == []
    assert not called(events)
    retry = h.llm.requests[1].messages
    assert retry[-1] == {"role": "user", "content": TRUNCATION_PROMPT}
    assert not any(m.get("role") == "assistant" for m in retry)
    assert h.loop.end_reason == RunEndReason.OUTPUT_TRUNCATED
    assert isinstance(events[-1], ErrorEvent) and "output_truncated" in events[-1].error
    assert [(e.attempts, e.finish_reason) for e in turns_completed(events)] == [(1, "length"), (1, "length")]
    assert not any(m.get("role") == "assistant" for m in memory_messages(h.session))


def test_single_truncation_recovers():
    h = make_loop([text("半截", finish_reason="length"), text("短答复")])
    events = run(collect(h.loop))
    assert_clean_script(h)
    assert h.loop.end_reason == RunEndReason.COMPLETED
    assert [e.message for e in events if isinstance(e, MessageEvent)] == ["短答复"]


# 8 --------------------------------------------------------------------------

def test_max_iterations_counts_model_requests_including_retries():
    h = make_loop([
        ConnectionError("连接中断"),
        tool_call("echo", {"text": "1"}),
        tool_call("echo", {"text": "2"}),
    ], max_iterations=2)
    events = run(collect(h.loop))

    assert h.llm.call_count == 2 and h.llm.remaining == 1
    assert h.recording.calls == ["echo:1"]
    assert h.loop.end_reason == RunEndReason.MAX_ITERATIONS
    assert isinstance(events[-1], ErrorEvent)
    assert "max_iterations" in events[-1].error and "2" in events[-1].error
    assert_no_dangling(memory_messages(h.session))


# 9 --------------------------------------------------------------------------

@pytest.mark.parametrize("status,interrupted,expected", [
    (SessionStatus.CANCELLED, INTERRUPTED_STOPPED, NOT_EXECUTED_STOPPED),
    (SessionStatus.INTERRUPTED, INTERRUPTED_STOPPED, NOT_EXECUTED_STOPPED),
    (SessionStatus.FAILED, INTERRUPTED_FAILED, NOT_EXECUTED_FAILED),
])
def test_message_after_stop_or_failure_repairs_dangling_calls(status, interrupted, expected):
    async def scenario():
        first = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall("echo", {"text": "long"}, id="c-long"),
            ScriptedToolCall("echo", {"text": "next"}, id="c-next"),
        ])])
        started = asyncio.Event()

        async def block(_):
            started.set()
            await asyncio.Event().wait()

        first.recording.hook = block

        async def persist_events():
            async for event in first.loop.invoke(Message(message="任务")):
                await first.ledger.append(first.session.id, [event])

        task = asyncio.create_task(persist_events())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        first.session.status = status
        assert [c["id"] for c in memory_messages(first.session)[-1]["tool_calls"]] == ["c-long", "c-next"]

        second = make_loop([text("好的")], session=first.session)
        events = await collect(second.loop, message="继续")
        return first, second, events

    first, second, events = run(scenario())
    request = second.llm.requests[0].messages
    assert_no_dangling(request)
    results = tool_results(request)
    # c-long 已发出 calling 事件，可能已产生副作用；c-next 从未开始
    assert results["c-long"]["message"] == interrupted and results["c-next"]["message"] == expected
    assert request[-1] == {"role": "user", "content": "继续"}
    assert isinstance(events[-1], DoneEvent)


# 10 -------------------------------------------------------------------------

def test_pipeline_short_circuit_skips_execution_but_runs_after_handlers():
    h = make_loop([tool_call("echo", {"text": "x"}, id="c-deny"), text("收到拒绝")])
    order = []

    async def deny(invocation):
        order.append("before:deny")
        return ToolResult(success=False, message="策略拒绝")

    async def never(invocation):
        order.append("before:never")

    async def after(invocation, result):
        order.append(f"after:{invocation.short_circuited}:{invocation.duration_ms is not None}")
        return result

    h.loop.pipeline.add_before(deny)
    h.loop.pipeline.add_before(never)
    h.loop.pipeline.add_after(after)
    events = run(collect(h.loop))

    assert h.recording.calls == []
    assert order == ["before:deny", "after:True:True"]
    tool_events = [e for e in events if isinstance(e, ToolEvent)]
    assert [e.status for e in tool_events] == [ToolEventStatus.CALLED]
    assert tool_events[0].duration_ms is not None and tool_events[0].duration_ms >= 0
    assert tool_results(h.llm.requests[1].messages)["c-deny"]["message"] == "策略拒绝"


def test_pipeline_handlers_run_in_order_and_after_result_replaces_memory():
    h = make_loop([tool_call("echo", {"text": "raw"}, id="c-shape"), text("完成")])
    order = []

    def before(name):
        async def handler(invocation):
            order.append(name)
        return handler

    def after(name, replace=False):
        async def handler(invocation, result):
            order.append(name)
            if replace:
                return ToolResult(success=True, message="已整形", data={"preview": result.data["echo"][:2]})
            return result
        return handler

    h.loop.pipeline.add_before(before("b1"))
    h.loop.pipeline.add_before(before("b2"))
    h.loop.pipeline.add_after(after("a1", replace=True))
    h.loop.pipeline.add_after(after("a2"))
    events = run(collect(h.loop))

    assert order == ["b1", "b2", "a1", "a2"]
    assert h.recording.calls == ["echo:raw"]
    assert tool_results(memory_messages(h.session))["c-shape"] == {
        "success": True, "message": "已整形", "data": {"preview": "ra"}}
    assert called(events)[0].function_result.message == "已整形"


# 其他循环约定 -----------------------------------------------------------------

def test_empty_reply_is_retried_without_fake_user_message():
    h = make_loop([text("", usage=usage(10, 0)), text("答复")])
    events = run(collect(h.loop))
    assert_clean_script(h)
    assert h.llm.requests[1].messages == h.llm.requests[0].messages
    assert [m["role"] for m in memory_messages(h.session)] == ["system", "user", "assistant"]
    assert [e.attempts for e in turns_completed(events)] == [2]
    assert isinstance(events[-1], DoneEvent)


def test_non_retryable_model_error_fails_without_retry():
    h = make_loop([ValueError("参数错误"), text("不会用到")])
    events = run(collect(h.loop))
    assert h.llm.call_count == 1
    assert h.loop.end_reason == RunEndReason.MODEL_ERROR
    assert isinstance(events[-1], ErrorEvent) and "参数错误" in events[-1].error


def test_missing_call_id_is_generated_once_and_kept():
    h = make_loop([
        ScriptedResponse(tool_calls=[ScriptedToolCall("echo", {"text": "x"})]),
        text("完成"),
    ])
    h.llm._build_result_original = h.llm._build_result

    def strip_ids(response):
        result = h.llm._build_result_original(response)
        for call in result.message.get("tool_calls") or []:
            call["id"] = None
        return result

    h.llm._build_result = strip_ids
    events = run(collect(h.loop))
    assistant = next(m for m in memory_messages(h.session) if m.get("role") == "assistant")
    generated = assistant["tool_calls"][0]["id"]
    assert generated and generated.startswith("call_")
    assert called(events)[0].tool_call_id == generated
    assert list(tool_results(h.llm.requests[1].messages)) == [generated]


def test_embedded_tool_use_content_follows_same_rules():
    content = json.dumps([{"type": "tool_use", "name": "echo", "input": {"text": "嵌入"}}], ensure_ascii=False)
    h = make_loop([text(content), text("完成")])
    events = run(collect(h.loop))
    assert h.recording.calls == ["echo:嵌入"]
    assert_no_dangling(h.llm.requests[1].messages)
    assert isinstance(events[-1], DoneEvent)


def _previous_turn(ask: bool):
    call = {"id": "c-prev", "type": "function",
            "function": {"name": "message_ask_user" if ask else "browser_view", "arguments": "{}"}}
    messages = [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "上一轮"},
        {"role": "assistant", "content": "", "reasoning_content": "思考", "tool_calls": [call]},
    ]
    if not ask:
        messages += [
            {"role": "tool", "tool_call_id": "c-prev", "function_name": "browser_view", "content": "页面全文"},
            {"role": "assistant", "content": "上一轮完成"},
        ]
    return Memory(messages=messages)


@pytest.mark.parametrize("ask,status,stripped", [
    (False, SessionStatus.COMPLETED, True),  # 新用户消息：删除此前的思考内容
    (True, SessionStatus.WAITING, False),  # 回复提问：同一问，保留思考内容
])
def test_new_user_message_strips_reasoning_but_reply_does_not(ask, status, stripped):
    session = Session(id="w1-compact", title="t", status=status)
    session.memories[AGENT_MEMORY_NAME] = _previous_turn(ask)
    h = make_loop([text("好")], session=session)
    run(collect(h.loop, message="继续"))
    request = h.llm.requests[0].messages
    assert ("reasoning_content" in request[2]) is not stripped
    if not ask:
        # W2 起浏览器结果不再按工具名替换，统一走结果整形的单条上限
        assert request[3]["content"] == "页面全文"
