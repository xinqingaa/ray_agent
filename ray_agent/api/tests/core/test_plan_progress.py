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


def test_due_skips_one_batch_then_degrades_without_fake_completion():
    from app.domain.models.event import ToolEvent
    from tests.support.loop_harness import assert_no_dangling, memory_messages
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '编写', 'status': 'in_progress'}]}),
                       *[tool_call('echo', {'text': str(i)}) for i in range(12)], text('未完成'), text('未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert h.recording.calls == [f'echo:{i}' for i in range(12) if i != 3]
        skipped = [e for e in events if isinstance(e, ToolEvent) and e.denied_by == 'batch']
        assert len(skipped) == 1 and skipped[0].function_result.data['executed'] is False
        assert len([e for e in events if isinstance(e, PlanEvent) and e.progress_state == 'unconfirmed']) == 1
        assert len([e for e in events if isinstance(e, ContextEvent) and e.plan_check == 'corrected']) == 1
        assert h.loop.plan_tool.latest_plan.steps[0].status == 'running'
        assert_no_dangling(memory_messages(h.session))
        assert h.loop.budget_used == h.llm.call_count
    run(check())


def test_light_review_and_business_in_same_batch_resets_interval():
    from tests.support.scripted_llm import Dynamic, ScriptedResponse, ScriptedToolCall
    async def check():
        def review(request):
            step = h.loop.plan_tool.latest_plan.steps[0]
            return ScriptedResponse(tool_calls=[ScriptedToolCall('update_plan', {'action':'review', 'step_id':step.id}),
                                                ScriptedToolCall('echo', {'text':'after-review'})])
        h = make_loop([tool_call('update_plan', {'plan':[{'step':'编写', 'status':'in_progress'}]}),
                       *[tool_call('echo', {'text':'work'}) for _ in range(3)], Dynamic(review),
                       text('未完成'), text('未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='测试'))]
        assert h.recording.calls[-1] == 'echo:after-review'
        assert not h.loop._plan_progress.corrected
        reviews = [e for e in events if isinstance(e, PlanEvent) and e.review_only]
        assert len(reviews) == 1 and reviews[0].progress_state == 'confirmed'
    run(check())


def test_completed_prior_plan_requires_decision_before_write_but_simple_reply_does_not():
    from app.domain.models.plan import Plan, Step, ExecutionStatus
    from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall
    async def check():
        old = Plan(steps=[Step(description='旧任务', status=ExecutionStatus.COMPLETED)])
        h = make_loop([text('直接回答')])
        h.loop.plan_tool.latest_plan = old
        _ = [e async for e in h.loop.invoke(Message(message='一句话'))]
        assert h.llm.call_count == 1
        h = make_loop([ScriptedResponse(tool_calls=[ScriptedToolCall('update_plan', {'action':'not_needed'}),
                       ScriptedToolCall('echo', {'text':'small-change'})]), text('完成')])
        h.loop.plan_tool.latest_plan = old
        events = [e async for e in h.loop.invoke(Message(message='小改'))]
        assert h.recording.calls == ['echo:small-change']
        assert any(isinstance(e, PlanEvent) and e.progress_state == 'not_needed' for e in events)
        assert not h.loop._plan_progress.corrected
    run(check())


def test_wait_resume_restores_correction_and_degrades_only_once():
    async def check():
        first = make_loop([*[tool_call('echo', {'text':str(i)}) for i in range(4)],
                           tool_call('message_ask_user', {'text':'缺少哪份材料？'})], max_iterations=100)
        task = input_task()
        active = await start_run(first, task, '编写')
        await make_runner(first, run=active).invoke(task)
        assert first.loop._plan_progress.corrected
        restored = restore_session(first.session)
        second = make_loop([tool_call('echo', {'text':'resumed'}), text('结束')], session=restored, max_iterations=100)
        task = input_task()
        resumed = await second.ledger.transition(restored.id, active.id, RunStatus.RUNNING,
            events_after=[MessageEvent(role='user', message='材料')])
        await submit(task, '材料')
        await make_runner(second, run=resumed, prior_status=SessionStatus.WAITING).invoke(task)
        assert second.recording.calls == ['echo:resumed']
        assert second.loop._plan_progress.degraded
        assert len([e for e in second.events if isinstance(e, ContextEvent) and e.plan_check == 'corrected']) == 1
    run(check())


def test_adopted_plan_requires_selection_and_keeps_identity():
    from app.domain.models.plan import Plan, Step
    from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall
    async def check():
        plan = Plan(steps=[Step(description='执行')])
        h = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('update_plan', {'plan':[{'id':plan.steps[0].id,'step':'执行','status':'in_progress'}]}),
            ScriptedToolCall('echo', {'text':'first'})]), text('未完成'), text('未完成')])
        task = input_task()
        active = await start_run(h, task, '执行')
        await h.ledger.append(h.session.id, [PlanEvent(plan=plan, progress_state='preparing')], run_id=active.id)
        await make_runner(h, run=active).invoke(task)
        assert h.recording.calls == ['echo:first']
        assert h.loop.plan_tool.latest_plan.id == plan.id
        assert not h.loop._plan_progress.corrected
    run(check())


