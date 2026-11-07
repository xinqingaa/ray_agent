"""成果版本、核验复用与收尾；保留实际循环及工具管线。"""
import asyncio, hashlib
from unittest.mock import AsyncMock
from app.domain.models.message import Message
from app.domain.models.event import DoneEvent, ToolEvent
from app.domain.models.plan import Artifact, Plan, Step
from app.domain.models.tool_result import ToolResult
from app.domain.services.task_outcomes import TaskOutcomes, ArtifactWriter
from app.domain.services.tools.plan import PlanTool
from app.domain.services.flows.tool_pipeline import ToolInvocation
from tests.support.loop_harness import make_loop, memory_messages, assert_no_dangling
from tests.support.scripted_llm import tool_call, text, Dynamic, ScriptedResponse, ScriptedToolCall

def run(c):
    return asyncio.run(asyncio.wait_for(c, 5))

def fixture():
    from tests.support.loop_harness import FileFixture
    return FileFixture()

def test_future_is_not_entire_goal_completed():

    async def check():
        t = PlanTool()
        r = await t.update_plan([{'step': '已完成', 'status': 'completed'}, {'step': '后续', 'status': 'pending', 'schedule': 'future'}])
        assert r.success and (not t.latest_plan.done) and t.latest_plan.stages[1].deferred
    run(check())

def test_missing_registered_files_force_partial_and_one_feedback():

    async def check():
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '制作', 'status': 'completed'}], 'artifacts': [{'name': '一', 'delivery': 'file', 'path': '/one.md'}, {'name': '二', 'delivery': 'file', 'path': '/two.md'}]}), text('完成'), text('部分成果')])
        events = [e async for e in h.loop.invoke(Message(message='制作'))]
        done = next((e for e in events if isinstance(e, DoneEvent)))
        assert done.outcome == 'partial' and done.missing == ['一', '二'] and (h.llm.call_count == 3)
    run(check())

def test_cache_requires_actual_version_conditions_and_explicit_pass():

    async def check():
        fx = fixture()
        a_path = fx.put('a', b'v1')
        t = PlanTool()
        t.latest_plan = Plan(artifacts=[Artifact(id='a', name='成果', path=a_path)])
        o = TaskOutcomes(t, fx.scope)
        meta = {'key': '核验', 'artifact_id': 'a', 'condition': '符合输入', 'purpose': 'verify'}
        inv = ToolInvocation('c1', 'shell_execute', '{}', verification=meta)
        assert await o.before(inv) is None
        await o.after(inv, ToolResult(data={'output': '{"passed":true}'}))
        assert t.latest_plan.verifications[0].state == 'passed'
        cached = await o.before(ToolInvocation('c2', 'shell_execute', '{}', verification=meta))
        assert cached.success and (not cached.data['executed'])
        fx.put('a', b'v2')
        inv = ToolInvocation('c3', 'shell_execute', '{}', verification=meta)
        assert await o.before(inv) is None
        await o.after(inv, ToolResult(data={'output': 'executed'}))
        assert t.latest_plan.verifications[0].state == 'executed'
        assert await o.before(ToolInvocation('c4', 'shell_execute', '{}', verification=meta)) is None
    run(check())

def test_two_failures_require_new_reason():

    async def check():
        fx = fixture()
        a_path = fx.put('a', b'x')
        t = PlanTool()
        t.latest_plan = Plan(artifacts=[Artifact(id='a', name='成果', path=a_path)])
        o = TaskOutcomes(t, fx.scope)
        meta = {'key': '问题', 'artifact_id': 'a', 'condition': '预期', 'purpose': 'verify'}
        for i in range(2):
            inv = ToolInvocation(str(i), 'read_file', '{}', verification=meta)
            assert await o.before(inv) is None
            await o.after(inv, ToolResult(data={'passed': False}))
        assert not (await o.before(ToolInvocation('3', 'read_file', '{}', verification=meta))).success
        assert await o.before(ToolInvocation('4', 'read_file', '{}', verification={**meta, 'repeat_reason': '换条件定位'})) is None
    run(check())

