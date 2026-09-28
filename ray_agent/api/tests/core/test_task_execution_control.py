"""执行控制：实际协调、运行器和 Agent 循环；模型、存储、传输与沙箱用替身。"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.application.services.agent_service import AgentService
from app.domain.models.event import DoneEvent, MessageEvent, RunEvent, ToolEvent, WaitEvent
from app.domain.models.run import Run, RunStatus
from app.domain.models.session import SessionStatus
from app.domain.services.flows.agent_loop import INTERRUPTED_STOPPED, NOT_EXECUTED_STOPPED
from app.infrastructure.external.task import redis_stream_task as task_module
from tests.support.loop_harness import (
    MemoryQueue,
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


def ask(call_id="ask-1", question="请提供文件路径"):
    return tool_call("message_ask_user", {"text": question}, id=call_id)


def run_statuses(h, run_id):
    return [e.status for e in h.events if isinstance(e, RunEvent) and e.run_id == run_id]


def make_service(h, task_cls=None) -> AgentService:
    service = AgentService.__new__(AgentService)
    service._uow_factory = h.loop._uow_factory
    service._uow = service._uow_factory()
    service._ledger = h.ledger
    service._notifier = h.notifier
    service._task_cls = task_cls
    return service


def test_wait_then_reply_resumes_same_run_with_reply_as_ask_result():
    async def run():
        first = make_loop([ask()])
        task = input_task()
        waiting_run = await start_run(first, task, "核对文件，路径待补充")
        r = make_runner(first, run=waiting_run)
        await r.invoke(task)
        assert first.session.status == SessionStatus.WAITING
        assert first.runs[waiting_run.id].status == RunStatus.WAITING
        assert isinstance(first.events[-2], WaitEvent) and first.events[-1].status == "waiting"
        assert first.llm.remaining == 0
        assert not any(isinstance(e, DoneEvent) for e in first.events)
        first.sandbox.read_file.assert_not_awaited()
        r._mcp_tool.cleanup.assert_awaited_once()
        assert memory_messages(first.session)[-1]["tool_calls"][0]["id"] == "ask-1"

        # chat 对 waiting 运行的处理：同一运行 waiting → running，回复写入该运行，由新任务续接
        second = make_loop([tool_call("read_file", {"filepath": "/hello.txt"}, id="read-1"), text("核对完成")],
                           session=first.session)
        service = make_service(second)
        created = []

        async def create_task(session, run_id, prior_status):
            task2 = input_task()
            task2.invoke = AsyncMock()
            created.append((task2, run_id, prior_status))
            return task2
        service._create_task = create_task
        service._get_task = AsyncMock(return_value=None)
        accepted = await service.chat(first.session.id, "/hello.txt", attachments=[])
        assert accepted.route == "resumed" and accepted.run_id == waiting_run.id
        task2, run_id, prior_status = created[0]
        assert (run_id, prior_status) == (waiting_run.id, SessionStatus.WAITING)
        r2 = make_runner(second, run=second.runs[run_id], prior_status=prior_status)
        await r2.invoke(task2)

        assert second.loop is not first.loop
        assert second.session.status == SessionStatus.COMPLETED
        assert second.llm.remaining == 0
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        assert tool_results(request)["ask-1"]["data"]["reply"] == "/hello.txt"
        second.sandbox.read_file.assert_awaited_once()
        assert second.sandbox.read_file.await_args.kwargs["filepath"] == "/hello.txt"
        assert isinstance(second.events[-2], DoneEvent)
        assert run_statuses(second, waiting_run.id) == ["running", "waiting", "running", "completed"]
        # 轮次序号在同一运行内连续
        assert [e.index for e in second.events if e.type == "turn" and e.phase == "started"] == [1, 2, 3]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_new_input_during_tool_is_injected_without_interrupting_or_replanning():
    async def run():
        h = make_loop([
            tool_call("read_file", {"filepath": "/old.txt"}, id="old"),
            tool_call("read_file", {"filepath": "/new.txt"}, id="new"),
            text("两个文件都核对完成"),
        ])
        task = input_task()
        active = await start_run(h, task, "核对 /old.txt")
        r = make_runner(h, run=active)

        async def on_publish(seq):
            e = event_at(h, seq)
            if isinstance(e, ToolEvent) and e.tool_call_id == "old" and e.status == "calling":
                await inject(h, task, active.id, "再核对 /new.txt")
        h.notifier.on_publish = on_publish
        await r.invoke(task)

        assert h.llm.remaining == 0
        assert [c.kwargs["filepath"] for c in h.sandbox.read_file.await_args_list] == ["/old.txt", "/new.txt"]
        old = [e for e in h.events if isinstance(e, ToolEvent) and e.tool_call_id == "old"]
        assert [e.status for e in old] == ["calling", "called"]
        second = h.llm.requests[1].messages
        assert [m["role"] for m in second[-3:]] == ["assistant", "tool", "user"]
        assert second[-1]["content"] == "再核对 /new.txt"
        assert h.session.status == SessionStatus.COMPLETED
        assert sum(isinstance(e, DoneEvent) for e in h.events) == 1
        assert {e.run_id for e in h.events} == {active.id}
    asyncio.run(asyncio.wait_for(run(), 5))


def test_message_queued_after_last_request_continues_same_run():
    async def run():
        h = make_loop([text("第一轮答复"), text("第二轮答复")])
        task = input_task()
        active = await start_run(h, task, "第一个问题")
        r = make_runner(h, run=active)

        async def on_publish(seq):
            e = event_at(h, seq)
            if isinstance(e, MessageEvent) and e.message == "第一轮答复":
                await inject(h, task, active.id, "第二个问题")
        h.notifier.on_publish = on_publish
        await r.invoke(task)
        assert h.llm.remaining == 0
        assert sum(isinstance(e, DoneEvent) for e in h.events) == 2
        assert h.llm.requests[1].messages[-1] == {"role": "user", "content": "第二个问题"}
        assert run_statuses(h, active.id) == ["running", "completed"]
        assert h.runs[active.id].turns == 2
    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("prior,live_task,route", [
    ("running", True, "injected"),
    ("running", False, "started"),
    ("waiting", False, "resumed"),
    (None, False, "started"),
])
def test_chat_routes_by_active_run_and_does_not_deduplicate(prior, live_task, route):
    async def run():
        h = make_loop([])
        service = make_service(h)
        existing = None
        if prior is not None:
            existing = await h.ledger.start(h.session.id)
            if prior == "waiting":
                await h.ledger.transition(h.session.id, existing.id, RunStatus.WAITING)
        running_task = input_task()
        running_task.task_runner = SimpleNamespace(run_id=existing.id if existing else None)
        service._get_task = AsyncMock(return_value=running_task if live_task else None)
        created = []

        async def create_task(session, run_id, prior_status):
            new_task = input_task()
            new_task.invoke = AsyncMock()
            new_task.task_runner = SimpleNamespace(run_id=run_id)
            created.append(new_task)
            service._get_task = AsyncMock(return_value=new_task)
            return new_task
        service._create_task = create_task

        first = await service.chat(h.session.id, "同一请求", attachments=[])
        assert first.route == route
        if existing is not None and route in ("injected", "resumed"):
            assert first.run_id == existing.id
        if prior == "running" and not live_task:
            assert h.runs[existing.id].status == RunStatus.INTERRUPTED
            assert h.runs[existing.id].reason == "runner_lost"
        # 同一内容再发一次不去重：进入同一个活动运行
        second = await service.chat(h.session.id, "同一请求", attachments=[])
        assert second.route == "injected" and second.run_id == first.run_id
        messages = [e for e in h.events if isinstance(e, MessageEvent)]
        assert [(m.message, m.run_id) for m in messages] == [("同一请求", first.run_id)] * 2
        assert [m.seq for m in messages] == [first.seq, second.seq]
        assert len(created) == (0 if route == "injected" else 1)
        queued = (running_task if route == "injected" else created[0]).input_stream.items
        assert len(queued) == 2
    asyncio.run(asyncio.wait_for(run(), 5))


def make_shell_sandbox(started: asyncio.Event):
    from app.domain.models.tool_result import ToolResult

    async def exec_command(session_id, exec_dir, command):
        started.set()
        await asyncio.Event().wait()

    sandbox = SimpleNamespace(
        read_file=AsyncMock(return_value=ToolResult(success=True, data={"content": "x"})),
        exec_command=exec_command,
        kill_process=AsyncMock(return_value=ToolResult(success=True, message="进程已终止")),
    )
    return sandbox


def test_stop_cancels_run_kills_registered_shell_and_late_completion_is_ignored(monkeypatch):
    """验收 5：停止 → cancelled；登记的 Shell 会话收到终止请求；迟到的完成与事件不覆盖终态。"""
    monkeypatch.setattr(task_module, "RedisStreamMessageQueue", MemoryQueue)
    from app.domain.services.tools.shell import ShellTool

    async def run():
        started = asyncio.Event()
        sandbox = make_shell_sandbox(started)
        h = make_loop([tool_call("shell_execute", {"session_id": "sh-1", "exec_dir": "/", "command": "sleep 999"},
                                 id="c-sleep")], sandbox=sandbox, extra_tools=[ShellTool(sandbox)])
        service = make_service(h)
        task = task_module.RedisStreamTask(None)
        active = await start_run(h, task, "长命令")
        r = make_runner(h, run=active)
        task._task_runner = r
        service._get_task = AsyncMock(return_value=task)
        await task.invoke()
        execution = task._execution_task
        await started.wait()

        stopped = await service.stop_session(h.session.id)
        assert stopped.status == RunStatus.CANCELLED and stopped.reason == "user_stop"
        assert h.session.status == SessionStatus.CANCELLED
        with pytest.raises(asyncio.CancelledError):
            await execution
        sandbox.kill_process.assert_awaited_once_with("sh-1")
        r._sandbox.destroy.assert_not_awaited()
        terminal = next(e for e in h.events if isinstance(e, RunEvent) and e.status == "cancelled")
        assert terminal.reason == "user_stop" and terminal.summary["turns"] == 1
        # 被中止的轮次由停止事务按运行器快照补写 completed：已发出的请求计入汇总
        closing = [e for e in h.events if e.type == "turn" and e.phase == "completed"]
        assert [(t.index, t.error, t.attempts, t.tool_call_ids) for t in closing] == [(1, "user_stop", 1, [])]
        assert closing[0].seq < terminal.seq and terminal.summary["model_requests"] == 1
        cleanup = h.events[-1]
        assert cleanup.type == "cleanup" and cleanup.seq > terminal.seq
        assert [(t.kind, t.id, t.success) for t in cleanup.targets] == [("shell", "sh-1", True)]

        # 迟到的完成与事件：终态不变，事件不写入
        count = len(h.events)
        assert await h.ledger.transition(h.session.id, active.id, RunStatus.COMPLETED,
                                         events_before=[DoneEvent()]) is None
        assert await h.ledger.append(h.session.id, [MessageEvent(message="迟到")], run_id=active.id) == []
        assert len(h.events) == count
        assert h.runs[active.id].status == RunStatus.CANCELLED
        assert h.session.status == SessionStatus.CANCELLED
        assert await service.stop_session(h.session.id) is None
    asyncio.run(asyncio.wait_for(run(), 5))


def test_runner_stops_writing_when_run_became_terminal_without_cancellation():
    """协程还没被取消时运行已是终态：下一条事件写入失败即退出，不写 completed。"""
    async def run():
        h = make_loop([tool_call("echo", {"text": "x"}, id="c-x"), text("完成")])
        task = input_task()
        active = await start_run(h, task, "任务")
        r = make_runner(h, run=active)

        async def stop_from_outside(_):
            await h.ledger.transition(h.session.id, active.id, RunStatus.CANCELLED, "user_stop")
        h.recording.hook = stop_from_outside
        await r.invoke(task)
        assert h.runs[active.id].status == RunStatus.CANCELLED
        assert run_statuses(h, active.id) == ["running", "cancelled"]
        cancelled_seq = next(e.seq for e in h.events if isinstance(e, RunEvent) and e.status == "cancelled")
        assert all(e.seq < cancelled_seq for e in h.events if not isinstance(e, RunEvent) or e.status != "cancelled")
        assert h.llm.remaining == 1
    asyncio.run(asyncio.wait_for(run(), 5))


def test_stop_mid_batch_then_new_message_repairs_through_runner(monkeypatch):
    monkeypatch.setattr(task_module, "RedisStreamMessageQueue", MemoryQueue)

    async def run():
        first = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall("echo", {"text": "long"}, id="c-long"),
            ScriptedToolCall("echo", {"text": "next"}, id="c-next"),
        ])])
        started = asyncio.Event()

        async def block(_):
            started.set()
            await asyncio.Event().wait()
        first.recording.hook = block
        service = make_service(first)
        task = task_module.RedisStreamTask(None)
        active = await start_run(first, task, "长任务")
        task._task_runner = make_runner(first, run=active)
        service._get_task = AsyncMock(return_value=task)
        await task.invoke()
        await started.wait()
        await service.stop_session(first.session.id)
        assert first.session.status == SessionStatus.CANCELLED

        second = make_loop([text("已按新要求处理")], session=first.session)
        task2 = input_task()
        next_run = await start_run(second, task2, "换个做法")
        await make_runner(second, run=next_run, prior_status=SessionStatus.CANCELLED).invoke(task2)
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        assert {k: v["message"] for k, v in tool_results(request).items()} == {
            "c-long": INTERRUPTED_STOPPED, "c-next": NOT_EXECUTED_STOPPED}
        assert second.session.status == SessionStatus.COMPLETED
        assert first.runs[active.id].status == RunStatus.CANCELLED
        assert second.runs[next_run.id].status == RunStatus.COMPLETED
    asyncio.run(asyncio.wait_for(run(), 5))