def test_acceptance_service_routes_retries_without_injection():
    from unittest.mock import Mock
    from tests.core.test_task_execution_control import make_service
    from app.domain.models.run import RunMode
    from app.domain.models.plan import Plan, Step
    from app.domain.models.plan_acceptance import PlanAcceptance
    async def check():
        h = make_loop([])
        proposal = await h.ledger.start(h.session.id, mode=RunMode.PLAN)
        event = PlanEvent(plan=Plan(steps=[Step(description='执行')]))
        await h.ledger.append(h.session.id, [event], run_id=proposal.id)
        await h.ledger.transition(h.session.id, proposal.id, RunStatus.COMPLETED)
        service = make_service(h)
        service._schedule_start = Mock()
        ref = PlanAcceptance(source_run_id=proposal.id, plan_id=event.plan.id, source_seq=event.seq, request_id='r')
        first = await service.chat(h.session.id, '按计划执行', execute_plan=ref)
        second = await service.chat(h.session.id, '按计划执行', execute_plan=ref)
        assert first == second and first.route == 'started'
        service._schedule_start.assert_called_once()
        assert len(h.runs) == 2
    run(check())


def test_compaction_does_not_reset_review_state():
    from app.domain.models.event import ContextOp
    from app.domain.services.plan_progress import PlanProgress
    state = PlanProgress()
    state.batches = 3
    state.observe(ContextEvent(plan_check='corrected'))
    state.observe(ContextEvent(op=ContextOp.REPLACE, messages=[{'role':'user','content':'摘要'}]))
    assert state.corrected and state.batches == 3
    state.observe(ContextEvent(plan_check='scope',messages=[{'role':'user','content':'新范围'}]))
    assert not state.corrected and state.required == 'scope'


def test_new_run_uses_current_prompt_but_waiting_run_keeps_frozen_prompt():
    from app.domain.models.memory import Memory
    from app.domain.services.flows.agent_loop import AGENT_MEMORY_NAME
    from tests.support.loop_harness import assert_no_dangling
    async def check():
        h = make_loop([tool_call('message_ask_user', {'text':'请补充材料'})])
        h.session.memories[AGENT_MEMORY_NAME] = Memory(messages=[{'role':'system','content':'旧会话提示'}, {'role':'user','content':'历史内容'}, {'role':'assistant','content':'历史答复'}])
        h.loop._system_prompt = '当前版本提示'
        task = input_task(); active = await start_run(h, task, '新任务')
        await make_runner(h,run=active).invoke(task)
        frozen = h.runs[active.id].config_snapshot['system_prompt']
        assert frozen.startswith('当前版本提示') and '旧会话提示' not in frozen
        assert h.llm.requests[0].messages[0]['content'] == frozen
        restored = restore_session(h.session)
        second = make_loop([text('完成')],session=restored)
        second.loop._system_prompt = '又一次更新后的提示'
        task = input_task()
        resumed = await second.ledger.transition(restored.id,active.id,RunStatus.RUNNING,events_after=[MessageEvent(role='user',message='补充材料')])
        await submit(task,'补充材料')
        await make_runner(second,run=resumed,prior_status=SessionStatus.WAITING).invoke(task)
        assert second.llm.requests[0].messages[0]['content'] == frozen
        assert_no_dangling(second.llm.requests[0].messages)
    run(check())
