"""稳定计划身份与有界更新核对；模型与存储使用替身。"""
import asyncio

from app.domain.models.event import ContextEvent, PlanEvent, latest_plan, MessageEvent
from app.domain.models.message import Message
from app.domain.models.run import RunStatus
from app.domain.models.session import SessionStatus
from app.domain.services.plan_progress import PLAN_PROGRESS_PREFIX
from app.domain.services.tools.plan import PlanTool
from app.interfaces.schemas.event import EventMapper
from tests.support.loop_harness import make_loop, input_task, start_run, make_runner, restore_session, submit
from tests.support.scripted_llm import text, tool_call


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 5))


def test_plan_identity_rename_reorder_duplicate_and_reset():
    async def check():
        tool = PlanTool()
        first = await tool.update_plan([{'step': '同名', 'status': 'in_progress'},
                                        {'step': '同名', 'status': 'pending'}])
        a, b = first.data['plan']
        assert a['id'] != b['id']
        original_plan_id = first.data['plan_id']
        changed = await tool.update_plan([{**b, 'step': '验证', 'status': 'in_progress'},
                                         {**a, 'step': '正文', 'status': 'completed'}], '调整顺序')
        assert changed.data['plan_id'] == original_plan_id
        assert [s['id'] for s in changed.data['plan']] == [b['id'], a['id']]
        snapshot = tool.latest_plan.model_copy(deep=True)
        for invalid in ([a, a], [{'id': 'unknown', 'step': 'x', 'status': 'pending'}]):
            failed = await tool.update_plan(invalid)
            assert not failed.success
            assert tool.latest_plan == snapshot
        deleted = await tool.update_plan([{**a, 'status': 'completed'}])
        assert not (await tool.update_plan([b])).success
        new = await tool.update_plan([{'step': '新任务', 'status': 'pending'}], reset=True)
        assert new.data['plan_id'] != deleted.data['plan_id']
        mapped = EventMapper.event_to_sse_event(PlanEvent(plan=snapshot))
        assert mapped.data.explanation == '调整顺序'
        assert [s.id for s in mapped.data.steps] == [b['id'], a['id']]
    run(check())


def test_plan_reminder_is_bounded_and_does_not_complete_steps():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '编写', 'status': 'in_progress'}]}),
                       *[tool_call('echo', {'text': str(i)}) for i in range(17)],
                       text('收尾'), text('还未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        notices = [e for e in events if isinstance(e, ContextEvent) and any(
            str(m.get('content', '')).startswith(PLAN_PROGRESS_PREFIX) for m in e.messages)]
        assert len(notices) == 2
        assert h.loop.plan_tool.latest_plan.steps[0].status == 'running'
        assert h.llm.exhausted_calls == 0
        assert h.loop._plan_progress.notices == 2
        assert not any(PLAN_PROGRESS_PREFIX in e.message for e in events if isinstance(e, MessageEvent))
    run(check())


def _notices(events):
    return [m['content'] for e in events if isinstance(e, ContextEvent) for m in e.messages
            if str(m.get('content', '')).startswith(PLAN_PROGRESS_PREFIX)]