def test_finalizer_only_registered_text_and_never_overwrites():

    async def check():
        fx = fixture()
        a_md = fx.path('a.md')
        t = PlanTool()
        t.latest_plan = Plan(artifacts=[Artifact(id='a', name='正文', path=a_md)])
        o = TaskOutcomes(t, fx.scope)
        w = ArtifactWriter(o)
        assert not (await w.finalize_artifact('a', '内容')).success
        t.finalizing = True
        o.freeze('run:1')
        assert not (await w.finalize_artifact('unknown', '内容')).success
        assert (await w.finalize_artifact('a', '内容')).success
        assert not (await w.finalize_artifact('a', '改写')).success
        o.freeze('run:2')
        revised = await w.finalize_artifact('a', '改写')
        assert revised.success and revised.data['filepath'] != a_md
        assert open(revised.data['filepath'], 'rb').read() == '改写'.encode()
        assert fx.get('a.md') == '内容'.encode()
        o.freeze('run:3')
        before = sorted(p.name for p in fx.root.iterdir())

        async def unknown(raw):
            raise OSError('无法确认')
        fx.scope.exists = unknown
        assert not (await w.finalize_artifact('a', '内容')).success
        assert sorted(p.name for p in fx.root.iterdir()) == before
    run(check())

def test_verification_waits_for_process_exit_and_reads_json_content():
    assert TaskOutcomes.passed(ToolResult(data={'status':'running','output':'{"passed":true}'})) is None
    assert TaskOutcomes.passed(ToolResult(data={'status':'completed','returncode':1,'output':'{"passed":true}'})) is False
    assert TaskOutcomes.passed(ToolResult(data={'content':'{"passed":true}'})) is True
    assert TaskOutcomes.passed(ToolResult(data={'result':'{"passed":true}'})) is True

def test_budget_finalizer_and_delivery_use_actual_version():
    from app.domain.models.file import File

    async def check():
        fx = fixture()
        a_md = fx.path('a.md')

        async def deliver(p):
            return File(id='f1', filepath=p, filename='a.md')

        def finish(req):
            aid = h.loop.plan_tool.latest_plan.artifacts[0].id
            return ScriptedResponse(tool_calls=[ScriptedToolCall('finalize_artifact', {'artifact_id': aid, 'content': '最终正文'}), ScriptedToolCall('deliver_files', {'paths': [a_md]})])
        h = make_loop([tool_call('update_plan', {'plan': [{'step': '交付', 'status': 'completed'}], 'artifacts': [{'name': '正文', 'delivery': 'file', 'path': a_md}]}), *[tool_call('echo', {'text': str(i)}) for i in range(9)], Dynamic(finish), text('已交付')], max_iterations=12, files=fx, deliver_file=deliver)
        events = [e async for e in h.loop.invoke(Message(message='制作'))]
        a = h.loop.plan_tool.latest_plan.artifacts[0]
        assert a.state == 'delivered' and a.version == hashlib.sha256(fx.get('a.md')).hexdigest() == a.delivered_version
        assert any((isinstance(e, DoneEvent) and e.outcome == 'complete' for e in events))
        assert_no_dangling(memory_messages(h.session))
    run(check())

def test_finalizer_still_respects_policy():

    async def check():
        h = make_loop([tool_call('finalize_artifact', {'artifact_id': 'a', 'content': 'x'}), text('结束')], tool_policy={'finalize_artifact': 'deny'})
        events = [e async for e in h.loop.invoke(Message(message='任务'))]
        assert any((isinstance(e, ToolEvent) and e.denied_by == 'policy' for e in events)) and not h.files.files.wrote()
    run(check())


