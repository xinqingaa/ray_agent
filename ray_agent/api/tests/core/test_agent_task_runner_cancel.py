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


class _Leases:
    def __init__(self):
        self.calls = []

    async def begin_settle(self, run_id):
        self.calls.append(("begin", run_id))

    async def finish_settle(self, run_id, confirmed):
        self.calls.append(("finish", run_id, confirmed))
        return []


def test_stop_settles_write_leases_after_the_execution_coroutine_exits_or_reports_unconfirmed():
    """停止收尾：执行协程退出后释放该运行的写入租约；期限内未确认退出则交给租约转为 blocked。"""
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
        runner._write_leases = leases = _Leases()
        execution = asyncio.create_task(runner.invoke(task))
        await started.wait()
        execution.cancel()
        with pytest.raises(asyncio.CancelledError):
            await execution
        await runner.stop_processes(active.id, settle_seconds=0.5)
        assert leases.calls[0] == ("finish", active.id, True)  # 执行协程退出时即释放
        assert leases.calls[-2:] == [("begin", active.id), ("finish", active.id, True)]

        stuck = make_runner(h, run=active)
        stuck._write_leases = unconfirmed = _Leases()
        stuck._invoking = True  # 执行协程仍在运行且不退出
        await stuck.stop_processes(active.id, settle_seconds=0.05)
        assert unconfirmed.calls == [("begin", active.id), ("finish", active.id, False)]
    asyncio.run(asyncio.wait_for(run(), 5))


def test_waiting_keeps_execution_resources_and_resume_cleans_before_releasing():
    from tests.support.loop_harness import resume_run
    from tests.support.scripted_llm import text
    async def run():
        h = make_loop([tool_call('message_ask_user', {'text': '继续吗？'}), text('完成')])
        task = input_task()
        active = await start_run(h, task, '等待期间保留写入者')
        runner = make_runner(h, run=active)
        order = []
        async def close():
            order.append('processes-stopped')
            return True
        class Leases(_Leases):
            async def finish_settle(self, run_id, confirmed):
                assert order == ['processes-stopped']
                await super().finish_settle(run_id, confirmed)
        runner._execution_cleanup = close
        runner._write_leases = leases = Leases()
        await runner.invoke(task)
        assert h.runs[active.id].status is RunStatus.WAITING
        assert order == [] and leases.calls == []
        await resume_run(h, active.id, '继续')
        resumed = make_runner(h, run=h.runs[active.id])
        resumed._execution_cleanup, resumed._write_leases = close, leases
        await resumed.invoke(task)
        assert h.runs[active.id].status is RunStatus.COMPLETED
        assert leases.calls == [('finish', active.id, True)]
    asyncio.run(asyncio.wait_for(run(), 5))
