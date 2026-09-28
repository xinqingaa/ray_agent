#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""任务取消时运行器不再写库：终态由停止接口在同一事务里写好。"""
import asyncio

import pytest

from app.domain.models.event import RunEvent
from app.domain.models.run import RunStatus
from tests.support.loop_harness import input_task, make_loop, make_runner, start_run
from tests.support.scripted_llm import tool_call


def test_cancelled_runner_writes_nothing_after_cancellation():
    async def run():
        h = make_loop([tool_call("echo", {"text": "long"}, id="c-long")])
        started = asyncio.Event()

        async def block(_):
            started.set()
            await asyncio.Event().wait()
        h.recording.hook = block
        task = input_task()
        active = await start_run(h, task, "长任务")
        runner = make_runner(h, run=active)
        execution = asyncio.create_task(runner.invoke(task))
        await started.wait()
        count = len(h.events)
        execution.cancel()
        with pytest.raises(asyncio.CancelledError):
            await execution
        await asyncio.sleep(0)
        assert len(h.events) == count
        # 没有经过停止接口的取消（例如进程关闭）不写终态，留给启动扫描置为 interrupted
        assert h.runs[active.id].status == RunStatus.RUNNING
        assert [e.status for e in h.events if isinstance(e, RunEvent)] == ["running"]
        runner._mcp_tool.cleanup.assert_awaited_once()
        interrupted = await h.ledger.interrupt_running()
        assert [r.id for r in interrupted] == [active.id]
        assert h.runs[active.id].status == RunStatus.INTERRUPTED and h.runs[active.id].reason == "api_restart"
    asyncio.run(asyncio.wait_for(run(), 5))
