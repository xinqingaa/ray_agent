"""ScriptedLLM 自测：脚本顺序、请求记录、异常、耗尽与条件分支，以及接入现有流程。"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domain.models.app_config import AgentConfig
from app.domain.models.event import DoneEvent, ErrorEvent, ToolEvent, ToolEventStatus
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.session import Session
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.planner_react import PlannerReActFlow
from tests.support.scripted_llm import (
    Branch,
    ScriptedLLM,
    ScriptedResponse,
    ScriptedToolCall,
    ScriptExhaustedError,
    text,
    tool_call,
    usage,
    when_last_tool_contains,
)


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


def test_returns_items_in_order_with_defaults():
    llm = ScriptedLLM([
        text("你好", usage=usage(10, 2)),
        tool_call("read_file", {"filepath": "/a.txt"}, id="call-1"),
    ], model_name="m", temperature=0.3, max_tokens=100, context_window=2000)

    first = run(llm.invoke([{"role": "user", "content": "hi"}]))
    second = run(llm.invoke([{"role": "user", "content": "again"}]))

    assert (llm.model_name, llm.temperature, llm.max_tokens, llm.context_window) == ("m", 0.3, 100, 2000)
    assert first.message == {"role": "assistant", "content": "你好", "tool_calls": None}
    assert first.finish_reason == "stop"
    assert (first.usage.prompt_tokens, first.usage.completion_tokens, first.usage.total_tokens) == (10, 2, 12)
    assert second.usage is None
    assert second.finish_reason == "tool_calls"
    assert second.message["tool_calls"] == [{
        "id": "call-1",
        "type": "function",
        "function": {"name": "read_file", "arguments": '{"filepath": "/a.txt"}'},
    }]
    assert llm.remaining == 0 and llm.call_count == 2


def test_multiple_tool_calls_raw_arguments_and_explicit_finish_reason():
    llm = ScriptedLLM([
        ScriptedResponse(
            content="先读两个文件",
            tool_calls=[
                ScriptedToolCall("read_file", {"filepath": "/中文.txt"}),
                ScriptedToolCall("shell_execute", "{not json"),
            ],
            finish_reason="length",
        ),
        tool_call("find_files"),
    ])

    result = run(llm.invoke([]))
    later = run(llm.invoke([]))

    calls = result.message["tool_calls"]
    assert [call["id"] for call in calls] == ["call_scripted_1", "call_scripted_2"]
    assert json.loads(calls[0]["function"]["arguments"]) == {"filepath": "/中文.txt"}
    assert calls[1]["function"]["arguments"] == "{not json"
    assert result.message["content"] == "先读两个文件"
    assert result.finish_reason == "length"
    assert later.message["tool_calls"][0]["id"] == "call_scripted_3"
    assert later.message["tool_calls"][0]["function"]["arguments"] == "{}"


def test_records_copies_of_messages_and_tools():
    llm = ScriptedLLM([text("ok")])
    messages = [{"role": "user", "content": "原始"}]
    tools = [{"type": "function", "function": {"name": "read_file"}}]

    run(llm.invoke(messages, tools=tools, response_format={"type": "json_object"}, tool_choice="none"))
    messages[0]["content"] = "被修改"
    messages.append({"role": "assistant", "content": "追加"})
    tools[0]["function"]["name"] = "changed"

    request = llm.requests[0]
    assert request.messages == [{"role": "user", "content": "原始"}]
    assert request.tool_names == ["read_file"]
    assert request.response_format == {"type": "json_object"}
    assert request.tool_choice == "none"


def test_raises_scripted_exception_and_continues_after_it():
    llm = ScriptedLLM([ConnectionError("连接中断"), text("恢复")])

    with pytest.raises(ConnectionError, match="连接中断"):
        run(llm.invoke([]))
    assert run(llm.invoke([])).message["content"] == "恢复"
    assert llm.call_count == 2


def test_exhausted_script_raises_clear_error():
    llm = ScriptedLLM([text("only")])
    run(llm.invoke([]))

    with pytest.raises(ScriptExhaustedError, match="第 2 次调用"):
        run(llm.invoke([]))
    assert llm.exhausted_calls == 1
    assert llm.call_count == 2


def test_branch_selects_by_last_tool_message_and_nests():
    def script():
        return [when_last_tool_contains(
            "失败",
            then=text("重试"),
            otherwise=Branch(
                when=lambda request: "read_file" in request.tool_names,
                then=text("有读取工具"),
                otherwise=text("无工具"),
            ),
        )]

    failed = [{"role": "tool", "tool_call_id": "c1", "content": "执行失败"}]
    ok = [{"role": "tool", "tool_call_id": "c1", "content": "成功"}]
    user_only = [{"role": "user", "content": "失败"}]
    tools = [{"type": "function", "function": {"name": "read_file"}}]

    assert run(ScriptedLLM(script()).invoke(failed)).message["content"] == "重试"
    assert run(ScriptedLLM(script()).invoke(ok, tools=tools)).message["content"] == "有读取工具"
    # 最后一条不是 tool 消息时，不按用户文本误判。
    assert run(ScriptedLLM(script()).invoke(user_only)).message["content"] == "无工具"


def test_branch_can_choose_exception():
    llm = ScriptedLLM([when_last_tool_contains("x", then=TimeoutError("超时"), otherwise=text("ok"))])
    with pytest.raises(TimeoutError):
        run(llm.invoke([{"role": "tool", "content": "x"}]))


def _plan_json(steps):
    return json.dumps({"steps": steps}, ensure_ascii=False)


def test_drives_existing_planner_react_flow():
    """替身可直接替换产品模型对象：真实双循环读完文件并结束。"""
    session = Session(id="scripted")
    llm = ScriptedLLM([
        text(_plan_json([{"id": "s1", "description": "read_file 读取记录"}]), usage=usage(100, 20)),
        tool_call("read_file", {"filepath": "/records.txt"}, id="read-1"),
        when_last_tool_contains(
            "fixture observation",
            then=text(json.dumps({"success": True, "result": "已读取"}, ensure_ascii=False)),
            otherwise=text(json.dumps({"success": False, "result": "未读到"}, ensure_ascii=False)),
        ),
        text(_plan_json([])),
        text(json.dumps({"message": "完成", "attachments": []}, ensure_ascii=False)),
    ])

    async def get_memory(session_id, name):
        return session.memories.get(name, Memory()).model_copy(deep=True)

    async def save_memory(session_id, name, memory):
        session.memories[name] = memory.model_copy(deep=True)

    repository = SimpleNamespace(
        get_by_id=AsyncMock(return_value=session),
        update_status=AsyncMock(),
        get_memory=get_memory,
        save_memory=save_memory,
    )

    class FakeUow:
        session = repository

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    sandbox = SimpleNamespace(read_file=AsyncMock(
        return_value=ToolResult(success=True, data={"content": "fixture observation"}),
    ))
    external_tool = MagicMock()
    external_tool.get_tools.return_value = []
    flow = PlannerReActFlow(
        uow_factory=FakeUow,
        llm=llm,
        agent_config=AgentConfig(max_retries=2, max_iterations=4),
        session_id=session.id,
        json_parser=SimpleNamespace(invoke=AsyncMock(side_effect=json.loads)),
        browser=MagicMock(),
        sandbox=sandbox,
        search_engine=MagicMock(),
        mcp_tool=external_tool,
        a2a_tool=external_tool,
    )
    flow.planner._retry_interval = 0
    flow.react._retry_interval = 0

    async def collect():
        return [event async for event in flow.invoke(Message(message="读取记录"))]

    events = run(collect())

    assert llm.remaining == 0 and llm.exhausted_calls == 0
    assert not any(isinstance(event, ErrorEvent) for event in events)
    assert isinstance(events[-1], DoneEvent)
    called = [event for event in events if isinstance(event, ToolEvent) and event.status == ToolEventStatus.CALLED]
    assert [event.function_name for event in called] == ["read_file"]
    assert "read_file" in llm.requests[1].tool_names
    assert llm.requests[2].last_message["tool_call_id"] == "read-1"
