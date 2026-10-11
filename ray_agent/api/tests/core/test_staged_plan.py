"""阶段写进计划清单：later 状态校验与身份复用、旧数据兼容、跨运行延续、结束反馈恰好一次且附清单；模型与存储使用替身。"""
import asyncio

from pydantic import TypeAdapter

from app.domain.models.event import ContextEvent, Event, MessageEvent, PlanEvent
from app.domain.models.message import Message
from app.domain.models.plan import ExecutionStatus, Plan, Step
from app.domain.models.run import RunMode, RunStatus
from app.domain.services.plan_progress import COMPLETION_FEEDBACK_PREFIX, INTERNAL_CHECK_NOTE, PLAN_PROGRESS_PREFIX, PlanProgress
from app.domain.services.tools.plan import PlanTool
from app.interfaces.schemas.event import EventMapper
from tests.support.loop_harness import assert_no_dangling, input_task, make_loop, make_runner, memory_messages, start_run
from tests.support.scripted_llm import Dynamic, ScriptedResponse, ScriptedToolCall, text, tool_call


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 5))


STAGED = [{'step': '阶段一的子步骤', 'status': 'completed'}, {'step': '阶段二', 'status': 'later'}, {'step': '阶段三', 'status': 'later'}]
DONE = [{'step': '执行', 'status': 'completed'}]


async def collect(h, message='用户消息'):
    return [e async for e in h.loop.invoke(Message(message=message))]


def feedbacks(h):
    return [m['content'] for m in memory_messages(h.session)
            if m.get('role') == 'user' and str(m.get('content')).startswith(COMPLETION_FEEDBACK_PREFIX)]


def notices(h):
    return [m['content'] for m in memory_messages(h.session)
            if m.get('role') == 'user' and str(m.get('content')).startswith(PLAN_PROGRESS_PREFIX)]


# ---- later 状态：校验、身份、旧数据 ----

def test_later_status_validation_identity_and_not_completed():
    async def check():
        tool = PlanTool()
        first = await tool.update_plan(STAGED)
        assert first.success and '后续阶段 2 项' in first.message
        assert [s['status'] for s in first.data['plan']] == ['completed', 'later', 'later']
        assert tool.latest_plan.status == ExecutionStatus.RUNNING, '仍有后续阶段，不算整个计划完成'
        assert not (await tool.update_plan([{'step': 'x', 'status': 'deferred'}])).success
        ids = [s['id'] for s in first.data['plan']]
        # 下一阶段展开：复用 id，later → in_progress；其余仍为 later；两个 in_progress 仍被拒绝
        step = lambda i, status: {'id': ids[i], 'step': ['阶段一的子步骤', '阶段二', '阶段三'][i], 'status': status}
        assert not (await tool.update_plan([step(0, 'completed'), step(1, 'in_progress'), step(2, 'in_progress')])).success
        expanded = await tool.update_plan([step(0, 'completed'), step(1, 'in_progress'), step(2, 'later'),
                                           {'step': '阶段二的新子步骤', 'status': 'pending'}])
        assert expanded.success and [s['id'] for s in expanded.data['plan']][:3] == ids
        assert [s['status'] for s in expanded.data['plan']] == ['completed', 'in_progress', 'later', 'pending']
        assert expanded.data['plan_id'] == first.data['plan_id'], '延续同一计划'
        assert not (await tool.update_plan([{'id': 'unknown', 'step': 'x', 'status': 'later'}])).success
        finished = await tool.update_plan([step(0, 'completed'), step(1, 'completed'), step(2, 'completed')])
        assert tool.latest_plan.status == ExecutionStatus.COMPLETED and '后续阶段' not in finished.message
        schema = next(t for t in tool.get_tools() if t['function']['name'] == 'update_plan')['function']['parameters']
        assert schema['properties']['plan']['items']['properties']['status']['enum'] == ['pending', 'in_progress', 'completed', 'later']
    run(check())


def test_legacy_plan_events_without_later_read_and_map_unchanged():
    legacy = {'type': 'plan', 'plan': {'id': 'p', 'steps': [
        {'id': 's1', 'description': '旧步骤', 'status': 'completed'}, {'id': 's2', 'description': '旧待办', 'status': 'pending'}]},
        'status': 'updated'}
    event = TypeAdapter(Event).validate_python(legacy)
    assert [(s.open, s.deferred, s.done) for s in event.plan.steps] == [(False, False, True), (True, False, False)]
    assert [s.status for s in EventMapper.event_to_sse_event(event).data.steps] == ['completed', 'pending']
    event.plan.steps[1].status = ExecutionStatus.LATER
    restored = TypeAdapter(Event).validate_json(event.model_dump_json())
    assert [s.status for s in EventMapper.event_to_sse_event(restored).data.steps] == ['completed', 'later']
    assert restored.plan.steps[1].deferred and not restored.plan.steps[1].open and not restored.plan.steps[1].done