def test_pipeline_reuses_evidence_but_reexecutes_after_real_file_change():
    from app.domain.services.tools.base import BaseTool, tool
    from app.domain.models.file import File

    class CheckTool(BaseTool):
        name = 'shell'
        def __init__(self):
            super().__init__()
            self.calls = 0
        @tool('shell_execute', '受控核验', {'command': {'type': 'string'}}, ['command'])
        async def shell_execute(self, command):
            self.calls += 1
            return ToolResult(data={'output': '{"passed":true}'})

    async def check():
        fx = fixture()
        a_txt = fx.path('a.txt')
        checker = CheckTool()
        async def deliver(path):
            return File(id='verified-file', filepath=path, filename='a.txt')
        def verify(request):
            aid = h.loop.plan_tool.latest_plan.artifacts[0].id
            return ScriptedResponse(tool_calls=[ScriptedToolCall('shell_execute', {'command':'check', 'verification': {'key':'计算核验','artifact_id':aid,'condition':'固定输入结果','purpose':'verify'}})])
        def write_and_verify(request):
            response = verify(request)
            response.tool_calls.insert(0, ScriptedToolCall('write_file', {'filepath':a_txt,'content':'版本二'}))
            return response
        h = make_loop([
            tool_call('update_plan', {'goal':'交付正确成果','plan':[{'step':'交付','status':'completed'}], 'artifacts':[{'name':'结果','delivery':'file','path':a_txt}]}),
            tool_call('write_file', {'filepath':a_txt,'content':'版本一'}), Dynamic(verify), Dynamic(verify), Dynamic(write_and_verify),
            tool_call('deliver_files', {'paths':[a_txt]}), tool_call('deliver_files', {'paths':[a_txt]}), text('累计结果已交付'),
        ], max_iterations=20, files=fx, deliver_file=deliver, extra_tools=[checker])
        events = [e async for e in h.loop.invoke(Message(message='处理并交付'))]
        assert checker.calls == 2
        assert any(isinstance(e, ToolEvent) and e.denied_by == 'verification_cache' for e in events)
        notices = [e for e in events if e.type == 'message' and e.attachments]
        assert len(notices) == 1, '同版重复交付不新增附件通知'
        a = h.loop.plan_tool.latest_plan.artifacts[0]
        assert a.version == a.delivered_version == hashlib.sha256(fx.get('a.txt')).hexdigest()
        assert_no_dangling(memory_messages(h.session))
    run(check())


def test_unrelated_direct_answer_does_not_reopen_old_missing_work():
    async def check():
        h = make_loop([text('中位数是排序后居中的数。')])
        h.loop.plan_tool.latest_plan = Plan(goal='旧目标', steps=[Step(description='旧工作')], artifacts=[Artifact(id='old',name='旧文件',path='/old.md')])
        events = [e async for e in h.loop.invoke(Message(message='一句话解释中位数'))]
        assert h.llm.call_count == 1
        assert any(isinstance(e, DoneEvent) and e.outcome == 'complete' for e in events)
        assert not any(str(m.get('content','')).startswith('结束前一致性') for m in memory_messages(h.session))
    run(check())


def test_internal_runtime_messages_are_not_reinjected_user_requirements():
    from app.domain.services.context.compaction import user_origins
    messages = [{'role':'user','content':prefix+'内部信息'} for prefix in ['[任务状态]','[运行预算]','[计划核对]','结束前一致性核对：']]
    messages.append({'role':'user','content':'用户原始要求'})
    assert [o.content for o in user_origins(messages)] == ['用户原始要求']


def test_finalizer_plan_mode_denial_precedes_policy_and_never_writes():
    from app.domain.models.run import RunMode
    async def check():
        h = make_loop([tool_call('finalize_artifact',{'artifact_id':'a','content':'正文'}),text('方案')], tool_policy={'finalize_artifact':'ask'})
        h.loop.mode = RunMode.PLAN
        events = [e async for e in h.loop.invoke(Message(message='先规划'))]
        assert any(isinstance(e,ToolEvent) and e.denied_by == 'plan_mode' for e in events)
        assert not h.files.files.wrote()
        assert not any(e.type == 'approval' for e in events)
    run(check())


