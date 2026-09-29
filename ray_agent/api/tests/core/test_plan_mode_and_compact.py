"""W9 计划模式与手动压缩：真实 AgentLoop、工具管线、运行器与 AgentService，替换模型、存储与沙箱。

编号对应 W9 子计划「验收/自动测试」。
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.application.errors.exceptions import AppException, ConflictError, NotFoundError
from app.domain.models.event import (
    ApprovalEvent,
    CompactEvent,
    ContextEvent,
    ContextOp,
    MessageEvent,
    RunEvent,
    ToolEvent,
    ToolEventStatus,
)
from app.domain.models.run import Run, RunMode, RunReason, RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.models.tool_result import ToolResult
from app.domain.services.context.compactor import CompactionStatus, Compactor, SkipReason
from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
from app.domain.services.plan_mode import PLAN_MODE_DENIED_PREFIX
from app.domain.services.prompts.compact import SUMMARY_MARKER
from app.domain.services.prompts.plan_mode import PLAN_MODE_SUFFIX
from app.domain.services.prompts.system import SYSTEM_PROMPT
from app.domain.services.request_rebuild import rebuild_request
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.shell import ShellTool
from app.interfaces.schemas.event import EventMapper
from app.interfaces.schemas.session import RunItem
from tests.core.test_context_governance import BIG, GOAL, SUMMARY, echo_round, seeded_session
from tests.core.test_tool_approval import make_service
from tests.support.loop_harness import (
    InMemorySandbox,
    input_task,
    make_loop,
    make_runner,
    memory_messages,
    start_run,
    tool_results,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call, usage

MCP_ALIAS = "mcp_fs_write_abc"
ASK_EVERYTHING = {"mcp:*": "ask", "shell:*": "ask", "write_file": "ask"}


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


def batch(*calls):
    return ScriptedResponse(tool_calls=[ScriptedToolCall(name, args, id=call_id) for name, args, call_id in calls])


class RecordingSandbox(InMemorySandbox):
    """文件读写在内存里，find_files 与 Shell 命令记录调用。"""

    def __init__(self):
        super().__init__({"/src/app.py": "print('hi')"})
        self.calls = []

    async def write_file(self, filepath, content, **kwargs):
        self.calls.append(("write_file", filepath))
        return await super().write_file(filepath, content, **kwargs)

    async def find_files(self, dir_path, glob_pattern):
        self.calls.append(("find_files", dir_path))
        return ToolResult(success=True, data={"files": ["/src/app.py"]})

    async def exec_command(self, session_id, exec_dir, command):
        self.calls.append(("exec_command", command))
        return ToolResult(success=True, data={"output": "ok"})


class RecordingGateway:
    """MCP 夹具：只暴露一个写工具，记录实际收到的调用。"""

    def __init__(self):
        self.invoked = []

    def route(self, name):
        return ("fs", "write") if name == MCP_ALIAS else None

    async def invoke(self, name, arguments):
        self.invoked.append((name, arguments))
        return ToolResult(success=True, data={"written": True})


def mcp_tool(gateway):
    tool = MCPTool(gateway)
    tool._tools = [{"type": "function", "function": {
        "name": MCP_ALIAS, "description": "写文件（外部服务）",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}]
    return tool


SIDE_EFFECTS = batch(
    ("write_file", {"filepath": "/src/new.py", "content": "x"}, "w"),
    ("shell_execute", {"session_id": "s", "exec_dir": "/src", "command": "rm -rf build"}, "sh"),
    (MCP_ALIAS, {"path": "/x"}, "m"),
)
READS = batch(
    ("read_file", {"filepath": "/src/app.py"}, "r"),
    ("find_files", {"dir_path": "/src", "glob_pattern": "*.py"}, "f"),
)
PLAN = tool_call("update_plan", {"plan": [{"step": "改写 app.py", "status": "pending"},
                                          {"step": "运行测试", "status": "pending"}]}, id="p")


def loop_with_tools(script, *, session=None, policy=None, sandbox=None, gateway=None):
    sandbox = sandbox or RecordingSandbox()
    gateway = gateway or RecordingGateway()
    h = make_loop(script, session=session, sandbox=sandbox, tool_policy=policy,
                  extra_tools=[ShellTool(sandbox), mcp_tool(gateway)])
    h.gateway = gateway
    return h


async def run_once(h, message, mode=RunMode.NORMAL):
    task = input_task()
    event = MessageEvent(role="user", message=message)
    started = await h.ledger.start(h.session.id, events_after=[event], mode=mode)
    await task.input_stream.put(event.model_dump_json())
    await make_runner(h, run=started).invoke(task)
    return h.runs[started.id]


def tool_events(h, run_id):
    return [e for e in h.events if isinstance(e, ToolEvent) and e.run_id == run_id]


def assert_rebuilds(h, run_id, requests):
    for index, request in enumerate(requests, start=1):
        rebuilt = rebuild_request(h.events, h.runs[run_id], index)
        assert rebuilt.messages == request.messages and rebuilt.tools == request.tools


# 1–3 计划模式 --------------------------------------------------------------------

def plan_run(policy=None):
    h = loop_with_tools([SIDE_EFFECTS, READS, PLAN, text("计划如上，确认后执行")], policy=policy)
    finished = run(run_once(h, "把 app.py 改成类型化版本", mode=RunMode.PLAN))
    return h, finished


def test_plan_mode_denies_side_effect_tools_before_they_reach_sandbox_or_mcp():
    h, finished = plan_run()
    assert finished.status == RunStatus.COMPLETED and finished.mode == RunMode.PLAN
    # 被拒绝的写文件、Shell、MCP 都没有到达替身
    assert ("write_file", "/src/new.py") not in h.sandbox.calls
    assert not [c for c in h.sandbox.calls if c[0] == "exec_command"]
    assert h.gateway.invoked == [] and "/src/new.py" not in h.sandbox.files

    results = tool_results(memory_messages(h.session))
    for call_id, function in [("w", "write_file"), ("sh", "shell_execute"), ("m", MCP_ALIAS)]:
        assert results[call_id]["success"] is False
        assert results[call_id]["message"].startswith(PLAN_MODE_DENIED_PREFIX) and function in results[call_id]["message"]
        called = [e for e in tool_events(h, finished.id) if e.tool_call_id == call_id and e.status == ToolEventStatus.CALLED]
        assert len(called) == 1 and called[0].denied_by == "plan_mode"
        assert EventMapper.event_to_sse_event(called[0]).model_dump(mode="json")["data"]["denied_by"] == "plan_mode"
    # 只读工具与 update_plan 正常执行
    assert results["r"]["success"] and results["r"]["data"]["content"] == "print('hi')"
    assert results["f"]["success"] and ("find_files", "/src") in h.sandbox.calls
    assert results["p"]["success"]

    # 运行事件、配置快照与会话详情都带 mode
    run_events = [e for e in h.events if isinstance(e, RunEvent) and e.run_id == finished.id]
    assert [(e.status, e.mode) for e in run_events] == [(RunStatus.RUNNING, "plan"), (RunStatus.COMPLETED, "plan")]
    assert EventMapper.event_to_sse_event(run_events[0]).model_dump(mode="json")["data"]["mode"] == "plan"
    assert finished.config_snapshot["mode"] == "plan"
    assert RunItem.from_run(finished).mode == "plan"

    # 后缀只在请求时拼接：每次主请求的 system 带后缀，记忆里的 system 不变，快照记录完整拼接文本
    main = [r for r in h.llm.requests if r.tools]
    assert all(r.messages[0]["content"] == SYSTEM_PROMPT + PLAN_MODE_SUFFIX for r in main)
    assert memory_messages(h.session)[0]["content"] == SYSTEM_PROMPT
    assert finished.config_snapshot["system_prompt"] == SYSTEM_PROMPT + PLAN_MODE_SUFFIX
    assert_rebuilds(h, finished.id, main)


def test_plan_mode_denials_never_ask_for_approval():
    h, finished = plan_run(policy=ASK_EVERYTHING)
    assert finished.status == RunStatus.COMPLETED and finished.reason is None
    assert not [e for e in h.events if isinstance(e, ApprovalEvent)]
    assert h.gateway.invoked == [] and not [c for c in h.sandbox.calls if c[0] in ("write_file", "exec_command")]


def test_following_normal_run_executes_tools_and_snapshot_has_no_suffix():
    first, plan = plan_run()
    # 默认策略下 MCP 需要审批；这里放行，只验证计划模式不影响随后的普通运行
    second = loop_with_tools([SIDE_EFFECTS, text("已执行")], session=first.session, policy={"mcp:*": "allow"},
                             sandbox=first.sandbox, gateway=first.gateway)
    normal = run(run_once(second, "按计划执行"))

    assert normal.status == RunStatus.COMPLETED and normal.mode == RunMode.NORMAL
    assert ("write_file", "/src/new.py") in second.sandbox.calls
    assert ("exec_command", "rm -rf build") in second.sandbox.calls
    assert second.gateway.invoked == [(MCP_ALIAS, {"path": "/x"})]
    assert not [e for e in tool_events(second, normal.id) if e.denied_by]

    assert normal.config_snapshot["mode"] == "normal"
    assert normal.config_snapshot["system_prompt"] == SYSTEM_PROMPT
    assert memory_messages(second.session)[0]["content"] == SYSTEM_PROMPT
    main = [r for r in second.llm.requests if r.tools]
    assert all(PLAN_MODE_SUFFIX not in r.messages[0]["content"] for r in main)
    assert_rebuilds(second, normal.id, main)
    # 计划运行的请求仍按自己的快照重建（带后缀）
    assert rebuild_request(second.events, second.runs[plan.id], 1).messages[0]["content"].endswith(PLAN_MODE_SUFFIX)


# 4 计划模式只能开新运行 ----------------------------------------------------------

def service_with_fake_task(h):
    service = make_service(h)
    created = []

    async def create_task(session, rid, prior_status):
        task = input_task()
        task.invoke = AsyncMock()
        created.append((task, rid))
        return task
    service._create_task = create_task
    return service, created


def test_plan_chat_starts_a_plan_run_when_idle():
    h = make_loop([])
    service, created = service_with_fake_task(h)
    accepted = run(service.chat(h.session.id, "先出计划", mode=RunMode.PLAN))
    assert accepted.route == "started" and created[0][1] == accepted.run_id
    assert h.runs[accepted.run_id].mode == RunMode.PLAN
    started = [e for e in h.events if isinstance(e, RunEvent)]
    assert [(e.status, e.mode) for e in started] == [(RunStatus.RUNNING, "plan")]


@pytest.mark.parametrize("state", ["running", "waiting_reply", "waiting_approval"])
def test_plan_chat_conflicts_with_active_run(state):
    h = make_loop([])
    active = run(h.ledger.start(h.session.id, events_after=[MessageEvent(role="user", message="q")]))
    service, created = service_with_fake_task(h)
    if state == "running":
        # 执行协程仍在跑这个运行：普通消息会注入，计划模式冲突
        service._get_task = AsyncMock(return_value=SimpleNamespace(done=False,
                                                                   task_runner=SimpleNamespace(run_id=active.id)))
    else:
        reason = RunReason.APPROVAL if state == "waiting_approval" else None
        run(h.ledger.transition(h.session.id, active.id, RunStatus.WAITING, reason=reason))
    before = len(h.events)
    with pytest.raises(ConflictError):
        run(service.chat(h.session.id, "改成计划", mode=RunMode.PLAN))
    assert len(h.events) == before and created == []
    assert h.runs[active.id].status in (RunStatus.RUNNING, RunStatus.WAITING)


# 5–10 手动压缩 --------------------------------------------------------------------

def compact_service(session, script, max_retries=2):
    h = make_loop(script, session=session, max_retries=max_retries)
    service = make_service(h)
    service._llm, service._agent_config = h.llm, h.loop._config
    return h, service


def previous_run(h):
    """会话里已结束的一次运行，配置快照带工具 schema（手动压缩的估算用它）。"""
    snapshot = run(h.loop.config_snapshot())
    done = Run(session_id=h.session.id, status=RunStatus.COMPLETED, turns=10, config_snapshot=snapshot)
    h.runs[done.id] = done
    return done


def test_manual_compaction_writes_two_runless_events_and_keeps_session_state():
    session, original = seeded_session(10)
    h, service = compact_service(session, [text(SUMMARY, usage=usage(9000, 300))])
    done = previous_run(h)
    runs_before = {k: v.model_dump() for k, v in h.runs.items()}

    result = run(service.compact_session(session.id))

    assert result.status == "compacted"
    compact, context = h.events[-2:]
    assert isinstance(compact, CompactEvent) and isinstance(context, ContextEvent)
    assert (compact.trigger, compact.run_id, context.run_id, context.op) == ("manual", None, None, ContextOp.REPLACE)
    assert (result.compact_seq, result.context_seq) == (compact.seq, context.seq) == (2, 3)
    assert h.notifier.published == [3]
    assert result.before_total == compact.before_estimate["total"] > result.after_total == compact.after_estimate["total"]
    assert result.summarized_turns == compact.summarized_turns and result.kept_turns == compact.kept_turns
    assert compact.before_estimate["tools"] > 0 and compact.before_estimate["method"] == "chars"
    assert compact.usage.attempts == 1 and compact.usage.prompt_tokens == 9000

    # 不新建运行、不改会话状态与已有运行
    assert session.status == SessionStatus.COMPLETED
    assert {k: v.model_dump() for k, v in h.runs.items()} == runs_before and list(h.runs) == [done.id]

    messages = memory_messages(session)
    assert messages[0]["content"] == SYSTEM_PROMPT
    assert messages[1]["content"].startswith(SUMMARY_MARKER) and SUMMARY in messages[1]["content"]
    assert messages[2] == {"role": "user", "content": GOAL}
    assert messages[3:] == original[-2 * compact.kept_turns:]
    assert context.messages == messages[1:]
    summary_request = h.llm.requests[0]
    assert len(h.llm.requests) == 1 and not summary_request.tools


def test_manual_compaction_ignores_min_gain():
    """与自动压缩 min_gain 用例相同的构造：可摘要部分很小，水位触发会跳过，手动仍然压缩。"""
    session, original = seeded_session(1, payload="小", extra=echo_round(1, BIG, calls=9))
    h, service = compact_service(session, [text(SUMMARY)])
    compactor = Compactor(h.llm, h.loop._config)
    messages = memory_messages(session)
    before = compactor.fresh_budget().estimate(messages, [])
    by_watermark = run(compactor.compact(messages, [], before, "watermark", AsyncMock(return_value=[]), min_gain=True))
    assert (by_watermark.status, by_watermark.reason) == (CompactionStatus.SKIPPED, SkipReason.MIN_GAIN)
    assert h.llm.requests == []

    result = run(service.compact_session(session.id))
    assert result.status == "compacted" and result.summarized_turns == 1 and result.kept_turns == 1
    assert len(h.llm.requests) == 1
    assert memory_messages(session)[1]["content"].startswith(SUMMARY_MARKER)


def test_manual_compaction_skips_without_two_rounds():
    session, original = seeded_session(1)
    h, service = compact_service(session, [])
    events_before = len(h.events)
    result = run(service.compact_session(session.id))
    assert (result.status, result.reason) == ("skipped", "no_rounds")
    assert len(h.events) == events_before and h.llm.requests == [] and h.notifier.published == []
    assert memory_messages(session) == original


def test_manual_compaction_summary_failure_is_502_and_changes_nothing():
    session, original = seeded_session(10)
    h, service = compact_service(session, [ConnectionError("受控断连"), text("")], max_retries=2)
    events_before = len(h.events)
    with pytest.raises(AppException) as raised:
        run(service.compact_session(session.id))
    assert raised.value.status_code == 502 and "2 次" in raised.value.msg
    assert len(h.llm.requests) == 2 and len(h.events) == events_before and h.notifier.published == []
    assert memory_messages(session) == original and session.status == SessionStatus.COMPLETED


@pytest.mark.parametrize("state", ["running", "waiting_reply", "waiting_approval"])
def test_manual_compaction_conflicts_with_active_run(state):
    session, original = seeded_session(10, status=SessionStatus.RUNNING)
    h, service = compact_service(session, [text(SUMMARY)])
    active = run(h.ledger.start(session.id))
    if state != "running":
        reason = RunReason.APPROVAL if state == "waiting_approval" else None
        run(h.ledger.transition(session.id, active.id, RunStatus.WAITING, reason=reason))
    events_before = len(h.events)
    with pytest.raises(ConflictError):
        run(service.compact_session(session.id))
    assert h.llm.requests == [] and len(h.events) == events_before
    assert memory_messages(session) == original


def test_manual_compaction_unknown_session_is_404():
    h, service = compact_service(Session(id="w9-missing"), [])
    service._uow.session.get_by_id = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        run(service.compact_session("w9-missing"))


def test_next_run_after_manual_compaction_rebuilds_with_summary_and_user_text():
    session, original = seeded_session(10)
    h, service = compact_service(session, [text(SUMMARY)])
    previous_run(h)
    run(service.compact_session(session.id))

    nxt = make_loop([text("继续完成")], session=session)
    task = input_task()
    started = run(start_run(nxt, task, "接着汇总"))
    run(make_runner(nxt, run=started, prior_status=SessionStatus.COMPLETED).invoke(task))

    assert nxt.runs[started.id].status == RunStatus.COMPLETED
    assert not [e for e in nxt.events if isinstance(e, CompactEvent) and e.run_id == started.id]
    request = nxt.llm.requests[0]
    assert request.messages[1]["content"].startswith(SUMMARY_MARKER)
    assert request.messages[2] == {"role": "user", "content": GOAL}
    assert request.messages[-1] == {"role": "user", "content": "接着汇总"}
    rebuilt = rebuild_request(nxt.events, nxt.runs[started.id], 1)
    assert rebuilt.messages == request.messages and rebuilt.tools == request.tools


# 前端契约：接口响应与 compact 事件的序列化形状 --------------------------------------

def http_client(service):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.interfaces.endpoints import session_routes
    from app.interfaces.errors.exception_handlers import register_exception_handlers
    from app.interfaces.service_dependencies import get_agent_service

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(session_routes.router, prefix="/api")
    app.dependency_overrides[get_agent_service] = lambda: service
    return TestClient(app)


def test_compact_route_response_shapes():
    session, _ = seeded_session(10)
    h, service = compact_service(session, [text(SUMMARY), ConnectionError("断"), text("")], max_retries=2)
    client = http_client(service)

    ok = client.post(f"/api/sessions/{session.id}/compact")
    assert ok.status_code == 200
    body = ok.json()
    assert body["code"] == 200 and body["msg"] == body["data"]["message"]
    assert body["data"]["status"] == "compacted" and body["data"]["reason"] is None
    assert set(body["data"]) == {"status", "reason", "message", "compact_seq", "context_seq", "before_total",
                                 "after_total", "summarized_turns", "kept_turns"}
    assert (body["data"]["compact_seq"], body["data"]["context_seq"]) == (2, 3)

    failed = client.post(f"/api/sessions/{session.id}/compact")
    assert failed.status_code == 502 and failed.json()["code"] == 502 and failed.json()["data"] == {}

    small, _ = seeded_session(1)
    skipped = http_client(compact_service(small, [])[1]).post(f"/api/sessions/{small.id}/compact").json()
    assert skipped["code"] == 200 and skipped["data"]["status"] == "skipped"
    assert skipped["data"]["reason"] == "no_rounds" and skipped["data"]["compact_seq"] is None

    run(h.ledger.start(session.id))
    conflict = client.post(f"/api/sessions/{session.id}/compact")
    assert conflict.status_code == 409 and conflict.json()["code"] == 409


def test_chat_route_accepts_mode_and_rejects_unknown_values():
    h = make_loop([])
    service, created = service_with_fake_task(h)
    client = http_client(service)
    accepted = client.post(f"/api/sessions/{h.session.id}/chat", json={"message": "出计划", "mode": "plan"})
    assert accepted.status_code == 200
    assert set(accepted.json()["data"]) == {"run_id", "seq", "route"}
    assert h.runs[accepted.json()["data"]["run_id"]].mode == RunMode.PLAN
    invalid = client.post(f"/api/sessions/{h.session.id}/chat", json={"message": "x", "mode": "readonly"})
    assert invalid.status_code == 422

def test_compact_sse_payload_uses_estimate_objects():
    session, _ = seeded_session(10)
    h, service = compact_service(session, [text(SUMMARY, usage=usage(9000, 300))])
    run(service.compact_session(session.id))
    compact = h.events[-2]
    payload = json.loads(json.dumps(EventMapper.event_to_sse_event(compact).model_dump(mode="json")))
    assert payload["event"] == "compact"
    data = payload["data"]
    assert data["trigger"] == "manual" and data["run_id"] is None
    assert "before_tokens" not in data and "after_tokens" not in data
    assert set(data["before_estimate"]) == set(data["after_estimate"]) == {
        "system_prompt", "tools", "history", "tool_results", "total", "limit", "watermark",
        "context_window", "max_tokens", "method"}
    assert set(data) >= {"summarized_turns", "kept_turns", "summary", "reinjected_event_seqs",
                         "omitted_user_messages", "usage"}