# ---- 跨运行延续 ----

def staged_plan(*statuses):
    return Plan(steps=[Step(description=f's{i}', status=status) for i, status in enumerate(statuses)])


def test_staged_plan_continues_instead_of_asking_for_reset():
    progress = PlanProgress()
    done_later = staged_plan(ExecutionStatus.COMPLETED, ExecutionStatus.LATER)
    assert progress.reason(done_later) == 'staged'
    notice = progress.notice(done_later)
    assert '不要 reset' in notice and '后续阶段' in notice and '上一份计划已结束' not in notice
    assert progress.blocks([{'function': {'name': 'shell_exec'}}], done_later)
    assert not progress.blocks([{'function': {'name': 'read_file'}}], done_later)
    # 全部完成且没有后续阶段：沿用原有“已结束”提示；仍有待办：不提示
    assert progress.reason(staged_plan(ExecutionStatus.COMPLETED)) == 'closed'
    assert '上一份计划已结束' in progress.notice(staged_plan(ExecutionStatus.COMPLETED))
    assert progress.reason(staged_plan(ExecutionStatus.PENDING, ExecutionStatus.LATER)) is None
    # 本次运行已更新计划后不再提示
    progress.observe(PlanEvent(plan=done_later))
    assert progress.reason(done_later) is None


def test_second_run_gets_continue_notice_and_expands_next_stage_without_reset():
    async def check():
        def expand(request):
            plan = h.loop.plan_tool.latest_plan
            ids = [s.id for s in plan.steps]
            return ScriptedResponse(tool_calls=[ScriptedToolCall('update_plan', {'plan': [
                {'id': ids[0], 'step': 'a', 'status': 'completed'}, {'id': ids[1], 'step': 'b', 'status': 'completed'},
                {'id': ids[2], 'step': 'c', 'status': 'later'}]})])
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('阶段一结束'), text('已说明阶段位置'),
                       Dynamic(expand), text('阶段二结束'), text('汇报阶段位置')])
        first_task = input_task()
        first = await start_run(h, first_task, '大任务')
        await make_runner(h, run=first).invoke(first_task)
        assert h.runs[first.id].status == RunStatus.COMPLETED and len(feedbacks(h)) == 1
        second_task = input_task()
        second = await start_run(h, second_task, '继续')
        await make_runner(h, run=second).invoke(second_task)
        [notice] = notices(h)
        assert '不要 reset' in notice and '上一份计划已结束' not in notice
        plan = h.loop.plan_tool.latest_plan
        assert [s.status.value for s in plan.steps] == ['completed', 'completed', 'later'] and len(feedbacks(h)) == 2
        assert h.llm.remaining == 0
    run(check())


# ---- 结束反馈 ----

def test_staged_feedback_exactly_once_with_checklist_and_never_loops():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('阶段一完成'), text('说明阶段位置后结束'), text('不应被请求')])
        events = await collect(h)
        assert h.llm.call_count == 3 and h.llm.remaining == 1
        [feedback] = feedbacks(h)
        assert '后续阶段' in feedback and '用户现在能用什么' in feedback and '阶段二' in feedback and 'later' in feedback
        assert '草稿尚未作为最终答复交给用户' in feedback and '保留用户需要的正文' in feedback
        assert '未完成条目' not in feedback and INTERNAL_CHECK_NOTE in feedback and '不要提及或复述核对本身' in feedback
        assert [e.message for e in events if isinstance(e, MessageEvent)] == ['说明阶段位置后结束']
        assert_no_dangling(memory_messages(h.session))
    run(check())


def test_model_ignoring_staged_feedback_still_ends_without_second_feedback_or_tail_note():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('直接结束'), text('仍然直接结束')])
        events = await collect(h)
        assert len(feedbacks(h)) == 1 and h.llm.call_count == 3
        final = [e.message for e in events if isinstance(e, MessageEvent)][-1]
        assert final == '仍然直接结束', 'later 条目不触发“执行记录仍有未完成项”补述'
    run(check())