def test_published_reply_tracks_actual_body_without_claiming_semantic_validation():
    async def check():
        h = make_loop([
            tool_call('update_plan', {'plan':[{'step':'整理正文','status':'completed'}], 'artifacts':[{'name':'完整正文','delivery':'reply'}]}),
            text('完整正文包含当天安排及完成条件。'),
        ])
        events = [e async for e in h.loop.invoke(Message(message='直接回复完整方案'))]
        a = h.loop.plan_tool.latest_plan.artifacts[0]
        assert a.state == 'delivered'
        assert a.version == a.delivered_version == hashlib.sha256('完整正文包含当天安排及完成条件。'.encode()).hexdigest()
        assert not h.loop.plan_tool.latest_plan.verifications
        assert any(isinstance(e, DoneEvent) and e.outcome == 'complete' for e in events)
    run(check())


def test_finalizer_revises_existing_artifact_at_reserved_path_and_delivers_new_version():
    from app.domain.models.file import File
    async def check():
        fx = fixture()
        a_md = fx.path('a.md')
        deliveries = []
        async def deliver(path):
            deliveries.append(path)
            return File(id='f'+str(len(deliveries)),filepath=path,filename=path.rsplit('/',1)[-1])
        def finish(request):
            a = h.loop.plan_tool.latest_plan.artifacts[0]
            return ScriptedResponse(tool_calls=[
                ScriptedToolCall('finalize_artifact',{'artifact_id':a.id,'content':'完整修订版'}),
                ScriptedToolCall('deliver_files',{'paths':[a.final_path]}),
            ])
        h = make_loop([
            tool_call('update_plan',{'plan':[{'step':'交付','status':'completed'}],'artifacts':[{'name':'说明','path':a_md,'delivery':'file'}]}),
            tool_call('write_file',{'filepath':a_md,'content':'初版'}),
            tool_call('deliver_files',{'paths':[a_md]}),
            *[tool_call('echo',{'text':str(i)}) for i in range(7)], Dynamic(finish),text('初版与修订版均已交付'),
        ],max_iterations=12,files=fx,deliver_file=deliver)
        events=[e async for e in h.loop.invoke(Message(message='交付说明'))]
        a=h.loop.plan_tool.latest_plan.artifacts[0]
        assert deliveries == [a_md,a.final_path]
        assert fx.get('a.md') == '初版'.encode()
        assert open(a.path,'rb').read() == '完整修订版'.encode()
        assert a.path == a.final_path and a.version == a.delivered_version
        assert any(isinstance(e,DoneEvent) and e.outcome=='complete' for e in events)
    run(check())


def test_unrelated_business_task_explicitly_detaches_old_missing_goal_in_same_batch():
    from app.domain.models.event import MessageEvent, PlanEvent
    from tests.support.loop_harness import input_task, start_run, make_runner
    async def check():
        h=make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('update_plan',{'action':'not_needed','goal':'新任务','explanation':'当前用户要求是新的独立工作'}),
            ScriptedToolCall('echo',{'text':'新结果'}),
        ]),text('新结果完成')])
        old=Plan(goal='旧目标',source_seq=1,steps=[Step(description='旧工作')],artifacts=[Artifact(name='旧成果',path='/old')])
        await h.ledger.append(h.session.id,[MessageEvent(role='user',message='旧任务'),PlanEvent(plan=old)])
        task=input_task()
        active=await start_run(h,task,'做新的独立工作')
        await make_runner(h,run=active).invoke(task)
        assert h.llm.call_count==2 and h.recording.calls==['echo:新结果']
        assert any(isinstance(e,DoneEvent) and e.outcome=='complete' for e in h.events)
        assert not any(isinstance(e,ToolEvent) and e.denied_by=='batch' for e in h.events)
        assert h.loop.plan_tool.latest_plan.artifacts[0].state=='pending'
    run(check())


