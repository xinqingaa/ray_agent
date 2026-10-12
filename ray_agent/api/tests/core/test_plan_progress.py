"""稳定阶段与范围协议，实际计划工具和循环。"""
import asyncio
from app.domain.models.event import ContextEvent, PlanEvent, ToolEvent
from app.domain.models.message import Message
from app.domain.models.plan import ExecutionStatus, Plan, Step
from app.domain.services.plan_progress import PlanProgress
from app.domain.services.tools.plan import PlanTool
from tests.support.loop_harness import make_loop, assert_no_dangling, memory_messages
from tests.support.scripted_llm import tool_call, text

def run(c):
    return asyncio.run(asyncio.wait_for(c, 5))

def test_stage_and_steps_identity_and_atomic_validation():

    async def check():
        t = PlanTool()
        r = await t.update_plan([{'step': '整体阶段', 'status': 'in_progress'}], goal='目标')
        stage = r.data['plan'][0]
        r2 = await t.update_plan([stage, {'step': '执行', 'status': 'in_progress', 'kind': 'step', 'parent_id': stage['id']}])
        assert r2.success and len(t.latest_plan.stages) == 1 and (len(t.latest_plan.steps) == 2)
        saved = t.latest_plan.model_copy(deep=True)
        assert not (await t.update_plan([{**stage, 'status': 'completed'}, r2.data['plan'][1]])).success
        assert not (await t.update_plan([stage, {'step': '坏引用', 'kind': 'step', 'parent_id': 'missing', 'status': 'pending'}])).success
        assert t.latest_plan == saved
    run(check())

def test_required_scope_cannot_disappear_or_defer_without_new_user_source():

    async def check():
        t = PlanTool()
        t.user_seqs = {2, 40}
        t.current_user_seq = 2
        r = await t.update_plan([{'step': '阶段', 'status': 'in_progress'}], goal='目标', artifacts=[{'name': '成果', 'delivery': 'file', 'path': '/out.md'}])
        node = r.data['plan'][0]
        a = r.data['artifacts'][0]
        assert not (await t.update_plan([{**node, 'schedule': 'future', 'status': 'pending'}], explanation='预算不足')).success
        assert not (await t.update_plan([node], artifacts=[])).success
        assert not (await t.update_plan([node], artifacts=[{'id': a['id'], 'name': '成果', 'path': '/out.md', 'delivery': 'file', 'state': 'delivered'}])).success
        assert not (await t.update_plan(action='not_needed')).success
        assert not (await t.update_plan([{'step': '替换', 'status': 'pending'}], explanation='删掉')).success
        t.current_user_seq = 40
        assert (await t.update_plan([{**node, 'schedule': 'future', 'status': 'pending'}], source_seq=40, explanation='用户安排下一轮')).success
        assert t.latest_plan.id == r.data['plan_id']
        assert not (await t.update_plan([node], source_seq=999)).success
    run(check())

def test_blocked_stays_current_and_later_is_not_a_lifecycle():

    async def check():
        t = PlanTool()
        assert not (await t.update_plan([{'step': '任务', 'status': 'blocked'}])).success
        assert (await t.update_plan([{'step': '任务', 'status': 'blocked', 'reason': '环境不可用'}])).success
        assert t.latest_plan.stages[0].open and (not t.latest_plan.done)
        assert not (await t.update_plan([{'step': '任务', 'status': 'later'}])).success
    run(check())

def test_many_business_batches_need_no_periodic_review_or_unconfirmed():

    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '工作', 'status': 'in_progress'}]}), *[tool_call('echo', {'text': str(i)}) for i in range(12)], text('未完成'), text('未完成')], max_iterations=100)
        events = [e async for e in h.loop.invoke(Message(message='执行'))]
        assert h.recording.calls == [f'echo:{i}' for i in range(12)]
        assert not any((isinstance(e, ToolEvent) and e.denied_by == 'batch' for e in events))
        assert not any((isinstance(e, PlanEvent) and e.progress_state == 'unconfirmed' for e in events))
        assert_no_dangling(memory_messages(h.session))
    run(check())