def test_staged_feedback_merges_with_open_steps_in_single_message():
    async def check():
        steps = [{'step': '已做', 'status': 'completed'}, {'step': '进行中', 'status': 'in_progress'}, {'step': '后面', 'status': 'later'}]
        h = make_loop([tool_call('update_plan', {'plan': steps}), text('结束'), text('再次结束')])
        events = await collect(h)
        [feedback] = feedbacks(h)
        assert '当前计划还有未完成条目' in feedback and '后续阶段' in feedback and h.llm.call_count == 3
        assert '改标 later' in feedback and feedback.count(INTERNAL_CHECK_NOTE) == 1, '合并为一条且只带一次内部核对说明'
        assert '执行记录仍有未完成项' in [e.message for e in events if isinstance(e, MessageEvent)][-1], '仍有待办时保留原补述'
    run(check())


def test_no_staged_feedback_without_later_plan_not_needed_plan_mode_or_budget():
    async def check():
        for responses in ([tool_call('update_plan', {'plan': DONE}), text('结束')],
                          [text('直接回答')],
                          [tool_call('update_plan', {'action': 'not_needed'}), text('结束')]):
            h = make_loop(list(responses))
            await collect(h)
            assert feedbacks(h) == [] and h.llm.call_count == len(responses)
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('计划说明')])
        h.loop.mode = RunMode.PLAN
        await collect(h)
        assert feedbacks(h) == [] and h.llm.call_count == 2
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('最后答复')], max_iterations=2)
        events = await collect(h)
        assert feedbacks(h) == [] and h.llm.call_count == 2
        assert [e.message for e in events if isinstance(e, MessageEvent)] == ['最后答复'], '预算耗尽时保留已有答复'
    run(check())


def test_plan_only_restored_from_history_does_not_trigger_feedback():
    async def check():
        h = make_loop([text('只回答问题')])
        h.loop.plan_tool.latest_plan = staged_plan(ExecutionStatus.COMPLETED, ExecutionStatus.LATER)
        await collect(h)
        assert feedbacks(h) == [] and h.llm.call_count == 1, '本次运行没有建立或更新计划'
    run(check())


def test_feedback_sent_is_restored_from_run_events_so_resume_gets_no_second_chance():
    progress = PlanProgress()
    plan = staged_plan(ExecutionStatus.COMPLETED, ExecutionStatus.LATER)
    progress.observe(PlanEvent(plan=plan, progress_state='preparing'))
    progress.observe(PlanEvent(plan=plan, review_only=True))
    assert not progress.plan_updated
    progress.observe(PlanEvent(plan=plan))
    assert progress.plan_updated and not progress.feedback_sent
    progress.observe(ContextEvent(messages=[{'role': 'user', 'content': COMPLETION_FEEDBACK_PREFIX + '内容'}]))
    assert progress.feedback_sent


def test_every_feedback_kind_carries_internal_check_note_and_open_items_offer_later_exit():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '进行中', 'status': 'in_progress'}]}), text('结束'), text('再次结束')])
        await collect(h)
        [feedback] = feedbacks(h)
        assert '改标 later' in feedback and feedback.endswith(INTERNAL_CHECK_NOTE) and '用户' in INTERNAL_CHECK_NOTE
        h = make_loop([text('文件已写好'), text('补交说明')])
        await collect(h, '请生成一个文件并交付给我')
        [feedback] = feedbacks(h)
        assert '文件交付尚未完整成功' in feedback and feedback.endswith(INTERNAL_CHECK_NOTE)
    run(check())


LATER_ONLY = [{'step': '阶段一', 'status': 'later'}, {'step': '阶段二', 'status': 'later'}, {'step': '阶段三', 'status': 'later'}]


def test_later_removal_requires_explanation_and_id_errors_list_valid_ids():
    async def check():
        tool = PlanTool()
        first = await tool.update_plan([{'step': '自身动作', 'status': 'in_progress'}, *LATER_ONLY])
        ids = [s['id'] for s in first.data['plan']]
        snapshot = tool.latest_plan.model_copy(deep=True)
        # 用自身动作替换整张清单：既有 later 被丢弃，拒绝且不改变已有清单
        replaced = await tool.update_plan([{'id': ids[0], 'step': '自身动作', 'status': 'completed'}, {'step': '交付', 'status': 'in_progress'}])
        assert not replaced.success and ids[1] in replaced.message and 'explanation' in replaced.message
        assert tool.latest_plan == snapshot
        # 只丢一项同样拒绝；保留（含改状态）通过；reset 表示新任务可以不带旧 later
        assert not (await tool.update_plan([{'id': i, 'step': 'x', 'status': 'later'} for i in ids[:3]])).success
        kept = await tool.update_plan([{'id': ids[0], 'step': '自身动作', 'status': 'completed'},
                                       {'id': ids[1], 'step': '阶段一', 'status': 'in_progress'},
                                       {'id': ids[2], 'step': '阶段二', 'status': 'later'}, {'id': ids[3], 'step': '阶段三', 'status': 'later'}])
        assert kept.success
        assert (await tool.update_plan([{'step': '无关的新任务', 'status': 'in_progress'}], reset=True)).success
        # id 写错：报错给出出错的 id 与当前有效 id，便于逐字复制
        tool = PlanTool()
        made = await tool.update_plan(LATER_ONLY)
        real = made.data['plan'][1]['id']
        wrong = real[:-3] + 'xyz'
        bad = await tool.update_plan([{'id': wrong, 'step': '阶段二', 'status': 'later'}])
        assert not bad.success and repr(wrong) in bad.message and real in bad.message and '阶段一' in bad.message
        review = await tool.update_plan(action='review', step_id=wrong)
        assert not review.success and '当前没有进行中的步骤' in review.message
    run(check())


