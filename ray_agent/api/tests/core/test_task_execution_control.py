"""执行控制：实际协调、运行器和 Agent 循环；模型、存储、传输与沙箱用替身。"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.application.services.agent_service import AgentService
from app.domain.models.event import DoneEvent, MessageEvent, ToolEvent, WaitEvent
from app.domain.models.session import SessionStatus
from app.infrastructure.external.task import redis_stream_task as task_module
from tests.support.loop_harness import (
    MemoryQueue,
    assert_no_dangling,
    input_task,
    make_loop,
    make_runner,
    memory_messages,
    submit,
    tool_results,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call


def ask(call_id="ask-1", question="请提供文件路径"):
    return tool_call("message_ask_user", {"text": question}, id=call_id)


def test_wait_then_new_runner_continues_with_reply_as_ask_result():
    async def run():
        first = make_loop([ask()])
        r, task = make_runner(first), input_task()
        await submit(task, "核对文件，路径待补充")
        await r.invoke(task)
        assert first.session.status == SessionStatus.WAITING
        assert isinstance(first.session.events[-1], WaitEvent)
        assert first.llm.remaining == 0
        assert not any(isinstance(e, DoneEvent) for e in first.session.events)
        first.sandbox.read_file.assert_not_awaited()
        r._mcp_tool.cleanup.assert_awaited_once()
        assert memory_messages(first.session)[-1]["tool_calls"][0]["id"] == "ask-1"

        second = make_loop([tool_call("read_file", {"filepath": "/hello.txt"}, id="read-1"), text("核对完成")],
                           session=first.session)
        r2, task2 = make_runner(second), input_task()
        await submit(task2, "/hello.txt")
        await r2.invoke(task2)
        assert second.loop is not first.loop
        assert second.session.status == SessionStatus.COMPLETED
        assert second.llm.remaining == 0
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        assert tool_results(request)["ask-1"]["data"]["reply"] == "/hello.txt"
        second.sandbox.read_file.assert_awaited_once()
        assert second.sandbox.read_file.await_args.kwargs["filepath"] == "/hello.txt"
        assert isinstance(second.session.events[-1], DoneEvent)
    asyncio.run(asyncio.wait_for(run(), 5))


def test_new_input_during_tool_is_injected_without_interrupting_or_replanning():
    async def run():
        h = make_loop([
            tool_call("read_file", {"filepath": "/old.txt"}, id="old"),
            tool_call("read_file", {"filepath": "/new.txt"}, id="new"),
            text("两个文件都核对完成"),
        ])
        r, task = make_runner(h), input_task()

        async def inject(value):
            e = json.loads(value)
            if e.get("tool_call_id") == "old" and e.get("status") == "calling":
                await submit(task, "再核对 /new.txt")
        task.output_stream.on_put = inject
        await submit(task, "核对 /old.txt")
        await r.invoke(task)

        assert h.llm.remaining == 0
        assert [c.kwargs["filepath"] for c in h.sandbox.read_file.await_args_list] == ["/old.txt", "/new.txt"]
        old = [e for e in h.session.events if isinstance(e, ToolEvent) and e.tool_call_id == "old"]
        assert [e.status for e in old] == ["calling", "called"]
        second = h.llm.requests[1].messages
        assert [m["role"] for m in second[-3:]] == ["assistant", "tool", "user"]
        assert second[-1]["content"] == "再核对 /new.txt"
        assert h.session.status == SessionStatus.COMPLETED
        assert sum(isinstance(e, DoneEvent) for e in h.session.events) == 1
    asyncio.run(asyncio.wait_for(run(), 5))


def test_message_queued_after_last_request_starts_next_run():
    async def run():
        h = make_loop([text("第一轮答复"), text("第二轮答复")])
        r, task = make_runner(h), input_task()

        async def inject(value):
            e = json.loads(value)
            if e.get("type") == "message" and e.get("message") == "第一轮答复":
                await submit(task, "第二个问题")
        task.output_stream.on_put = inject
        await submit(task, "第一个问题")
        await r.invoke(task)
        assert h.llm.remaining == 0
        assert sum(isinstance(e, DoneEvent) for e in h.session.events) == 2
        assert h.llm.requests[1].messages[-1] == {"role": "user", "content": "第二个问题"}
    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("status,has_task,created", [
    (SessionStatus.RUNNING, True, False), (SessionStatus.RUNNING, False, True),
    (SessionStatus.WAITING, True, True)])
def test_chat_selects_task_and_does_not_deduplicate(status, has_task, created):
    async def run():
        h = make_loop([])
        r = make_runner(h)
        h.session.status = status
        task = input_task()
        task.done, task.invoke = True, AsyncMock()
        service = AgentService.__new__(AgentService)
        service._uow, service._uow_factory = r._uow, r._uow_factory
        service._get_task = AsyncMock(return_value=task if has_task else None)
        service._create_task = AsyncMock(return_value=task)
        service._safe_update_unread_count = AsyncMock()
        for _ in range(2):
            events = [e async for e in service.chat(h.session.id, "同一请求", attachments=[])]
            assert isinstance(events[0], MessageEvent)
        assert len(task.input_stream.items) == 2
        assert service._create_task.await_count == (2 if created else 0)
        assert task.invoke.await_count == 2
        await asyncio.sleep(0)
    asyncio.run(asyncio.wait_for(run(), 5))


def test_stop_returns_before_cleanup_and_does_not_destroy_sandbox(monkeypatch):
    monkeypatch.setattr(task_module, "RedisStreamMessageQueue", MemoryQueue)

    async def run():
        h = make_loop([])
        r = make_runner(h)
        entered, cleaning, release, persisted = [asyncio.Event() for _ in range(4)]

        async def blocked_flow(message, task=None):
            entered.set()
            await asyncio.Event().wait()
            yield DoneEvent()

        async def cleanup():
            cleaning.set()
            await release.wait()

        original = r._persist_terminal_state

        async def persist(*args):
            await original(*args)
            persisted.set()
        r._run_flow, r._persist_terminal_state = blocked_flow, persist
        r._mcp_tool.cleanup.side_effect = cleanup
        task = task_module.RedisStreamTask(r)
        service = AgentService.__new__(AgentService)
        service._uow, service._get_task = r._uow, AsyncMock(return_value=task)
        await submit(task, "长操作")
        await task.invoke()
        execution = task._execution_task
        try:
            await entered.wait()
            await task.invoke()
            assert task._execution_task is execution
            await service.stop_session(h.session.id)
            assert h.session.status == SessionStatus.COMPLETED
            assert task_module.RedisStreamTask.get(task.id) is None
            assert not task.done
            await cleaning.wait()
            await persisted.wait()
            assert any(isinstance(e, DoneEvent) for e in h.session.events)
            assert not task.done
            r._sandbox.destroy.assert_not_awaited()
        finally:
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await execution
            await asyncio.sleep(0)
        assert task.done
    asyncio.run(asyncio.wait_for(run(), 5))


def test_stop_mid_batch_then_new_message_repairs_through_runner():
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
        r, task = make_runner(first), input_task()
        await submit(task, "长任务")
        execution = asyncio.create_task(r.invoke(task))
        await started.wait()
        execution.cancel()
        with pytest.raises(asyncio.CancelledError):
            await execution
        await asyncio.sleep(0)
        assert first.session.status == SessionStatus.COMPLETED

        second = make_loop([text("已按新要求处理")], session=first.session)
        r2, task2 = make_runner(second), input_task()
        await submit(task2, "换个做法")
        await r2.invoke(task2)
        request = second.llm.requests[0].messages
        assert_no_dangling(request)
        assert {k: v["message"] for k, v in tool_results(request).items()} == {
            "c-long": "执行中断：任务在该调用执行期间被停止，调用可能已部分生效，结果未知",
            "c-next": "未执行：任务已停止"}
        assert second.session.status == SessionStatus.COMPLETED
    asyncio.run(asyncio.wait_for(run(), 5))