def test_explicit_failed_check_prevents_complete_claim_even_after_all_files_delivered():
    from app.domain.services.tools.base import BaseTool, tool
    from app.domain.models.file import File
    class Checker(BaseTool):
        name='shell'
        @tool('shell_execute','实际断言',{'command':{'type':'string'}},['command'])
        async def shell_execute(self,command):
            return ToolResult(data={'passed':False})
    async def check():
        fx=fixture();a_txt=fx.path('a.txt')
        async def deliver(path):return File(id='f',filename='a.txt',filepath=path)
        def verify(request):
            a=h.loop.plan_tool.latest_plan.artifacts[0]
            return ScriptedResponse(tool_calls=[
                ScriptedToolCall('shell_execute',{'command':'check','verification':{'key':'condition','artifact_id':a.id,'condition':'符合固定输入要求','purpose':'verify'}}),
                ScriptedToolCall('deliver_files',{'paths':[a_txt]}),
            ])
        h=make_loop([
            tool_call('update_plan',{'plan':[{'step':'交付','status':'completed'}],'artifacts':[{'name':'文件','path':a_txt,'delivery':'file'}]}),
            tool_call('write_file',{'filepath':a_txt,'content':'实际内容'}),Dynamic(verify),text('全部完成'),text('文件已交付但核验未通过'),
        ],files=fx,deliver_file=deliver,extra_tools=[Checker()])
        events=[e async for e in h.loop.invoke(Message(message='核验并交付'))]
        done=next(e for e in events if isinstance(e,DoneEvent))
        assert done.outcome=='partial' and done.missing==['核验未通过：符合固定输入要求']
        assert h.loop.plan_tool.latest_plan.artifacts[0].state=='delivered'
        assert h.llm.call_count==5
    run(check())


def test_real_repair_after_two_failures_allows_necessary_new_version_recheck():
    async def check():
        fx=fixture();a_path=fx.put('a',b'v1')
        t=PlanTool();t.latest_plan=Plan(artifacts=[Artifact(id='a',name='成果',path=a_path)])
        outcomes=TaskOutcomes(t,fx.scope)
        meta={'key':'问题','artifact_id':'a','condition':'预期结果','purpose':'verify'}
        for i in range(2):
            inv=ToolInvocation(str(i),'shell_execute','{}',verification={**meta})
            assert await outcomes.before(inv) is None
            await outcomes.after(inv,ToolResult(data={'passed':False}))
        repair=ToolInvocation('repair','shell_execute','{}',verification={**meta,'purpose':'repair','repeat_reason':'定位并修复原因'})
        assert await outcomes.before(repair) is None
        fx.put('a',b'v2')
        await outcomes.after(repair,ToolResult())
        assert await outcomes.before(ToolInvocation('recheck','shell_execute','{}',verification={**meta})) is None
    run(check())


def test_unknown_final_write_can_be_read_back_and_delivered_without_overwrite():
    from app.domain.models.file import File
    from app.domain.services.tools.deliver import DeliveryItem, DeliveryResult
    async def check():
        fx=fixture(); a_md=fx.put('a.md',b'old')
        t=PlanTool();t.latest_plan=Plan(artifacts=[Artifact(id='a',name='正文',path=a_md)]);t.finalizing=True
        o=TaskOutcomes(t,fx.scope);o.freeze('run:1');a=t.latest_plan.artifacts[0]
        real_write=fx.scope.write_bytes
        writes=[]
        async def uncertain(path,data,expected):
            writes.append(path)
            await real_write(path,data,expected)
            raise TimeoutError('写入响应丢失')
        fx.scope.write_bytes=uncertain
        try: await ArtifactWriter(o).finalize_artifact('a','完整正文')
        except TimeoutError: pass
        assert a.final_attempts==1 and a.path==a_md and o.context()['artifacts'][0]['final_path']==a.final_path
        assert open(a.final_path,'rb').read()=='完整正文'.encode()
        inv=ToolInvocation('deliver','deliver_files','{}')
        result=ToolResult(data=DeliveryResult(items=[DeliveryItem(path=a.final_path,success=True,file=File(id='f',filename='a-final.md',filepath=a.final_path))]))
        await o.after(inv,result)
        assert a.state=='delivered' and a.path==a.final_path and a.version==a.delivered_version
        assert fx.get('a.md')==b'old' and len(writes)==1
    run(check())