def test_completed_plan_written_in_this_run_does_not_get_reminder():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '已完成', 'status': 'completed'}]}),
                       *[tool_call('echo', {'text': 'x'}) for _ in range(6)], text('完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert _notices(events) == []
    run(check())


def test_run_without_own_plan_gets_one_missing_plan_notice():
    from app.domain.services.plan_progress import PLAN_MISSING_NOTICE
    async def check():
        h = make_loop([*[tool_call('echo', {'text': 'x'}) for _ in range(14)], text('完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert _notices(events) == [PLAN_MISSING_NOTICE]
        assert h.llm.exhausted_calls == 0
    run(check())


def test_short_run_without_plan_is_not_reminded():
    async def check():
        h = make_loop([*[tool_call('echo', {'text': 'x'}) for _ in range(4)], text('完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert _notices(events) == []
    run(check())


def test_completed_plan_from_previous_run_counts_as_missing():
    from app.domain.models.plan import ExecutionStatus, Plan, Step
    from app.domain.services.plan_progress import PlanProgress, PLAN_MISSING_NOTICE, PLAN_PROGRESS_NOTICE
    from app.domain.models.event import TurnEvent, TurnPhase, ToolEvent, ToolEventStatus
    from app.domain.models.tool_result import ToolResult

    def batch(progress, i):
        progress.observe(ToolEvent(tool_call_id=str(i), tool_name='test', function_name='write_file',
                                   function_args={}, status=ToolEventStatus.CALLED,
                                   function_result=ToolResult(success=True)))
        progress.observe(TurnEvent(index=i + 1, phase=TurnPhase.COMPLETED))

    old_done = Plan(steps=[Step(description='旧任务', status=ExecutionStatus.COMPLETED)])
    old_open = Plan(steps=[Step(description='旧任务', status=ExecutionStatus.RUNNING)])
    progress = PlanProgress()
    for i in range(4):
        batch(progress, i)
    assert progress.notice(old_done) is None
    batch(progress, 4)
    assert progress.notice(old_done) == PLAN_MISSING_NOTICE
    assert progress.notice(None) == PLAN_MISSING_NOTICE
    # 上一次留下的未完成清单沿用原来的更新提醒
    assert progress.notice(old_open) == PLAN_PROGRESS_NOTICE
    # 本次已提交计划后不再按缺失提醒
    progress.observe(PlanEvent(plan=old_done))
    for i in range(5, 10):
        batch(progress, i)
    assert progress.notice(old_done) is None


def test_missing_notice_shares_the_two_notice_cap():
    from app.domain.services.plan_progress import PlanProgress, PLAN_MISSING_NOTICE, PLAN_PROGRESS_NOTICE
    async def check():
        h = make_loop([*[tool_call('echo', {'text': 'x'}) for _ in range(5)],
                       tool_call('update_plan', {'plan': [{'step': '编写', 'status': 'in_progress'}]}),
                       *[tool_call('echo', {'text': 'x'}) for _ in range(30)], text('收尾'), text('未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        notices = _notices(events)
        assert notices[0] == PLAN_MISSING_NOTICE
        assert notices[1:] == [PLAN_PROGRESS_NOTICE]
        assert h.loop._plan_progress.notices == 2
    run(check())


def test_wait_resume_restores_reminder_count_from_run_events():
    async def check():
        first = make_loop([tool_call('update_plan', {'plan': [{'step': '编写', 'status': 'in_progress'}]}),
                           *[tool_call('echo', {'text': 'x'}) for _ in range(5)],
                           tool_call('message_ask_user', {'text': '继续吗？'})], max_iterations=100)
        task = input_task()
        waiting = await start_run(first, task, '编写')
        await make_runner(first, run=waiting).invoke(task)
        assert first.loop._plan_progress.notices == 1
        restored = restore_session(first.session)
        second = make_loop([*[tool_call('echo', {'text': 'x'}) for _ in range(12)], text('结束')],
                           session=restored, max_iterations=100)
        task = input_task()
        resumed = await second.ledger.transition(restored.id, waiting.id, RunStatus.RUNNING,
                                                events_after=[MessageEvent(role='user', message='继续')])
        await submit(task, '继续')
        await make_runner(second, run=resumed, prior_status=SessionStatus.WAITING).invoke(task)
        assert second.loop._plan_progress.notices == 2
        assert latest_plan(second.events).steps[0].status == 'running'
        assert second.llm.exhausted_calls == 0
    run(check())


def test_batches_not_calls_and_plan_updates_reset_interval():
    import json
    from tests.support.scripted_llm import Dynamic, ScriptedResponse, ScriptedToolCall

    async def check():
        def update(request):
            result = next(json.loads(m['content']) for m in reversed(request.messages)
                          if m.get('function_name') == 'update_plan')
            return tool_call('update_plan', {'plan': result['data']['plan']})

        multi = ScriptedResponse(tool_calls=[ScriptedToolCall('echo', {'text': 'x'}) for _ in range(8)])
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '编写', 'status': 'in_progress'}]}),
                       multi, *[tool_call('echo', {'text': 'x'}) for _ in range(3)],
                       Dynamic(update), *[tool_call('echo', {'text': 'x'}) for _ in range(4)],
                       text('结束'), text('未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert not any(isinstance(e, ContextEvent) and any(
            str(m.get('content', '')).startswith(PLAN_PROGRESS_PREFIX) for m in e.messages) for e in events)
        assert h.llm.exhausted_calls == 0
    run(check())


def test_polling_and_failed_calls_do_not_advance_reminder():
    from app.domain.models.event import ToolEvent, ToolEventStatus, TurnEvent, TurnPhase
    from app.domain.models.plan import Plan, Step
    from app.domain.models.tool_result import ToolResult
    from app.domain.services.plan_progress import PlanProgress, POLL_TOOLS

    progress = PlanProgress()
    for i, name in enumerate([*POLL_TOOLS, 'write_file'] * 4):
        progress.observe(ToolEvent(tool_call_id=str(i), tool_name='test', function_name=name,
                                   function_args={}, status=ToolEventStatus.CALLED,
                                   function_result=ToolResult(success=name != 'write_file')))
        progress.observe(TurnEvent(index=i + 1, phase=TurnPhase.COMPLETED))
    assert not progress.due(Plan(steps=[Step(description='编写')]))
    assert progress.batches == 0
