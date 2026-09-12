"""第七章的确定性夹具：保留真实双循环，替换模型与外部资源。"""
import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domain.models.app_config import AgentConfig
from app.domain.models.event import (
    DoneEvent, ErrorEvent, PlanEvent, PlanEventStatus, StepEvent, StepEventStatus,
)
from app.domain.models.llm import LLMInvokeResult
from app.domain.models.memory import Memory
from app.domain.models.message import Message
from app.domain.models.plan import ExecutionStatus
from app.domain.models.session import Session
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.planner_react import PlannerReActFlow


def response(content):
    return {"role": "assistant", "content": json.dumps(content, ensure_ascii=False)}


def read_call(call_id, filepath):
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": call_id,
            "type": "function",
            "function": {
                "name": "read_file",
                "arguments": json.dumps({"filepath": filepath}),
            },
        }],
    }


def initial_plan():
    return response({"steps": [
        {"id": "first", "description": "read_file 核对记录"},
        {"id": "second", "description": "read_file 核对报告"},
    ]})


def make_flow(responses, session=None):
    session = session if session is not None else Session(id="lesson-07")
    requests = []
    remaining = list(responses)

    async def invoke(**kwargs):
        requests.append(deepcopy(kwargs))
        return LLMInvokeResult(message=remaining.pop(0))

    async def get_memory(session_id, name):
        assert session_id == session.id
        return session.memories.get(name, Memory()).model_copy(deep=True)

    async def save_memory(session_id, name, memory):
        assert session_id == session.id
        session.memories[name] = memory.model_copy(deep=True)

    repository = SimpleNamespace(
        get_by_id=AsyncMock(return_value=session),
        update_status=AsyncMock(),
        get_memory=get_memory,
        save_memory=save_memory,
    )

    class FakeUow:
        def __init__(self):
            self.session = repository

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
        llm=SimpleNamespace(invoke=invoke, context_window=32000),
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
    flow.react.compact_memory = AsyncMock(wraps=flow.react.compact_memory)
    return SimpleNamespace(
        flow=flow, session=session, sandbox=sandbox, requests=requests, remaining=remaining,
    )


async def run_flow(harness):
    # 事件携带可变的 Plan/Step；保留每次交接时的快照。
    return [event.model_copy(deep=True) async for event in harness.flow.invoke(
        Message(message="核对记录，再核对报告")
    )]


@pytest.mark.parametrize("keep_second,first_success", [(True, True), (False, True), (True, False)])
def test_plan_update_controls_next_step(keep_second, first_success):
    updated_steps = [{"id": "second", "description": "read_file 依据新发现核对报告"}]
    responses = [
        initial_plan(),
        read_call("read-1", "/records.txt"),
        response({"success": first_success, "result": "记录核对结果"}),
        response({"steps": updated_steps if keep_second else []}),
    ]
    if keep_second:
        responses.extend([
            read_call("read-2", "/report.txt"),
            response({"success": True, "result": "报告核对结果"}),
            response({"steps": [{"id": "extra", "description": "补充核对"}]}),
        ])
    responses.append(response({"message": "核对结束", "attachments": []}))
    harness = make_flow(responses)
    events = asyncio.run(asyncio.wait_for(run_flow(harness), timeout=5))

    assert not harness.remaining
    assert not any(isinstance(event, ErrorEvent) for event in events)
    started = [event.step.id for event in events
               if isinstance(event, StepEvent) and event.status == StepEventStatus.STARTED]
    assert started == (["first", "second"] if keep_second else ["first"])
    updates = [event.plan for event in events
               if isinstance(event, PlanEvent) and event.status == PlanEventStatus.UPDATED]
    assert [step.id for step in updates[0].steps] == started
    assert updates[0].steps[0].status == ExecutionStatus.COMPLETED
    assert updates[0].steps[0].success is first_success
    if keep_second:
        assert updates[0].steps[1].description == updated_steps[0]["description"]
        # 最后一步结束后的新待办不会并入旧计划。
        assert [step.id for step in updates[-1].steps] == ["first", "second"]
        assert all(step.done for step in updates[-1].steps)
    assert harness.flow.plan.status == ExecutionStatus.COMPLETED
    assert isinstance(events[-1], DoneEvent)
    assert harness.flow.react.compact_memory.await_count == len(started)
    assert [call.kwargs["filepath"] for call in harness.sandbox.read_file.await_args_list] == (
        ["/records.txt", "/report.txt"] if keep_second else ["/records.txt"]
    )
    assert harness.requests[0]["tool_choice"] == "none"
    assert harness.requests[3]["tool_choice"] == "none"
    planner_update = harness.requests[3]["messages"][-1]["content"]
    assert "记录核对结果" in planner_update
    assert f'"success":{str(first_success).lower()}' in planner_update
    tool_result = harness.requests[2]["messages"][-1]
    assert tool_result["role"] == "tool"
    assert tool_result["tool_call_id"] == "read-1"
    assert json.loads(tool_result["content"])["data"]["content"] == "fixture observation"
    assert set(harness.session.memories) == {"planner", "react"}


def test_failed_step_stops_before_compaction_update_and_summary():
    harness = make_flow([initial_plan(), response([])])
    events = asyncio.run(asyncio.wait_for(run_flow(harness), timeout=5))

    assert len(harness.requests) == 2
    assert harness.flow.plan.status == ExecutionStatus.FAILED
    assert harness.flow.plan.steps[0].status == ExecutionStatus.FAILED
    assert harness.flow.plan.steps[1].status == ExecutionStatus.PENDING
    assert any(isinstance(event, ErrorEvent) for event in events)
    assert not any(isinstance(event, PlanEvent) and event.status == PlanEventStatus.UPDATED
                   for event in events)
    harness.flow.react.compact_memory.assert_not_awaited()
    harness.sandbox.read_file.assert_not_awaited()
    assert isinstance(events[-1], DoneEvent)
