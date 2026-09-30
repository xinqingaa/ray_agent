"""W7.2 工具级审批：策略解析、ask 进入等待、批准执行一次、拒绝与 deny 不执行、批次后续补为未执行、
重复回复冲突、等待审批时停止与启动扫描。模型用 ScriptedLLM，存储、传输与沙箱用替身。"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.agent_service import AgentService, pending_starts
from app.application.services.app_config_service import AppConfigService
from app.domain.models.app_config import ToolPolicy, ToolPolicyConfig
from app.domain.models.event import ApprovalEvent, ApprovalStatus, ContextEvent, RunEvent, ToolEvent, WaitEvent
from app.domain.models.run import RunStatus
from app.domain.models.session import Session, SessionStatus
from app.domain.services.approvals import interrupt_waiting_approvals
from app.domain.services.flows.agent_loop import NOT_EXECUTED_APPROVAL, NOT_EXECUTED_STOPPED, NOT_EXECUTED_WAITING
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.request_rebuild import rebuild_request
from app.domain.services.tool_policy import USER_REJECTED, ToolPolicyGuard, resolve_policy
from app.domain.services.tools.mcp import MCPTool
from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository
from app.interfaces.endpoints.app_config_routes import update_tool_policy
from app.interfaces.schemas.app_config import ToolPolicyUpdate
from app.interfaces.schemas.event import EventMapper
from tests.support.loop_harness import (
    assert_no_dangling,
    event_at,
    inject,
    input_task,
    make_loop,
    make_runner,
    memory_messages,
    start_run,
    tool_results,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call

ASK_ECHO = {"echo": "ask"}


def batch(*calls):
    return ScriptedResponse(tool_calls=[ScriptedToolCall(name, args, id=call_id) for name, args, call_id in calls])


ECHO_THEN_READ = batch(("echo", {"text": "a"}, "c-a"), ("read_file", {"filepath": "/b.txt"}, "c-b"))


def make_service(h) -> AgentService:
    service = AgentService.__new__(AgentService)
    service._uow_factory = h.loop._uow_factory
    service._uow = service._uow_factory()
    service._ledger = h.ledger
    service._notifier = h.notifier
    service._task_cls = None
    service._get_task = AsyncMock(return_value=None)
    return service


def approvals_of(h, call_id):
    return [e.status.value for e in h.events if isinstance(e, ApprovalEvent) and e.tool_call_id == call_id]


def tools_of(h, call_id):
    return [e for e in h.events if isinstance(e, ToolEvent) and e.tool_call_id == call_id]


def run_events(h, run_id):
    return [(e.status, e.reason) for e in h.events if isinstance(e, RunEvent) and e.run_id == run_id]


def assert_rebuilds(first, second, run_id):
    """审批续接不破坏按事件重建请求：每一轮重建结果与模型实际收到的一致。"""
    actual = [*first.llm.requests, *second.llm.requests]
    for index, request in enumerate(actual, start=1):
        rebuilt = rebuild_request(second.events, second.runs[run_id], index)
        assert rebuilt.messages == request.messages and rebuilt.tools == request.tools


async def wait_for_approval(script=None, policy=None, session=None):
    """运行到第一个需要批准的调用处停下，返回夹具与运行。"""
    h = make_loop(script or [ECHO_THEN_READ], tool_policy=policy or ASK_ECHO, session=session)
    task = input_task()
    run = await start_run(h, task, "回显 a 并读取 /b.txt")
    await make_runner(h, run=run).invoke(task)
    return h, run


async def reply(first, run_id, call_id, approve, script, policy=None):
    """与审批接口一致：服务受理回复后由新任务续接；返回续接用的夹具与受理结果。"""
    second = make_loop(script, session=first.session, tool_policy=policy or ASK_ECHO)
    service = make_service(second)
    created = []

    async def create_task(session, rid, prior_status):
        task = input_task()
        task.invoke = AsyncMock()
        created.append((task, rid, prior_status))
        return task
    service._create_task = create_task
    accepted = await service.reply_approval(first.session.id, call_id, approve=approve)
    await pending_starts()[accepted.run_id].worker
    task, rid, prior_status = created[0]
    assert rid == run_id and prior_status == SessionStatus.WAITING
    await make_runner(second, run=second.runs[rid], prior_status=prior_status).invoke(task)
    return second, service, accepted


# ---------------- 策略解析 ----------------

def test_policy_resolution_prefers_specific_keys_and_defaults_to_allow():
    config = ToolPolicyConfig()
    assert config.rules == {"mcp:*": ToolPolicy.ASK, "a2a:*": ToolPolicy.ASK}
    # 沙箱内工具未列出，即 allow；计划与提问豁免
    for toolset, function in [("file", "write_file"), ("shell", "shell_execute"), ("browser", "browser_click"),
                              ("search", "search_web"), ("message", "message_ask_user"), ("plan", "update_plan")]:
        assert resolve_policy(config, toolset, function).policy == ToolPolicy.ALLOW
    assert resolve_policy(config, "mcp", "mcp_x_hash", mcp_route=("fs", "read")).rule == "mcp:*"
    assert resolve_policy(config, "mcp", "mcp_unknown").policy == ToolPolicy.ASK
    call = resolve_policy(config, "a2a", "call_remote_agent", {"id": "agent-1", "query": "q"})
    assert (call.policy, call.rule, call.service, call.service_tool) == (
        ToolPolicy.ASK, "a2a:*", "agent-1", "call_remote_agent")
    # 列出卡片只读本地缓存，不受 a2a:* 约束
    assert resolve_policy(config, "a2a", "get_remote_agent_cards").policy == ToolPolicy.ALLOW

    config = ToolPolicyConfig(rules={
        "mcp:*": "ask", "mcp:fs:*": "allow", "mcp:fs:delete": "deny",
        "shell:*": "ask", "shell_read_output": "allow", "a2a:agent-1:*": "allow",
    })
    assert resolve_policy(config, "mcp", "x", mcp_route=("fs", "read")).policy == ToolPolicy.ALLOW
    deny = resolve_policy(config, "mcp", "x", mcp_route=("fs", "delete"))
    assert (deny.policy, deny.rule, deny.service, deny.service_tool) == (ToolPolicy.DENY, "mcp:fs:delete", "fs", "delete")
    assert resolve_policy(config, "mcp", "x", mcp_route=("web", "get")).policy == ToolPolicy.ASK
    assert resolve_policy(config, "shell", "shell_execute").rule == "shell:*"
    assert resolve_policy(config, "shell", "shell_read_output").policy == ToolPolicy.ALLOW
    assert resolve_policy(config, "a2a", "call_remote_agent", {"id": "agent-1"}).policy == ToolPolicy.ALLOW
    assert resolve_policy(config, "a2a", "call_remote_agent", {"id": "agent-2"}).policy == ToolPolicy.ALLOW


@pytest.mark.parametrize("key", ["", " shell:*", "shell:foo", "mcp:fs", "a2a:x:", "message:*", "update_plan",
                                 "message_ask_user", "plan:*"])
def test_policy_config_rejects_malformed_or_exempt_keys(key):
    with pytest.raises(ValueError):
        ToolPolicyConfig(rules={key: "ask"})


def test_guard_resolves_mcp_alias_to_service_and_builds_approval_request():
    gateway = SimpleNamespace(route=lambda name: ("w0eval", "add") if name == "mcp_w0eval_add_abc" else None)
    guard = ToolPolicyGuard(ToolPolicyConfig(rules={"mcp:w0eval:*": "ask"}))
    invocation = ToolInvocation(call_id="c1", function_name="mcp_w0eval_add_abc", raw_arguments="{}",
                                arguments={"a": 1, "b": 2}, tool=MCPTool(gateway))
    assert asyncio.run(guard(invocation)) is None
    request = invocation.suspend_event
    assert isinstance(request, ApprovalEvent) and request.status == ApprovalStatus.PENDING
    assert (request.tool_name, request.rule, request.service, request.service_tool) == (
        "mcp", "mcp:w0eval:*", "w0eval", "add")
    assert request.function_args == {"a": 1, "b": 2}
    # 批准只对这一次调用有效：带批准标记时放行
    approved = ToolInvocation(call_id="c1", function_name="mcp_w0eval_add_abc", raw_arguments="{}",
                              tool=MCPTool(gateway), approval="approved")
    assert asyncio.run(guard(approved)) is None and not approved.suspended


# ---------------- 验收 3：审批（ScriptedLLM） ----------------

def test_ask_suspends_batch_and_enters_waiting_approval():
    async def run():
        h, active = await wait_for_approval()
        assert h.runs[active.id].status == RunStatus.WAITING and h.runs[active.id].reason == "approval"
        assert h.session.status == SessionStatus.WAITING
        assert h.recording.calls == [] and not tools_of(h, "c-a") and not tools_of(h, "c-b")
        h.sandbox.read_file.assert_not_awaited()
        request = next(e for e in h.events if isinstance(e, ApprovalEvent))
        assert (request.tool_call_id, request.function_name, request.function_args, request.rule) == (
            "c-a", "echo", {"text": "a"}, "echo")
        tail = h.events[request.seq - 1:]
        assert [e.type for e in tail] == ["approval", "turn", "wait", "run"]
        assert tail[1].phase == "completed" and tail[1].tool_call_ids == []
        assert run_events(h, active.id) == [("running", None), ("waiting", "approval")]
        dangling = memory_messages(h.session)[-1]
        assert [c["id"] for c in dangling["tool_calls"]] == ["c-a", "c-b"]

        # 等待审批时不受理聊天消息
        with pytest.raises(ConflictError):
            await make_service(h).chat(h.session.id, "先做别的", attachments=[])
        with pytest.raises(NotFoundError):
            await make_service(h).reply_approval(h.session.id, "no-such-call", approve=True)
    asyncio.run(asyncio.wait_for(run(), 5))


def test_approve_executes_once_then_repairs_rest_of_batch_and_rejects_duplicate_reply():
    async def run():
        first, active = await wait_for_approval()
        second, service, accepted = await reply(first, active.id, "c-a", True, [text("已回显 a")])
        assert (accepted.run_id, accepted.status) == (active.id, "approved")
        assert event_at(second, accepted.seq).status == ApprovalStatus.APPROVED
        assert second.recording.calls == ["echo:a"] and first.recording.calls == []
        second.sandbox.read_file.assert_not_awaited()
        assert [e.status.value for e in tools_of(second, "c-a")] == ["calling", "called"]
        assert not tools_of(second, "c-b")
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        results = tool_results(request)
        assert results["c-a"]["success"] and results["c-a"]["data"] == {"echo": "a"}
        assert results["c-b"] == {"success": False, "message": NOT_EXECUTED_APPROVAL, "data": None}
        assert approvals_of(second, "c-a") == ["pending", "approved"]
        assert run_events(second, active.id) == [
            ("running", None), ("waiting", "approval"), ("running", None), ("completed", None)]
        assert second.session.status == SessionStatus.COMPLETED
        # 轮次序号在同一运行内连续；批准执行的调用计入运行的工具调用数
        assert [e.index for e in second.events if e.type == "turn" and e.phase == "started"] == [1, 2]
        assert second.runs[active.id].tool_calls == 1
        assert_rebuilds(first, second, active.id)

        # 重复回复：冲突，不重复执行
        with pytest.raises(ConflictError):
            await service.reply_approval(first.session.id, "c-a", approve=True)
        with pytest.raises(ConflictError):
            await service.reply_approval(first.session.id, "c-a", approve=False)
        assert second.recording.calls == ["echo:a"]
        assert approvals_of(second, "c-a") == ["pending", "approved"]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_reject_does_not_execute_and_backfills_user_rejection():
    async def run():
        first, active = await wait_for_approval()
        second, service, accepted = await reply(first, active.id, "c-a", False, [text("好的，不回显，改为说明")])
        assert accepted.status == "rejected"
        assert second.recording.calls == [] and first.recording.calls == []
        second.sandbox.read_file.assert_not_awaited()
        called = tools_of(second, "c-a")
        assert [(e.status.value, e.denied_by) for e in called] == [("called", "user")]
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        results = tool_results(request)
        assert results["c-a"] == {"success": False, "message": USER_REJECTED, "data": None}
        assert results["c-b"]["message"] == NOT_EXECUTED_APPROVAL
        assert approvals_of(second, "c-a") == ["pending", "rejected"]
        assert second.session.status == SessionStatus.COMPLETED
        assert_rebuilds(first, second, active.id)
        with pytest.raises(ConflictError):
            await service.reply_approval(first.session.id, "c-a", approve=True)
        assert second.recording.calls == []
    asyncio.run(asyncio.wait_for(run(), 5))


def test_deny_policy_short_circuits_without_executing_or_waiting():
    async def run():
        h = make_loop([tool_call("echo", {"text": "x"}, id="c-x"), text("换了做法")], tool_policy={"echo": "deny"})
        task = input_task()
        active = await start_run(h, task, "回显 x")
        await make_runner(h, run=active).invoke(task)
        assert h.recording.calls == []
        assert [(e.status.value, e.denied_by) for e in tools_of(h, "c-x")] == [("called", "policy")]
        result = tool_results(h.llm.requests[1].messages)["c-x"]
        assert not result["success"] and result["message"].startswith("策略禁止") and "echo" in result["message"]
        assert not any(isinstance(e, ApprovalEvent) for e in h.events)
        assert run_events(h, active.id) == [("running", None), ("completed", None)]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_message_arriving_while_loop_suspends_expires_approval_and_continues():
    """循环停下前注入的消息：审批失效，待审批调用按等待规则补为未执行，同一运行处理这条消息。"""
    async def run():
        h = make_loop([ECHO_THEN_READ, text("按新要求处理")], tool_policy=ASK_ECHO)
        task = input_task()
        active = await start_run(h, task, "回显 a")

        async def on_publish(seq):
            e = event_at(h, seq)
            if isinstance(e, ApprovalEvent) and e.status == ApprovalStatus.PENDING:
                await inject(h, task, active.id, "不用回显了，直接结束")
        h.notifier.on_publish = on_publish
        await make_runner(h, run=active).invoke(task)
        assert h.recording.calls == []
        assert approvals_of(h, "c-a") == ["pending", "expired"]
        request = h.llm.requests[1].messages
        assert_no_dangling(request)
        results = tool_results(request)
        assert results["c-a"]["message"] == NOT_EXECUTED_WAITING and results["c-b"]["message"] == NOT_EXECUTED_WAITING
        assert request[-1] == {"role": "user", "content": "不用回显了，直接结束"}
        assert run_events(h, active.id) == [
            ("running", None), ("waiting", "approval"), ("running", None), ("completed", None)]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_stop_while_waiting_approval_expires_it_and_repairs_calls():
    async def run():
        h, active = await wait_for_approval()
        service = make_service(h)
        stopped = await service.stop_session(h.session.id)
        assert stopped.status == RunStatus.CANCELLED and stopped.reason == "user_stop"
        assert approvals_of(h, "c-a") == ["pending", "expired"]
        messages = memory_messages(h.session)
        assert_no_dangling(messages)
        assert {k: v["message"] for k, v in tool_results(messages).items()} == {
            "c-a": NOT_EXECUTED_STOPPED, "c-b": NOT_EXECUTED_STOPPED}
        with pytest.raises(ConflictError):
            await service.reply_approval(h.session.id, "c-a", approve=True)
    asyncio.run(asyncio.wait_for(run(), 5))


# ---------------- 验收 4：等待审批时启动扫描 ----------------

def test_startup_scan_interrupts_waiting_approval_and_marks_calls_not_executed():
    async def run():
        h, active = await wait_for_approval()
        # 通用扫描只处理 running；等待审批由审批扫描处理
        assert await h.ledger.interrupt_running() == []
        interrupted = await interrupt_waiting_approvals(h.loop._uow_factory, h.ledger)
        assert [r.id for r in interrupted] == [active.id]
        assert h.runs[active.id].status == RunStatus.INTERRUPTED and h.runs[active.id].reason == "api_restart"
        assert h.session.status == SessionStatus.INTERRUPTED
        assert approvals_of(h, "c-a") == ["pending", "expired"]
        expired = [e for e in h.events if isinstance(e, ApprovalEvent)][-1]
        assert expired.decided_at is not None and expired.run_id == active.id
        repaired = [e for e in h.events if isinstance(e, ContextEvent)][-1]
        terminal = [e for e in h.events if isinstance(e, RunEvent)][-1]
        assert repaired.seq < terminal.seq and [m["tool_call_id"] for m in repaired.messages] == ["c-a", "c-b"]
        messages = memory_messages(h.session)
        assert_no_dangling(messages)
        assert {k: v["message"] for k, v in tool_results(messages).items()} == {
            "c-a": NOT_EXECUTED_STOPPED, "c-b": NOT_EXECUTED_STOPPED}
        assert h.recording.calls == []
        with pytest.raises(ConflictError):
            await make_service(h).reply_approval(h.session.id, "c-a", approve=True)
        assert await interrupt_waiting_approvals(h.loop._uow_factory, h.ledger) == []

        # 用户重新发起任务：新运行的第一次请求不再补结果
        again = make_loop([text("重新开始")], session=h.session)
        task = input_task()
        next_run = await start_run(again, task, "重新来")
        await make_runner(again, run=next_run, prior_status=SessionStatus.INTERRUPTED).invoke(task)
        request = again.llm.requests[0].messages
        assert_no_dangling(request)
        assert sum(1 for m in request if m.get("role") == "tool") == 2
    asyncio.run(asyncio.wait_for(run(), 5))


def test_startup_scan_keeps_runs_waiting_for_a_reply():
    async def run():
        h = make_loop([tool_call("message_ask_user", {"text": "文件名？"}, id="ask-1")],
                      session=Session(id="w72-ask"))
        task = input_task()
        active = await start_run(h, task, "写个文件")
        await make_runner(h, run=active).invoke(task)
        assert h.runs[active.id].status == RunStatus.WAITING and h.runs[active.id].reason is None
        assert await interrupt_waiting_approvals(h.loop._uow_factory, h.ledger) == []
        assert h.runs[active.id].status == RunStatus.WAITING
        assert isinstance(h.events[-2], WaitEvent)
    asyncio.run(asyncio.wait_for(run(), 5))


# ---------------- 事件与设置接口 ----------------

def test_approval_sse_event_carries_call_fields_and_epoch_decided_at():
    request = ApprovalEvent(tool_call_id="c1", tool_name="mcp", function_name="mcp_w0eval_add_abc",
                            function_args={"a": 1}, rule="mcp:*", service="w0eval", service_tool="add")
    request.seq, request.run_id = 7, "r1"
    pending = EventMapper.event_to_sse_event(request)
    assert pending.event == "approval"
    data = pending.data.model_dump()
    assert {k: data[k] for k in ("seq", "run_id", "tool_call_id", "name", "function", "args", "status", "rule",
                                 "service", "service_tool", "decided_at")} == {
        "seq": 7, "run_id": "r1", "tool_call_id": "c1", "name": "mcp", "function": "mcp_w0eval_add_abc",
        "args": {"a": 1}, "status": "pending", "rule": "mcp:*", "service": "w0eval", "service_tool": "add",
        "decided_at": None}
    decided = request.decided(ApprovalStatus.APPROVED)
    assert decided.id != request.id and decided.seq is None and decided.run_id == "r1"
    assert EventMapper.event_to_sse_event(decided).data.decided_at == int(decided.decided_at.timestamp() * 1000)
    denied = ToolEvent(tool_call_id="c2", tool_name="shell", function_name="shell_execute", function_args={},
                       status="called", denied_by="policy")
    assert EventMapper.event_to_sse_event(denied).data.denied_by == "policy"


def test_tool_policy_settings_round_trip_and_validation(tmp_path):
    async def run():
        service = AppConfigService(FileAppConfigRepository(str(tmp_path / "config.yaml")))
        assert (await service.get_tool_policy()).rules == {"mcp:*": ToolPolicy.ASK, "a2a:*": ToolPolicy.ASK}
        response = await update_tool_policy(
            ToolPolicyUpdate(rules={"mcp:*": "allow", "mcp:fs:delete": "deny", "shell_execute": "ask"}), service)
        assert response.data.rules == {"mcp:*": "allow", "mcp:fs:delete": "deny", "shell_execute": "ask"}
        assert response.data.default_rules == {"mcp:*": "ask", "a2a:*": "ask"}
        assert response.data.fallback == "allow"
        toolsets = {t.toolset: t.functions for t in response.data.builtin_toolsets}
        assert "shell_execute" in toolsets["shell"] and toolsets["a2a"] == ["get_remote_agent_cards"]
        reloaded = AppConfigService(FileAppConfigRepository(str(tmp_path / "config.yaml")))
        assert (await reloaded.get_tool_policy()).rules["mcp:fs:delete"] == ToolPolicy.DENY
        with pytest.raises(BadRequestError):
            await update_tool_policy(ToolPolicyUpdate(rules={"shell:foo": "ask"}), service)
        assert (await reloaded.get_tool_policy()).rules["shell_execute"] == ToolPolicy.ASK
    asyncio.run(run())
