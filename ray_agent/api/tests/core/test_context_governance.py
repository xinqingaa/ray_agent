"""W2 上下文治理验收：编号对应子计划“验收·自动测试”（7 在 tests/protocols，9 在 test_turn_events_rebuild.py）。

模型用 ScriptedLLM，循环、工具管线、结果整形与压缩都是真实实现；记忆与事件用内存替身。
"""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.domain.external.llm import LLMRequestError
from app.domain.models.event import CompactEvent, ContextEvent, ContextOp, ErrorEvent, MessageEvent, ToolEvent, \
    ToolEventStatus, TurnEvent, TurnPhase, DoneEvent
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.session import Session, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.context.budget import PARTS, ContextBudget
from app.domain.services.context.compaction import plan_compaction
from app.domain.services.context.shaping import output_path
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME, RunEndReason, tool_message
from app.domain.services.prompts.compact import COMPACT_PROMPT, SUMMARY_MARKER
from app.domain.services.prompts.system import SYSTEM_PROMPT
from tests.support.loop_harness import InMemorySandbox, assert_no_dangling, make_loop, memory_messages, store_of
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call, usage

GOAL = "任务：逐份读取材料并汇总。约束：不得覆盖 source.csv。"
BIG = "资料内容" * 750  # 3000 个中文字符，约 2100 tokens
SUMMARY = "## 用户目标\n汇总材料\n## 用户明确提出的约束\n“不得覆盖 source.csv”\n## 剩余待办\n输出汇总"


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


async def collect(loop, message="继续", **kwargs):
    return [event.model_copy(deep=True) async for event in loop.invoke(Message(message=message), **kwargs)]


def echo_round(index, payload=BIG, calls=1):
    ids = [f"c-{index}-{n}" for n in range(calls)]
    assistant = {"role": "assistant", "content": f"读取第 {index} 份", "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": "echo", "arguments": json.dumps({"text": cid})}}
        for cid in ids]}
    results = [tool_message(cid, "echo", ToolResult(success=True, data={"echo": f"{cid}:{payload}"})) for cid in ids]
    return [assistant, *results]


