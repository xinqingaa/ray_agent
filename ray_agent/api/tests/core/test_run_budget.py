"""模型请求预算：阶段划分、提醒与收尾提示、收尾阶段的工具限制、用户消息重置与审批续接沿用计数，
以及 shell_wait_process 合并输出。模型用 ScriptedLLM，存储、传输与沙箱用替身。"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.domain.models.event import ToolEvent, ToolEventStatus
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.agent_loop import RunEndReason
from app.domain.services.run_budget import (
    BUDGET_DENIED_PREFIX,
    BUDGET_NOTICE_PREFIX,
    BudgetPhase,
    budget_notice,
    budget_phase,
)
from app.domain.services.tools.shell import ShellTool
from tests.support.loop_harness import (
    assert_no_dangling,
    input_task,
    make_loop,
    make_runner,
    memory_messages,
    start_run,
    tool_results,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call
from tests.core.test_tool_approval import assert_rebuilds, reply


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


async def collect(loop, message="任务", **kwargs):
    return [event.model_copy(deep=True) async for event in loop.invoke(Message(message=message), **kwargs)]


def notices(messages):
    return [m["content"] for m in messages if m.get("role") == "user"
            and str(m.get("content") or "").startswith(BUDGET_NOTICE_PREFIX)]


def echoes(count, start=1):
    return [tool_call("echo", {"text": str(i)}) for i in range(start, start + count)]


def test_phase_boundaries_scale_with_limit_and_small_limits_have_no_phases():
    assert [budget_phase(used, 100) for used in (69, 70, 89, 90, 100)] == [
        BudgetPhase.NORMAL, BudgetPhase.REMIND, BudgetPhase.REMIND, BudgetPhase.FINALIZE, BudgetPhase.FINALIZE]
    assert [budget_phase(used, 10) for used in (6, 7, 8)] == [
        BudgetPhase.NORMAL, BudgetPhase.REMIND, BudgetPhase.FINALIZE]
    assert {budget_phase(used, 9) for used in range(10)} == {BudgetPhase.NORMAL}
    assert "交付文件" not in budget_notice(BudgetPhase.FINALIZE, 8, 10, plan_mode=True)
    assert "交付文件" in budget_notice(BudgetPhase.FINALIZE, 8, 10)


def test_reminder_then_finalize_restricts_tools_and_still_delivers_and_completes():
    async def deliver_file(path):
        return File(id="file-1", filename="out.html", filepath=path, size=12)

    h = make_loop([
        *echoes(8),
        ScriptedResponse(tool_calls=[
            ScriptedToolCall("echo", {"text": "extra"}, id="c-extra"),
            ScriptedToolCall("deliver_files", {"paths": ["/home/ubuntu/out.html"]}, id="c-deliver"),
        ]),
        text("已交付样例，未完成：细节精修"),
    ], max_iterations=10, deliver_file=deliver_file)
    events = run(collect(h.loop))

    assert h.loop.end_reason == RunEndReason.COMPLETED
    assert h.recording.calls == [f"echo:{i}" for i in range(1, 9)]
    requests = h.llm.requests
    assert len(requests) == 10
    # 提示追加在记忆里，系统消息逐次相同，缓存前缀不变
    assert len({r.messages[0]["content"] for r in requests}) == 1
    assert notices(requests[6].messages) == []
    assert notices(requests[7].messages) == [requests[7].messages[-1]["content"]]
    assert "7/10" in requests[7].messages[-1]["content"]
    assert "剩余 2 次" in requests[8].messages[-1]["content"] and len(notices(requests[8].messages)) == 2
    denied = [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED
              and e.tool_call_id == "c-extra"]
    assert denied[0].denied_by == "budget"
    results = tool_results(memory_messages(h.session))
    assert results["c-extra"]["message"].startswith(BUDGET_DENIED_PREFIX)
    assert results["c-deliver"]["success"] is True
    assert_no_dangling(memory_messages(h.session))


def test_reaching_limit_keeps_max_iterations_and_offers_continue():
    h = make_loop(echoes(11), max_iterations=10)
    events = run(collect(h.loop))

    assert h.loop.end_reason == RunEndReason.MAX_ITERATIONS
    assert h.llm.call_count == 10
    assert "max_iterations" in events[-1].error and "继续" in events[-1].error
    # 收尾阶段的 echo 被拒绝，不执行
    assert h.recording.calls == [f"echo:{i}" for i in range(1, 9)]


def test_injected_user_message_resets_budget():
    pending = [Message(message="图片先占位")]
    drains = 0

    async def drain():
        nonlocal drains
        drains += 1
        return [pending.pop()] if drains == 6 and pending else []

    h = make_loop([*echoes(12), text("完成")], max_iterations=10)
    run(collect(h.loop, drain_injected_messages=drain))

    assert h.loop.end_reason == RunEndReason.COMPLETED
    assert h.recording.calls == [f"echo:{i}" for i in range(1, 13)]
    found = notices(memory_messages(h.session))
    assert len(found) == 1 and "7/10" in found[0]
    assert h.llm.requests[12].messages[-1]["content"] == found[0]


def test_approval_resume_continues_budget_and_injects_missing_finalize_notice():
    async def scenario():
        first = make_loop([
            *[tool_call("read_file", {"filepath": f"/r{i}.txt"}) for i in range(7)],
            ScriptedResponse(tool_calls=[ScriptedToolCall("echo", {"text": "a"}, id="c-a")]),
        ], tool_policy={"echo": "ask"}, max_iterations=10)
        task = input_task()
        active = await start_run(first, task, "读文件后回显")
        await make_runner(first, run=active).invoke(task)
        assert len(notices(memory_messages(first.session))) == 1

        second, _, _ = await reply(first, active.id, "c-a", True, [text("收尾答复")], policy={"echo": "ask"})
        return first, second, active

    first, second, active = run(scenario())
    assert_rebuilds(first, second, active.id)
    assert second.recording.calls == ["echo:a"]
    request = second.llm.requests[0].messages
    assert "剩余 2 次" in request[-1]["content"]
    assert len(notices(request)) == 2
    assert second.loop.budget_used == 9


def test_shell_wait_merges_output_on_finish_and_timeout_and_passes_other_failures_through():
    sandbox = SimpleNamespace(wait_process=AsyncMock(), read_shell_output=AsyncMock())
    shell = ShellTool(sandbox=sandbox)

    sandbox.wait_process.return_value = ToolResult(success=True, message="进程结束", data={"returncode": 0})
    sandbox.read_shell_output.return_value = ToolResult(success=True, data={"output": "done\n", "session_id": "s"})
    finished = run(shell.shell_wait_process("s", 5))
    assert finished.success and finished.data == {"returncode": 0, "output": "done\n"}

    sandbox.wait_process.return_value = ToolResult(success=False, message="Shell会话进程等待超时: 5s")
    sandbox.read_shell_output.return_value = ToolResult(success=True, data={"output": "50%"})
    waiting = run(shell.shell_wait_process("s", 5))
    assert not waiting.success and "进程仍在运行" in waiting.message
    assert waiting.data == {"output": "50%", "status": "running"}

    sandbox.read_shell_output.reset_mock()
    missing = ToolResult(success=False, message="Shell会话不存在: s")
    sandbox.wait_process.return_value = missing
    assert run(shell.shell_wait_process("s", 5)) is missing
    sandbox.read_shell_output.assert_not_awaited()
