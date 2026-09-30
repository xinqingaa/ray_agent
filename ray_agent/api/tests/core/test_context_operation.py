"""同步摘要的总期限、即时忙碌冲突、取消原子性与状态释放。"""
import asyncio
from unittest.mock import AsyncMock

import pytest

from app.application.errors.exceptions import AppException, ConflictError
from app.application.services import agent_service as module
from app.application.services.context_operations import context_operation
from tests.core.test_context_governance import seeded_session
from tests.core.test_plan_mode_and_compact import compact_service
from tests.support.loop_harness import memory_messages


def test_compaction_busy_read_and_cancel_are_atomic():
    async def scenario():
        session, original = seeded_session(10)
        h, service = compact_service(session, [])
        entered, release = asyncio.Event(), asyncio.Event()

        async def blocked(*args, **kwargs):
            entered.set()
            await release.wait()
        service._llm.invoke = blocked
        before_events = len(h.events)
        worker = asyncio.create_task(service.compact_session(session.id))
        await entered.wait()
        assert context_operation(session.id)["status"] == "compacting"
        assert context_operation(session.id)["started_at"] is not None
        with pytest.raises(ConflictError, match="正在压缩"):
            await service.chat(session.id, "另一标签发送")
        with pytest.raises(ConflictError, match="正在压缩"):
            await service.compact_session(session.id)
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker
        assert context_operation(session.id)["status"] == "idle"
        assert memory_messages(session) == original
        assert len(h.events) == before_events
    asyncio.run(asyncio.wait_for(scenario(), 3))


def test_total_deadline_rolls_back_and_releases_state(monkeypatch):
    async def scenario():
        session, original = seeded_session(10)
        h, service = compact_service(session, [])
        service._llm.invoke = AsyncMock(side_effect=lambda *a, **kw: None)
        async def blocked(*args, **kwargs):
            await asyncio.Event().wait()
        service._llm.invoke = blocked
        before_events = len(h.events)
        monkeypatch.setattr(module, "MANUAL_COMPACT_TIMEOUT_SECONDS", 0.01)
        with pytest.raises(AppException) as raised:
            await service.compact_session(session.id)
        assert raised.value.status_code == 504
        assert memory_messages(session) == original and len(h.events) == before_events
        assert context_operation(session.id)["status"] == "idle"
    asyncio.run(scenario())
