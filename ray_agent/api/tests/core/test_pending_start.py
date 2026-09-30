"""启动闸门：不连接 Docker，验证受理/注入/停止与迟到资源所有权。"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.application.services.agent_service import pending_starts
from app.domain.models.run import RunStatus
from tests.core.test_task_execution_control import make_service
from tests.support.loop_harness import input_task, make_loop


def test_slow_start_accepts_injects_stops_and_cleans_late_container():
    async def scenario():
        h = make_loop([])
        service = make_service(h)
        service._get_task = AsyncMock(return_value=None)
        entered, release = asyncio.Event(), asyncio.Event()
        box = SimpleNamespace(id="late-box", destroy=AsyncMock())
        task = input_task()
        task.invoke = AsyncMock()
        task.task_runner = SimpleNamespace(_sandbox=box)
        calls = []

        async def create(session, run_id, prior):
            calls.append(run_id)
            entered.set()
            await release.wait()
            session.sandbox_id = box.id
            return task
        service._create_task = create
        accepted = await service.chat(h.session.id, "第一条")
        assert h.runs[accepted.run_id].status == RunStatus.RUNNING
        await entered.wait()
        injected = await service.chat(h.session.id, "补充")
        assert injected.run_id == accepted.run_id and injected.route == "injected"
        owner = pending_starts()[accepted.run_id]
        assert len(owner.messages) == 2
        stopped = await service.stop_session(h.session.id)
        assert stopped.status == RunStatus.CANCELLED
        assert not release.is_set()
        release.set()
        await owner.worker
        task.invoke.assert_not_awaited()
        box.destroy.assert_awaited_once()
        assert h.session.sandbox_id is None and h.session.task_id is None
        assert calls == [accepted.run_id]
        assert accepted.run_id not in pending_starts()
    asyncio.run(asyncio.wait_for(scenario(), 3))


def test_start_failure_is_observed_after_acceptance():
    async def scenario():
        h = make_loop([])
        service = make_service(h)
        service._get_task = AsyncMock(return_value=None)
        service._create_task = AsyncMock(side_effect=RuntimeError("Docker unavailable"))
        accepted = await service.chat(h.session.id, "开始")
        await pending_starts()[accepted.run_id].worker
        assert h.runs[accepted.run_id].status == RunStatus.FAILED
        assert any(e.type == "error" and "准备执行环境失败" in e.error for e in h.events)
        assert accepted.run_id not in pending_starts()
    asyncio.run(scenario())


def test_start_drains_messages_and_publishes_only_after_creation():
    async def scenario():
        h = make_loop([])
        service = make_service(h)
        service._get_task = AsyncMock(return_value=None)
        gate = asyncio.Event()
        task = input_task()
        task.invoke = AsyncMock()
        task.task_runner = SimpleNamespace(run_id=None)

        async def create(session, run_id, prior):
            await gate.wait()
            session.sandbox_id = "ready-box"
            task.task_runner.run_id = run_id
            return task
        service._create_task = create
        first = await service.chat(h.session.id, "开始")
        second = await service.chat(h.session.id, "追加")
        assert second.run_id == first.run_id
        assert h.session.task_id is None
        owner = pending_starts()[first.run_id]
        gate.set()
        await owner.worker
        assert h.session.sandbox_id == "ready-box"
        assert h.session.task_id == task.id
        task.invoke.assert_awaited_once()
        assert len(task.input_stream.items) == 2
    asyncio.run(scenario())


def test_late_old_start_cannot_override_new_run_resources():
    async def scenario():
        h = make_loop([])
        service = make_service(h)
        service._get_task = AsyncMock(return_value=None)
        old_gate = asyncio.Event()
        old_box = SimpleNamespace(id="old-box", destroy=AsyncMock())
        new_box = SimpleNamespace(id="new-box", destroy=AsyncMock())
        tasks = []
        async def create(session, run_id, prior):
            first = not tasks
            task = input_task()
            task.id = "old-task" if first else "new-task"
            task.invoke = AsyncMock()
            box = old_box if first else new_box
            task.task_runner = SimpleNamespace(_sandbox=box, run_id=run_id)
            tasks.append(task)
            if first:
                await old_gate.wait()
            session.sandbox_id = box.id
            return task
        service._create_task = create
        old = await service.chat(h.session.id, "先开始")
        owner = pending_starts()[old.run_id]
        await asyncio.sleep(0)
        await service.stop_session(h.session.id)
        new = await service.chat(h.session.id, "重新开始")
        await pending_starts()[new.run_id].worker
        old_gate.set()
        await owner.worker
        assert h.session.sandbox_id == "new-box" and h.session.task_id == "new-task"
        tasks[0].invoke.assert_not_awaited()
        tasks[1].invoke.assert_awaited_once()
        old_box.destroy.assert_awaited_once()
        new_box.destroy.assert_not_awaited()
    asyncio.run(scenario())


def test_shutdown_revokes_start_ownership_and_waits_for_cleanup():
    async def scenario():
        h = make_loop([])
        task_class = SimpleNamespace(destroy=AsyncMock())
        service = make_service(h, task_class)
        service._get_task = AsyncMock(return_value=None)
        gate = asyncio.Event()
        box = SimpleNamespace(id="shutdown-box", destroy=AsyncMock())
        task = input_task()
        task.invoke = AsyncMock()
        task.task_runner = SimpleNamespace(_sandbox=box)
        async def create(session, run_id, prior):
            await gate.wait()
            session.sandbox_id = box.id
            return task
        service._create_task = create
        accepted = await service.chat(h.session.id, "开始")
        owner = pending_starts()[accepted.run_id]
        closing = asyncio.create_task(service.shutdown())
        await asyncio.sleep(0)
        assert owner.cancelled and not closing.done()
        gate.set()
        await closing
        box.destroy.assert_awaited_once()
        task.invoke.assert_not_awaited()
        task_class.destroy.assert_awaited_once()
        assert not pending_starts()
    asyncio.run(scenario())


def test_expired_attachment_is_rejected_before_user_event_or_run_acceptance():
    import pytest
    from app.application.errors.exceptions import BadRequestError

    async def scenario():
        h = make_loop([])
        service = make_service(h)
        service._create_task = AsyncMock()
        with pytest.raises(BadRequestError, match="附件已失效"):
            await service.chat(h.session.id, "带附件发送", attachments=["expired-file"])
        assert not h.events and not h.runs and not pending_starts()
        service._create_task.assert_not_awaited()
    asyncio.run(scenario())