def seeded_session(rounds, *, status=SessionStatus.COMPLETED, extra=(), user=GOAL, payload=BIG):
    """一段已有的长历史：system、用户目标，随后 rounds 轮 echo 调用；会话事件里有用户目标的 message 事件。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]
    for index in range(rounds):
        messages += echo_round(index, payload)
    messages += list(extra)
    session = Session(id=f"w2-{rounds}-{status.value}", title="t", status=status)
    session.memories[AGENT_MEMORY_NAME] = Memory(messages=messages)
    store_of(session).events.append(MessageEvent(role="user", message=user, seq=1))
    return session, messages


def of_type(events, cls):
    return [e for e in events if isinstance(e, cls)]


def main_requests(h):
    return [r for r in h.llm.requests if r.tools]


def summary_requests(h):
    return [r for r in h.llm.requests if not r.tools]


# 1 超过水位触发压缩 ----------------------------------------------------------

def test_over_watermark_compacts_and_reinjects_user_messages():
    session, original = seeded_session(10)
    h = make_loop([text(SUMMARY, usage=usage(9000, 300)), text("完成")], session=session)
    events = run(collect(h.loop, message="继续"))

    assert isinstance(events[-1], DoneEvent)
    compact = of_type(events, CompactEvent)
    assert len(compact) == 1 and compact[0].trigger == "watermark"
    assert (compact[0].summarized_turns, compact[0].kept_turns) == (7, 3)
    assert compact[0].summary == SUMMARY
    assert compact[0].reinjected_event_seqs == [1]
    assert compact[0].usage.attempts == 1 and compact[0].usage.prompt_tokens == 9000
    before, after = compact[0].before_estimate, compact[0].after_estimate
    assert before["total"] > before["watermark"] and after["total"] < before["total"]
    # 替换记录在 context(replace) 中，先于下一轮 turn(started)
    replace = next(i for i, e in enumerate(events) if isinstance(e, ContextEvent) and e.op == ContextOp.REPLACE)
    started = next(i for i, e in enumerate(events) if isinstance(e, TurnEvent) and e.phase == TurnPhase.STARTED)
    assert replace < started

    # 摘要请求：不带工具，独立提示词，记录里有较早的调用与结果
    summary_request = summary_requests(h)[0]
    assert summary_request.messages[0] == {"role": "system", "content": COMPACT_PROMPT}
    assert "c-0-0" in summary_request.messages[1]["content"] and "c-7-0" not in summary_request.messages[1]["content"]

    request = main_requests(h)[0].messages
    assert request[0]["role"] == "system"
    assert request[1]["role"] == "user" and request[1]["content"].startswith(SUMMARY_MARKER)
    assert SUMMARY in request[1]["content"]
    assert request[2] == {"role": "user", "content": GOAL}  # 摘要消息后紧跟用户原文
    kept = original[-6:]  # 最近 3 轮原样保留
    assert request[3:9] == kept
    assert request[9] == {"role": "user", "content": "继续"}
    assert_no_dangling(request)
    assert memory_messages(session) == [*request, {"role": "assistant", "content": "完成"}]
    assert h.loop.model_requests == 2


# 2 边界落在多调用批次中间时后移 ---------------------------------------------

def test_boundary_never_splits_a_multi_call_batch():
    messages = [{"role": "system", "content": "s"}, {"role": "user", "content": GOAL}]
    messages += echo_round(0, "小")
    messages += echo_round(1, BIG, calls=3)  # 三个调用的批次，结果很大
    messages += echo_round(2, "小") + echo_round(3, "小")
    rounds = Memory(messages=messages).rounds()
    assert [end - start for start, end in rounds] == [2, 4, 2, 2]

    def fits(kept):
        return sum(len(str(m.get("content"))) for m in kept) < 3000  # 放不下大批次

    plan = plan_compaction(messages, keep_turns=3, fits=fits)
    # 保留 3 轮会从大批次的助手消息开始、放不下；保留区缩到 2 轮，边界后移到整个批次之后
    assert plan.kept_turns == 2 and plan.boundary == rounds[1][1]
    assert messages[plan.boundary]["role"] == "assistant"
    summarized = messages[1:plan.boundary]
    assert [m["tool_call_id"] for m in summarized if m["role"] == "tool"] == ["c-0-0", "c-1-0", "c-1-1", "c-1-2"]
    assert_no_dangling(messages[plan.boundary:])


def test_compaction_keeps_calls_and_results_paired_end_to_end():
    session, _ = seeded_session(0, extra=[*echo_round(0, BIG, calls=3), *echo_round(1, BIG, calls=3),
                                          *echo_round(2, BIG, calls=3), *echo_round(3, "小")])
    h = make_loop([text(SUMMARY), text("完成")], session=session)
    run(collect(h.loop))
    request = main_requests(h)[0].messages
    assert request[1]["content"].startswith(SUMMARY_MARKER)
    assert_no_dangling(request)
    assert request[3]["role"] == "assistant"  # 保留区从完整的一轮开始，不以孤立的 tool 结果开头


# 3 等待回复中的批次不进入摘要 -----------------------------------------------

def test_waiting_batch_stays_in_kept_region():
    ask = {"role": "assistant", "content": "", "tool_calls": [
        {"id": "c-ask", "type": "function", "function": {"name": "message_ask_user",
                                                         "arguments": json.dumps({"text": "文件名？"})}},
        {"id": "c-after", "type": "function", "function": {"name": "echo", "arguments": json.dumps({"text": "x"})}},
    ]}
    session, _ = seeded_session(10, status=SessionStatus.WAITING, extra=[ask])
    h = make_loop([text(SUMMARY), text("完成")], session=session, agent_config={"compact_keep_turns": 1})
    events = run(collect(h.loop, message="用 out.json"))

    compact = of_type(events, CompactEvent)[0]
    assert compact.kept_turns == 1
    transcript = summary_requests(h)[0].messages[1]["content"]
    assert "c-ask" not in transcript and "c-after" not in transcript
    request = main_requests(h)[0].messages
    assert request[-3] == ask
    reply = json.loads(request[-2]["content"])
    assert request[-2]["tool_call_id"] == "c-ask" and reply["data"]["reply"] == "用 out.json"
    assert request[-1]["tool_call_id"] == "c-after"
    assert_no_dangling(request)


# 4 摘要请求失败 --------------------------------------------------------------

def test_summary_failure_after_retries_ends_with_context_limit():
    session, original = seeded_session(10)
    h = make_loop([ConnectionError("受控断连"), text("")], session=session, max_retries=2)
    events = run(collect(h.loop))

    assert isinstance(events[-1], ErrorEvent) and "context_limit" in events[-1].error
    assert h.loop.end_reason == RunEndReason.CONTEXT_LIMIT
    assert len(h.llm.requests) == 2 and not main_requests(h)
    assert not of_type(events, CompactEvent)
    assert not [e for e in events if isinstance(e, ContextEvent) and e.op == ContextOp.REPLACE]
    # 历史不被静默丢弃：记忆仍是原历史加新消息
    assert memory_messages(session)[:len(original)] == original
    assert h.loop.model_requests == 2


# 5 压缩后仍放不下 -------------------------------------------------------------

def test_still_over_limit_after_compaction_ends_with_context_limit():
    session, _ = seeded_session(3)
    huge = "超" * 40000  # 约 28000 tokens，超过 32000 窗口的可用输入上限
    h = make_loop([text(SUMMARY)], session=session)
    events = run(collect(h.loop, message=huge))

    assert len(of_type(events, CompactEvent)) == 1
    assert isinstance(events[-1], ErrorEvent) and "context_limit" in events[-1].error
    assert "超过可用输入上限" in events[-1].error
    assert not main_requests(h) and not of_type(events, TurnEvent)


def test_skips_compaction_when_only_a_small_prefix_is_summarizable():
    """越过水位但较早部分很小（最近一轮本身很大）：摘要换不回空间，不发摘要请求，放得下就继续。"""
    session, _ = seeded_session(1, payload="小", extra=echo_round(1, BIG, calls=9))
    h = make_loop([text("完成")], session=session)
    events = run(collect(h.loop))

    started = [e for e in of_type(events, TurnEvent) if e.phase == TurnPhase.STARTED][0].context_estimate
    assert started["watermark"] < started["total"] < started["limit"]
    assert isinstance(events[-1], DoneEvent)
    assert not of_type(events, CompactEvent) and not summary_requests(h)
    assert len(main_requests(h)) == 1


def test_over_limit_without_compactable_history_fails_without_summary_request():
    h = make_loop([])
    events = run(collect(h.loop, message="超" * 40000))
    assert isinstance(events[-1], ErrorEvent) and "context_limit" in events[-1].error
    assert h.llm.requests == []


def test_server_side_overflow_compacts_once_then_retries():
    session, _ = seeded_session(4)
    overflow = LLMRequestError("maximum context length exceeded", status_code=400, context_exceeded=True)
    h = make_loop([overflow, text(SUMMARY), text("完成")], session=session)
    events = run(collect(h.loop))

    assert isinstance(events[-1], DoneEvent)
    compact = of_type(events, CompactEvent)
    assert len(compact) == 1 and compact[0].trigger == "overflow"
    completed = [e for e in events if isinstance(e, TurnEvent) and e.phase == TurnPhase.COMPLETED]
    assert [e.error for e in completed] == ["context_overflow", None]
    assert main_requests(h)[1].messages[1]["content"].startswith(SUMMARY_MARKER)


def test_server_side_overflow_again_after_compaction_fails():
    session, _ = seeded_session(4)
    overflow = LLMRequestError("maximum context length exceeded", status_code=400, context_exceeded=True)
    h = make_loop([overflow, text(SUMMARY), overflow], session=session)
    events = run(collect(h.loop))
    assert isinstance(events[-1], ErrorEvent) and "context_limit" in events[-1].error


# 6 单条结果超限 ---------------------------------------------------------------

LONG_FILE = "\n".join(f"第 {i:04d} 行：" + "数据" * 20 for i in range(600)) + "\nTAIL-MARKER-W2"


def _runner_writer(sandbox):
    """与运行器相同的落盘函数（AgentTaskRunner._write_output）。"""
    return lambda path, content: AgentTaskRunner._write_output(SimpleNamespace(_sandbox=sandbox), path, content)


@pytest.mark.parametrize("fail_writes", [False, True])
def test_oversized_result_becomes_preview_with_full_copy_in_sandbox(fail_writes):
    sandbox = InMemorySandbox({"/data/big.txt": LONG_FILE}, fail_writes=fail_writes)
    h = make_loop([tool_call("read_file", {"filepath": "/data/big.txt", "max_length": 100000}, id="c-big"),
                   text("完成")], sandbox=sandbox, write_output=_runner_writer(sandbox))
    events = run(collect(h.loop, message="读取大文件"))

    content = main_requests(h)[1].last_tool_content
    assert len(content) <= 8000
    preview = json.loads(content)
    assert preview["success"] is True and preview["data"]["truncated"] is True
    assert preview["data"]["head"].startswith("success: true")
    assert preview["data"]["tail"].endswith("TAIL-MARKER-W2")
    called = [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED][0]
    assert called.function_result.model_dump(mode="json") == preview  # called 事件记录的就是进入上下文的预览
    assert called.shaping.original_chars == preview["data"]["total_chars"] > 8000
    path = output_path("c-big")
    if fail_writes:
        assert called.shaping.full_output_path is None and "磁盘已满" in called.shaping.error
        assert "不可再读" in preview["data"]["note"] and path not in sandbox.files
    else:
        assert path == "/home/ubuntu/.rayagent/outputs/c-big.txt"
        assert called.shaping.full_output_path == path and preview["data"]["full_output_path"] == path
        assert path in preview["data"]["note"] and "read_file" in preview["data"]["note"]
        assert LONG_FILE in sandbox.files[path]  # 完整内容原样落盘


def test_small_result_is_not_shaped():
    h = make_loop([tool_call("echo", {"text": "短"}, id="c-s"), text("完成")])
    events = run(collect(h.loop))
    called = [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED][0]
    assert called.shaping is None and called.function_result.data == {"echo": "短"}


# 8 容量估算四部分之和等于总估算 ---------------------------------------------

def test_estimate_parts_sum_to_total_with_and_without_usage():
    messages = [{"role": "system", "content": "系统 prompt"}, {"role": "user", "content": "你好 hello"},
                *echo_round(0, "结果 result" * 50)]
    tools = [{"type": "function", "function": {"name": "echo", "description": "回显", "parameters": {}}}]
    budget = ContextBudget(context_window=10000, max_tokens=2000, safety_ratio=0.05, watermark_ratio=0.75)
    assert (budget.limit, budget.watermark) == (7500, 5625)

    by_chars = budget.estimate(messages, tools)
    assert by_chars.method == "chars"
    assert sum(by_chars.as_dict()[name] for name in PARTS) == by_chars.total == by_chars.as_dict()["total"]
    assert all(by_chars.as_dict()[name] > 0 for name in PARTS)

    budget.record_usage(messages, tools, prompt_tokens=900)
    grown = [*messages, {"role": "user", "content": "再来一次"}]
    calibrated = budget.estimate(grown, tools)
    assert calibrated.method == "usage"
    assert sum(calibrated.as_dict()[name] for name in PARTS) == calibrated.total
    assert 900 < calibrated.total < 900 + 20  # 已知部分取 prompt_tokens，新增一条短消息按字符估算

    budget.reset()
    assert budget.estimate(grown, tools).method == "chars"


def test_turn_started_records_context_estimate():
    h = make_loop([text("好")])
    events = run(collect(h.loop, message="你好"))
    started = [e for e in events if isinstance(e, TurnEvent) and e.phase == TurnPhase.STARTED][0]
    estimate = started.context_estimate
    assert estimate["total"] == sum(estimate[name] for name in PARTS)
    assert estimate["limit"] == 32000 - 4096 - 1600 and estimate["context_window"] == 32000
    assert estimate["system_prompt"] > 0 and estimate["tools"] > 0 and estimate["history"] > 0


def test_legacy_compact_context_op_reads_as_strip_reasoning():
    event = ContextEvent.model_validate({"op": "compact"})
    assert event.op == ContextOp.STRIP_REASONING


def test_openai_client_recognizes_context_length_rejections():
    import httpx
    from openai import BadRequestError

    from app.infrastructure.external.llm.openai_llm import _is_context_exceeded

    request = httpx.Request("POST", "http://llm.test/chat/completions")

    def rejected(status, message, code=None):
        body = {"message": message, "code": code}  # SDK 传入的是响应体里的 error 对象
        return BadRequestError(message, response=httpx.Response(status, request=request), body=body)

    assert _is_context_exceeded(rejected(400, "This model's maximum context length is 65536 tokens"))
    assert _is_context_exceeded(rejected(400, "bad", code="context_length_exceeded"))
    assert not _is_context_exceeded(rejected(400, "Invalid parameter: temperature"))
    assert not _is_context_exceeded(ConnectionError("maximum context length"))
