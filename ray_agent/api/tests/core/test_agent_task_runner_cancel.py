#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""任务取消时终态写入必须离开被取消的 Task。"""
import asyncio
from unittest.mock import AsyncMock, MagicMock

from app.domain.models.event import DoneEvent
from app.domain.models.session import SessionStatus
from app.domain.services.agent_task_runner import AgentTaskRunner


def test_schedule_detached_runs_coro():
    async def _run():
        runner = AgentTaskRunner.__new__(AgentTaskRunner)
        runner._session_id = "session-1"
        ran = []

        async def work():
            ran.append(True)

        runner._schedule_detached(work())
        await asyncio.sleep(0)
        assert ran == [True]

    asyncio.run(_run())


def test_persist_terminal_state_uses_fresh_uow():
    async def _run():
        class FakeUow:
            def __init__(self):
                self.session = AsyncMock()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        uow = FakeUow()
        runner = AgentTaskRunner.__new__(AgentTaskRunner)
        runner._session_id = "session-1"
        runner._uow_factory = MagicMock(return_value=uow)
        task = MagicMock()
        task.output_stream.put = AsyncMock(return_value="event-1")

        event = DoneEvent()
        await runner._persist_terminal_state(task, SessionStatus.COMPLETED, event)

        assert event.id == "event-1"
        runner._uow_factory.assert_called_once()
        uow.session.add_event.assert_awaited()
        uow.session.update_status.assert_awaited_with(
            "session-1",
            SessionStatus.COMPLETED,
        )

    asyncio.run(_run())
