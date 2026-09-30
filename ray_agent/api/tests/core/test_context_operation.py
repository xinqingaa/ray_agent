"""同步摘要的总期限、即时忙碌冲突、取消原子性与状态释放。"""
import asyncio
from unittest.mock import AsyncMock

import pytest

from app.application.errors.exceptions import AppException, ConflictError
from app.application.services import agent_service as module
from app.application.services.context_operations import context_operation
from app.domain.models.event import CompactEvent
from app.domain.models.run import Run, RunStatus
from app.domain.models.workspace_project import WorkspaceProject
from tests.core.test_context_governance import SUMMARY, seeded_session
from tests.core.test_plan_mode_and_compact import compact_service
from tests.support.loop_harness import memory_messages
from tests.support.scripted_llm import text, usage


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


def test_manual_fixed_input_overflow_has_budget_and_no_side_effects():
    async def scenario():
        session, _ = seeded_session(10)
        session.memories['agent'].messages[0]['content'] = '项目固定约束' * 12000
        original = [dict(m) for m in memory_messages(session)]
        h, service = compact_service(session, [])
        before_events = len(h.events)
        with pytest.raises(AppException) as raised:
            await service.compact_session(session.id)
        assert raised.value.status_code == 422
        assert raised.value.data['reason'] == 'context_limit'
        budget = raised.value.data['fixed_input']
        assert budget['total'] > budget['limit']
        assert memory_messages(session) == original
        assert len(h.events) == before_events and not h.llm.requests
        assert context_operation(session.id)['status'] == 'idle'
    asyncio.run(scenario())


def test_manual_compact_counts_live_project_segment_without_storing_it():
    async def scenario():
        async def remember_completed_run(h):
            snapshot = await h.loop.config_snapshot()
            done = Run(session_id=h.session.id, status=RunStatus.COMPLETED, turns=10, config_snapshot=snapshot)
            h.runs[done.id] = done

        plain, _ = seeded_session(10)
        plain_h, plain_service = compact_service(plain, [text(SUMMARY, usage=usage(9000, 300))])
        await remember_completed_run(plain_h)
        await plain_service.compact_session(plain.id)
        plain_compact = next(event for event in plain_h.events if isinstance(event, CompactEvent))

        session, _ = seeded_session(10)
        session.project = WorkspaceProject(id="project-1", name="验收", instructions="项目固定说明甲" * 40)
        h, service = compact_service(session, [text(SUMMARY, usage=usage(9000, 300))])
        await remember_completed_run(h)
        system_before = memory_messages(session)[0]["content"]
        result = await service.compact_session(session.id)
        assert result.status == "compacted"
        compact = next(event for event in h.events if isinstance(event, CompactEvent))
        assert compact.before_estimate["includes_project_context"] is True
        assert compact.after_estimate["includes_project_context"] is True
        assert compact.before_estimate["system_prompt"] > plain_compact.before_estimate["system_prompt"]
        assert "includes_project_context" not in plain_compact.before_estimate
        assert memory_messages(session)[0]["content"] == system_before
        assert all("项目固定说明甲" not in str(message.get("content") or "") for message in memory_messages(session))
    asyncio.run(scenario())