def test_user_scope_reduction_and_stage_split_keep_plan_identity():
    async def check():
        tool = PlanTool()
        first = await tool.update_plan(STAGED)
        kept = first.data['plan'][:2]
        snapshot = tool.latest_plan.model_copy(deep=True)
        for explanation in (None, '', '   '):
            assert not (await tool.update_plan(kept, explanation=explanation)).success
            assert tool.latest_plan == snapshot
        reduced = await tool.update_plan(kept, explanation='用户取消阶段三，继续原任务')
        assert reduced.success and reduced.data['plan_id'] == first.data['plan_id']
        assert reduced.data['plan'] == kept
        expanded = await tool.update_plan([kept[0], {'step': '阶段二第一部分', 'status': 'in_progress'},
                                           {'step': '阶段二第二部分', 'status': 'pending'}],
                                          explanation='将阶段二拆为两个本轮执行步骤')
        assert expanded.success and expanded.data['plan_id'] == first.data['plan_id']
        assert expanded.data['plan'][0] == kept[0]
        assert tool.latest_plan.message == '将阶段二拆为两个本轮执行步骤'
    run(check())


def test_later_only_turn_triggers_neither_staged_feedback_nor_three_batch_check():
    async def check():
        h = make_loop([tool_call('update_plan', {'plan': LATER_ONLY}), *[tool_call('echo', {'text': str(i)}) for i in range(4)],
                       text('方案如下')], max_iterations=100)
        events = await collect(h)
        assert feedbacks(h) == [] and notices(h) == [], '全部是 later 时没有 open 步骤，不触发三批核对，答复本身就是方案'
        assert h.llm.remaining == 0 and [e.message for e in events if isinstance(e, MessageEvent)] == ['方案如下']
    run(check())


def test_staged_feedback_requires_a_step_completed_in_this_run():
    async def check():
        # 本次运行有步骤标为 completed：触发
        h = make_loop([tool_call('update_plan', {'plan': STAGED}), text('阶段一完成'), text('说明阶段位置')])
        await collect(h)
        assert len(feedbacks(h)) == 1
        # 后续运行延续同一计划但没有新完成的步骤：不触发；有新完成的步骤：再次触发
        def keep(request):
            plan = h2.loop.plan_tool.latest_plan
            return ScriptedResponse(tool_calls=[ScriptedToolCall('update_plan', {'plan': [
                {'id': s.id, 'step': s.description, 'status': s.status.value if s.status != ExecutionStatus.RUNNING else 'in_progress'}
                for s in plan.steps]})])
        def finish(request):
            plan = h2.loop.plan_tool.latest_plan
            return ScriptedResponse(tool_calls=[ScriptedToolCall('update_plan', {'plan': [
                {'id': plan.steps[0].id, 'step': 'a', 'status': 'completed'}, {'id': plan.steps[1].id, 'step': 'b', 'status': 'completed'},
                {'id': plan.steps[2].id, 'step': 'c', 'status': 'later'}]})])
        h2 = make_loop([tool_call('update_plan', {'plan': STAGED}), text('阶段一结束'), text('已说明'),
                        Dynamic(keep), text('只确认了清单'),
                        Dynamic(finish), text('阶段二结束'), text('已说明阶段位置')])
        for message in ('大任务', '看看清单'):
            task = input_task()
            started = await start_run(h2, task, message)
            await make_runner(h2, run=started).invoke(task)
            assert h2.llm.remaining == (3 if message == '看看清单' else 5)
        assert len(feedbacks(h2)) == 1, '第二次运行没有新完成的步骤，不再提醒'
        task = input_task()
        started = await start_run(h2, task, '继续')
        await make_runner(h2, run=started).invoke(task)
        assert len(feedbacks(h2)) == 2 and h2.llm.remaining == 0
    run(check())
