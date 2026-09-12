"""第八章：实际协调、运行器和 Flow；模型、存储、传输与沙箱用替身。"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.application.services.agent_service import AgentService
from app.domain.models.event import DoneEvent, ErrorEvent, MessageEvent, PlanEvent, ToolEvent, WaitEvent
from app.domain.models.session import SessionStatus
from app.domain.models.token_usage import TokenUsageTotals
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.infrastructure.external.task import redis_stream_task as task_module
from test_planner_react_flow import make_flow, read_call, response


class MemoryQueue:
    """只替换传输，不模拟 Redis 锁与多进程。"""
    def __init__(self, name=""):
        self.items, self.history, self.on_put = [], [], None

    async def put(self, value):
        key = str(len(self.history) + 1)
        self.items.append((key, value))
        self.history.append(value)
        if self.on_put:
            await self.on_put(value)
        return key

    async def pop(self):
        return self.items.pop(0) if self.items else (None, None)

    async def is_empty(self):
        return not self.items


def plan():
    return response({"steps": [{"id": "file", "description": "read_file 核对文件"}]})


def make_runner(h):
    r = AgentTaskRunner.__new__(AgentTaskRunner)
    r._session_id, r._uow_factory, r._flow = h.session.id, h.flow._uow_factory, h.flow
    r._uow, r._sandbox = r._uow_factory(), h.sandbox
    r._sandbox.ensure_sandbox, r._sandbox.destroy = AsyncMock(), AsyncMock()
    r._mcp_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._a2a_tool = SimpleNamespace(initialize=AsyncMock(), cleanup=AsyncMock())
    r._token_totals = TokenUsageTotals()
    # 附件/预览不属于本次控制实验。
    r._sync_message_attachments_to_sandbox = AsyncMock()
    r._sync_message_attachments_to_storage = AsyncMock()
    r._handle_tool_event = AsyncMock()

    async def add_event(sid, event):
        h.session.events.append(event.model_copy(deep=True))

    async def update_status(sid, status):
        h.session.status = status

    repo = r._uow.session
    repo.add_event = AsyncMock(side_effect=add_event)
    repo.update_status = AsyncMock(side_effect=update_status)
    repo.update_title, repo.update_latest_message = AsyncMock(), AsyncMock()
    repo.increment_unread_message_count = AsyncMock()
    return r


def input_task():
    return SimpleNamespace(input_stream=MemoryQueue(), output_stream=MemoryQueue())


async def submit(task, text):
    await task.input_stream.put(MessageEvent(role="user", message=text).model_dump_json())


def test_wait_then_new_runner_continues_from_saved_plan_and_reply():
    async def run():
        ask = read_call("ask-1", "/unused")
        ask["tool_calls"][0]["function"] = {
            "name": "message_ask_user", "arguments": json.dumps({"text": "请提供文件路径"})}
        first = make_flow([plan(), ask])
        r, task = make_runner(first), input_task()
        await submit(task, "核对文件，路径待补充")
        await r.invoke(task)
        assert first.session.status == SessionStatus.WAITING
        assert isinstance(first.session.events[-1], WaitEvent)
        assert not first.remaining
        assert not any(isinstance(e, DoneEvent) for e in first.session.events)
        first.sandbox.read_file.assert_not_awaited()
        r._mcp_tool.cleanup.assert_awaited_once()
        assert first.session.memories["react"].messages[-1]["tool_calls"][0]["id"] == "ask-1"
        second = make_flow([
            read_call("read-1", "/hello.txt"), response({"success": True, "result": "核对完成"}),
            response({"steps": []}), response({"message": "完成", "attachments": []}),
        ], session=first.session)
        r2, task2 = make_runner(second), input_task()
        await submit(task2, "/hello.txt")
        await r2.invoke(task2)
        assert second.flow is not first.flow
        assert second.session.status == SessionStatus.COMPLETED
        assert not second.remaining
        assert sum(isinstance(e, PlanEvent) and e.status == "created" for e in second.session.events) == 1
        replies = [m for m in second.requests[0]["messages"] if m.get("tool_call_id") == "ask-1"]
        assert len(replies) == 1
        assert json.loads(replies[0]["content"])["message"] == "/hello.txt"
        second.sandbox.read_file.assert_awaited_once()
        assert second.sandbox.read_file.await_args.kwargs["filepath"] == "/hello.txt"
        assert isinstance(second.session.events[-1], DoneEvent)
    asyncio.run(asyncio.wait_for(run(), 5))


def test_new_input_at_calling_event_switches_flow_before_tool_side_effect():
    async def run():
        h = make_flow([
            plan(), read_call("old", "/old.txt"), plan(), read_call("new", "/new.txt"),
            response({"success": True, "result": "新文件核对完成"}),
            response({"steps": []}), response({"message": "完成", "attachments": []})])
        r, task = make_runner(h), input_task()

        async def inject(value):
            e = json.loads(value)
            if e.get("tool_call_id") == "old" and e.get("status") == "calling":
                await submit(task, "改为核对 /new.txt")
        task.output_stream.on_put = inject
        await submit(task, "核对 /old.txt")
        await r.invoke(task)
        assert not h.remaining
        h.sandbox.read_file.assert_awaited_once()
        assert h.sandbox.read_file.await_args.kwargs["filepath"] == "/new.txt"
        assert sum(isinstance(e, PlanEvent) and e.status == "created" for e in h.session.events) == 2
        old = [e for e in h.session.events if isinstance(e, ToolEvent) and e.tool_call_id == "old"]
        assert [e.status for e in old] == ["calling"]
        assert h.session.status == SessionStatus.COMPLETED
    asyncio.run(asyncio.wait_for(run(), 5))


@pytest.mark.parametrize("status,has_task,created", [
    (SessionStatus.RUNNING, True, False), (SessionStatus.RUNNING, False, True),
    (SessionStatus.WAITING, True, True)])
def test_chat_selects_task_and_does_not_deduplicate(status, has_task, created):
    async def run():
        h = make_flow([])
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
        h = make_flow([])
        r = make_runner(h)
        entered, cleaning, release, persisted = [asyncio.Event() for _ in range(4)]

        async def blocked_flow(message):
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


@pytest.mark.parametrize("iterations,expect_error", [(1, True), (2, False)])
def test_iteration_boundary_checks_last_reply_on_next_pass(iterations, expect_error):
    async def run():
        h = make_flow([read_call("read", "/hello.txt"), response({"message": "完成"})])
        h.flow.react._agent_config.max_iterations = iterations
        events = [e async for e in h.flow.react.invoke("核对文件")]
        assert len(h.requests) == 2
        assert any(isinstance(e, ErrorEvent) and "最大迭代" in e.error for e in events) is expect_error
        h.sandbox.read_file.assert_awaited_once()
    asyncio.run(asyncio.wait_for(run(), 5))