def test_adopted_plan_requires_stage_selection():
    p = PlanProgress()
    plan = Plan(steps=[Step(description='任务')])
    p.observe(PlanEvent(plan=plan, progress_state='preparing'))
    assert p.reason(plan) == 'adopted'
    plan.steps[0].status = ExecutionStatus.RUNNING
    p.observe(PlanEvent(plan=plan))
    assert p.reason(plan) is None
    for _ in range(12):
        p.observe(ContextEvent(messages=[]))
    assert p.reason(plan) is None


def test_first_update_can_create_stage_and_children_with_stable_ids():
    async def check():
        t = PlanTool()
        result = await t.update_plan(title='整理资料', description='汇总并交付资料。', goal='保留完整原始要求', plan=[
            {'id':'stage','step':'整体阶段','kind':'stage','status':'in_progress'},
            {'id':'child','step':'具体步骤','kind':'step','parent_id':'stage','status':'in_progress'},
        ], artifacts=[{'id':'artifact','name':'成果','delivery':'file','path':'/a'}])
        assert result.success
        assert t.latest_plan.steps[1].parent_id == 'stage'
        assert t.latest_plan.artifacts[0].id == 'artifact'
        renewed = await t.update_plan(result.data['plan'], explanation='状态更新')
        assert renewed.success and t.latest_plan.title == '整理资料'
        assert t.latest_plan.description == '汇总并交付资料。' and t.latest_plan.goal == '保留完整原始要求'
        duplicate = await t.update_plan(plan=[
            {'id':'stage','step':'整体阶段','status':'in_progress'},
            {'id':'stage','step':'重复阶段','status':'pending'},
        ])
        assert not duplicate.success
        assert len(t.latest_plan.steps) == 2
    asyncio.run(check())


def test_resume_stage_requires_plan_before_business_but_direct_answers_do_not():
    p = PlanProgress()
    plan = Plan(steps=[Step(description='后续', schedule='future')])
    assert p.blocks([{'function':{'name':'write_file'}}], plan)
    assert not p.blocks([], plan)
    assert not p.blocks([{'function':{'name':'update_plan'}}], plan)


def test_unregistered_checks_have_one_nonblocking_notice_and_restore_it():
    from app.domain.models.plan import Artifact
    from app.domain.models.event import ContextOp
    from app.domain.services.plan_progress import VERIFICATION_NOTICE_PREFIX
    p = PlanProgress()
    plan = Plan(artifacts=[Artifact(name='成果',path='/a')])
    p.observe(PlanEvent(plan=plan))
    for i in range(6):
        p.observe(ToolEvent(tool_call_id=str(i), tool_name='shell', function_name='shell_execute', function_args={}, status='called'))
    notice = p.verification_notice(plan)
    assert notice and notice.startswith(VERIFICATION_NOTICE_PREFIX)
    assert not p.blocks([{'function':{'name':'shell_execute'}}], plan)
    recorded = ContextEvent(op=ContextOp.APPEND, messages=[{'role':'user','content':notice}])
    p.observe(recorded)
    assert p.verification_notice(plan) is None
    restored = PlanProgress()
    restored.unrecorded_calls = 20
    restored.observe(recorded)
    assert restored.verification_notice(plan) is None


def test_user_arranged_future_file_can_have_unknown_path_until_activated():
    async def check():
        t=PlanTool();t.user_seqs={1,20};t.current_user_seq=1
        first=await t.update_plan([{'id':'stage','step':'后续','status':'pending','schedule':'future'}],
            artifacts=[{'id':'future','name':'后续文件','delivery':'file','schedule':'future'}])
        assert first.success
        t.current_user_seq=20
        assert not (await t.update_plan(first.data['plan'],artifacts=[{'id':'future','name':'后续文件','delivery':'file','schedule':'current'}])).success
        assert (await t.update_plan(first.data['plan'],artifacts=[{'id':'future','name':'后续文件','delivery':'file','schedule':'current','path':'/a.md'}])).success
    run(check())
