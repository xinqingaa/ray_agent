"""视觉、资源准备、独立读取的受控契约；不调用真实模型或业务数据库。"""
import asyncio
import base64
import hashlib
import io
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import UploadFile

from app.application.services.lazy_resources import LazySandbox
from app.application.services.visual_artifacts import expire_visual_artifacts
from app.domain.models.app_config import LLMConfig, ToolPolicyConfig
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.tool_result import ToolResult
from app.domain.services.context.budget import estimate_message
from app.domain.services.context.compaction import user_origins
from app.domain.services.context.vision import image_refs, reconcile_visual_history
from app.domain.services.tools.browser import BrowserTool
from app.domain.services.tools.web import WebTool
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from tests.support.loop_harness import make_loop, make_runner, assert_no_dangling
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 10))


def ref(number=1):
    return dict(file_id=f'image-{number}', session_id='s', run_id='r', tool_call_id=f'c{number}',
                sha256=hashlib.sha256(b'pixels').hexdigest(), mime_type='image/png', width=900, height=700,
                token_estimate=1024, purpose=f'读取图中标记{number}', temporary=True, expires_at=9999999999)


def test_lazy_resources_zero_use_one_creation_and_failure_not_retried():
    async def scenario():
        resource = SimpleNamespace(id='box', read_file=AsyncMock(return_value=ToolResult()))
        factory = AsyncMock(return_value=resource)
        lazy = LazySandbox(factory)
        await lazy.get_browser()
        await lazy._browser.cleanup()
        assert not await lazy.destroy()
        factory.assert_not_awaited()
        await asyncio.gather(*(lazy.read_file('/x') for _ in range(3)))
        factory.assert_awaited_once()
        assert resource.read_file.await_count == 3
        broken = LazySandbox(AsyncMock(side_effect=ValueError('controlled failure')))
        with pytest.raises(ValueError):
            await broken.read_file('/x')
        with pytest.raises(RuntimeError, match='未自动重试'):
            await broken.read_file('/x')
        assert broken._factory.await_count == 1
    run(scenario())


def test_parallel_reads_overlap_but_results_and_context_remain_paired():
    async def scenario():
        active = 0
        peak = 0
        gate = asyncio.Event()
        async def fetch(url):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 3:
                gate.set()
            await gate.wait()
            active -= 1
            return ToolResult(data={'content': url})
        sandbox = SimpleNamespace(fetch_webpage=fetch)
        calls = [ScriptedToolCall('web_fetch', {'url': f'https://example.org/{i}'}, id=f'c{i}') for i in range(4)]
        h = make_loop([ScriptedResponse(tool_calls=calls), text('done')], extra_tools=[WebTool(sandbox)])
        events = [e async for e in h.loop.invoke(Message(message='read'))]
        assert peak == 3
        assert_no_dangling(h.llm.requests[-1].messages)
        assert [e.tool_call_id for e in events if e.type == 'tool' and e.status == 'called'] == ['c0','c1','c2','c3']
    run(scenario())


def test_parallel_read_stop_cancels_all_inflight_and_policy_denial_does_not_start():
    async def scenario():
        started = asyncio.Event()
        active = 0
        settled = 0
        async def fetch(url):
            nonlocal active, settled
            active += 1
            if active == 3:
                started.set()
            try:
                await asyncio.Event().wait()
            finally:
                settled += 1
        calls = [ScriptedToolCall('web_fetch', {'url': f'https://example.org/{i}'}, id=f'c{i}') for i in range(3)]
        h = make_loop([ScriptedResponse(tool_calls=calls)], extra_tools=[WebTool(SimpleNamespace(fetch_webpage=fetch))])
        async def consume():
            return [e async for e in h.loop.invoke(Message(message='read'))]
        task = asyncio.create_task(consume())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert settled == 3
        denied = AsyncMock()
        h = make_loop([ScriptedResponse(tool_calls=calls), text('denied')],
            extra_tools=[WebTool(SimpleNamespace(fetch_webpage=denied))],
            tool_policy={'web:*':'deny'})
        _ = [e async for e in h.loop.invoke(Message(message='read'))]
        denied.assert_not_awaited()
        assert_no_dangling(h.llm.requests[-1].messages)
    run(scenario())


def test_observation_failure_stops_write_batch_without_relabeling_action():
    async def scenario():
        browser = SimpleNamespace(click=AsyncMock(return_value=ToolResult(data={
            'action_success':True, 'observation_status':'failed'})), input=AsyncMock())
        h = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('browser_click',{'index':0,'observe':'text'},id='click'),
            ScriptedToolCall('browser_input',{'index':1,'text':'unsafe'},id='input')]), text('补观察')],
            extra_tools=[BrowserTool(browser)])
        events = [e async for e in h.loop.invoke(Message(message='form'))]
        browser.input.assert_not_awaited()
        called = [e for e in events if e.type=='tool' and e.status=='called']
        assert called[0].function_result.success and called[1].denied_by=='batch'
    run(scenario())


def test_images_are_real_multimodal_bytes_without_mutating_persisted_reference():
    async def scenario():
        llm = OpenAILLM(LLMConfig(base_url='https://api.deepseek.com', api_key='fixture', model_name='deepseek-flash'))
        llm.image_loader = AsyncMock(return_value=b'pixels')
        canonical = [{'role':'user','_ray_visual':['image-1'],'content':[{'type':'image_ref','image_ref':ref()}]}]
        sent = await llm._materialize_images(canonical)
        assert sent[0]['content'][0]['type']=='image_url'
        assert base64.b64decode(sent[0]['content'][0]['image_url']['url'].split(',')[1])==b'pixels'
        assert '_ray_visual' not in sent[0]
        assert canonical[0]['content'][0]['type']=='image_ref'
        llm.supports_vision = False
        from app.domain.external.llm import LLMRequestError
        with pytest.raises(LLMRequestError):
            await llm._materialize_images(canonical)
        await llm._client.close()
    run(scenario())


def test_visual_history_budget_nonvisual_downgrade_and_user_origin():
    messages = [{'role':'system','content':'system'}]
    for i in range(3):
        messages += [{'role':'assistant','content':'', 'tool_calls':[{'id':f'c{i}','function':{'name':'browser_screenshot'}}]},
                     {'role':'tool','tool_call_id':f'c{i}','function_name':'browser_screenshot',
                      'content':json.dumps({'data':{'image_input':ref(i)}})}]
        messages = reconcile_visual_history(messages, True)
    assert len(list(image_refs(messages)))==2
    assert estimate_message(messages[-1]) >= 1024
    assert not user_origins(messages)
    downgraded = reconcile_visual_history(messages, False)
    assert not list(image_refs(downgraded))
    assert '当前模型不支持视觉输入' in json.dumps(downgraded, ensure_ascii=False)
    assert reconcile_visual_history(downgraded, False)==downgraded


def test_screenshot_pixels_follow_complete_tool_batch_and_no_duplicate_delivery():
    async def scenario():
        capture = AsyncMock(return_value=ToolResult(data={'image_input':ref(), 'visual_input':True}))
        h = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('browser_screenshot', {'purpose':'read image','analyze':True,'deliver':False}, id='image'),
            ScriptedToolCall('echo', {'text':'last result'},id='echo')]), text('看到了标记')],
            extra_tools=[BrowserTool(None,capture)])
        h.llm.supports_vision = True
        events = [e async for e in h.loop.invoke(Message(message='观察页面'))]
        request = h.llm.requests[1].messages
        assert_no_dangling(request)
        assert request[-1]['content'][-1]['type']=='image_ref'
        assert request[-2]['tool_call_id']=='echo'
        assert not [e for e in events if e.type=='message' and e.attachments]
    run(scenario())


def test_owned_temporary_file_gc_protects_active_runs_and_keeps_metadata(tmp_path):
    async def scenario():
        files = {}
        class Uow:
            def __init__(self):
                self.file = SimpleNamespace(save=self.save, get_by_id=self.get,
                    expired_visual_files=AsyncMock(side_effect=lambda now: list(files.values())))
                self.run = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(status='waiting')))
            async def save(self, file): files[file.id]=file.model_copy(deep=True)
            async def get(self, file_id): return files.get(file_id)
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
        uow = Uow()
        storage = LocalFileStorage(str(tmp_path),lambda:uow)
        visual = {**ref(), 'temporary':True,'expires_at':1,'deleted_at':None}
        file = await storage.upload_file(UploadFile(filename='image.png',file=io.BytesIO(b'pixels'),size=6),visual=visual)
        assert await expire_visual_artifacts(lambda:uow,storage,now=2)==[]
        assert storage._resolve_key_path(file.key).exists()
        uow.run.get.return_value = SimpleNamespace(status='completed')
        original_delete = storage.delete_visual_file
        storage.delete_visual_file = AsyncMock(side_effect=OSError('controlled delete failure'))
        assert await expire_visual_artifacts(lambda:uow,storage,now=2)==[]
        assert files[file.id].visual['deleted_at'] is None
        storage.delete_visual_file = original_delete
        assert await expire_visual_artifacts(lambda:uow,storage,now=2)==[file.id]
        assert not storage._resolve_key_path(file.key).exists()
        assert files[file.id].visual['deleted_at']==2
        with pytest.raises(ValueError):
            await storage.delete_visual_file(File(id='permanent',key='do-not-delete'))
    run(scenario())


@pytest.mark.skipif(os.environ.get('RAY_TEST_BROWSER')!='1', reason='需要显式启用本机 Chromium')
def test_real_browser_node_identity_focus_hidden_root_and_adapter_resume(tmp_path):
    from playwright.async_api import async_playwright
    from app.infrastructure.external.browser.playwright_browser import PlaywrightBrowser
    async def scenario():
        async with async_playwright() as pw:
            context = await pw.chromium.launch_persistent_context(str(tmp_path/'profile'), headless=True,
                executable_path=os.environ.get('RAY_TEST_CHROMIUM'), args=['--remote-debugging-port=0'])
            port = (tmp_path/'profile'/'DevToolsActivePort').read_text().splitlines()[0]
            first = PlaywrightBrowser(f'http://127.0.0.1:{port}')
            second = PlaywrightBrowser(first.cdp_url)
            try:
                await first.initialize()
                await first.page.goto('data:text/html,<button onclick="window.hit=1">Submit</button>')
                observed = await first.view_page(mode='interactive')
                tab = observed.data['tab_id']; target = observed.data['interactive_elements'][0]['ref']
                await first.cleanup()
                result = await second.click(ref=target,tab_id=tab)
                assert result.success, result.message
                assert await second.page.evaluate('window.hit')==1
                await second.page.evaluate("() => { const b=document.querySelector('button'); b.replaceWith(b.cloneNode(true)); }")
                assert not (await second.click(ref=target)).success
                fresh = await second.view_page(mode='interactive')
                target = fresh.data['interactive_elements'][0]['ref']
                await second.page.locator('button').evaluate("el => el.textContent = 'Different action'")
                assert not (await second.click(ref=target)).success
                await second.page.set_content('<input id="a" value="old"><div style="position:absolute;left:300px;top:100px;width:200px;height:100px" onmousedown="event.preventDefault()">other</div>')
                await second.page.locator('#a').focus()
                assert not (await second.input('WRONG',coordinate_x=350,coordinate_y=150)).success
                assert await second.page.locator('#a').input_value()=='old'
                await second.page.set_content('<div hidden><main>HIDDEN</main></div><p>VISIBLE</p>')
                result = await second.view_page(mode='text')
                assert result.data['content']=='VISIBLE'
                pixels, meta = await second.capture_screenshot(for_model=True)
                assert meta['mime_type']=='image/jpeg' and max(meta['width'],meta['height'])<=2048
                assert pixels.startswith(b'\xff\xd8')
            finally:
                await second.cleanup()
                await context.close()
    run(scenario())


def test_current_images_never_silently_dropped_and_old_pixels_retire_first():
    from app.domain.services.context.vision import retire_observed_image
    current = [{'role':'tool','function_name':'browser_screenshot',
                'content':json.dumps({'data':{'image_input':ref(i)}})} for i in range(3)]
    with pytest.raises(ValueError, match='未静默丢弃'):
        reconcile_visual_history(current, True)
    old = {'role':'user','_ray_visual':['image-1'], 'content':[{'type':'image_ref','image_ref':ref(1)}]}
    fresh = {'role':'user','_ray_visual':['image-2'], 'content':[{'type':'image_ref','image_ref':ref(2)}]}
    messages = [old, {'role':'assistant','content':'已读取旧图'}, fresh]
    trimmed = retire_observed_image(messages)
    assert list(image_refs(trimmed)) == [ref(2)]
    assert retire_observed_image(trimmed) == trimmed
    assert len(list(image_refs(messages))) == 2


def test_lazy_application_late_resource_is_destroyed_without_changing_new_owner():
    from tests.core.test_task_execution_control import make_service
    from app.domain.models.run import RunStatus
    async def scenario():
        h = make_loop([])
        service = make_service(h)
        accepted = await h.ledger.start(h.session.id)
        gate, entered = asyncio.Event(), asyncio.Event()
        box = SimpleNamespace(id='late', ensure_sandbox=AsyncMock(), destroy=AsyncMock())
        async def create(**kwargs):
            entered.set()
            await gate.wait()
            return box
        service._sandbox_cls = SimpleNamespace(create=create)
        worker = asyncio.create_task(service._acquire_independent_sandbox(h.session, accepted.id))
        await entered.wait()
        await h.ledger.transition(h.session.id, accepted.id, RunStatus.CANCELLED)
        newer = await h.ledger.start(h.session.id)
        h.session.sandbox_id = 'new-owner'
        gate.set()
        with pytest.raises(asyncio.CancelledError):
            await worker
        box.destroy.assert_awaited_once()
        assert h.session.sandbox_id == 'new-owner'
        assert h.runs[newer.id].status == RunStatus.RUNNING
        assert not [e for e in h.events if e.type == 'environment' and e.status == 'ready']
    run(scenario())


def test_visual_request_rebuild_preserves_manifest_and_tool_definitions():
    from app.domain.models.event import ContextEvent, ContextOp, TurnEvent, TurnPhase
    from app.domain.models.run import Run
    from app.domain.services.request_rebuild import rebuild_request
    messages = [{'role':'user','_ray_visual':['image-1'],'content':[{'type':'image_ref','image_ref':ref()}]}]
    run_row = Run(id='r',session_id='s',config_snapshot={'system_prompt':'sys','tools':[],
        'tool_revisions':[{'from_turn':2,'tools':[{'function':{'name':'discovered'}}]}]})
    events = [ContextEvent(op=ContextOp.REPLACE,messages=messages,seq=1,run_id='r'),
              TurnEvent(index=2,phase=TurnPhase.STARTED,seq=2,run_id='r')]
    rebuilt = rebuild_request(events,run_row,2)
    assert rebuilt.images == [ref()]
    assert rebuilt.tools[0]['function']['name'] == 'discovered'
    assert 'base64' not in json.dumps(rebuilt.messages)


def test_attachments_and_large_output_acquire_lazy_resource_once():
    from tests.core.test_w10_project_session import _runner
    from tests.support.loop_harness import InMemorySandbox
    from app.domain.services.context.shaping import ResultShaper
    from app.domain.services.flows.tool_pipeline import ToolInvocation
    async def scenario():
        box = InMemorySandbox()
        box.upload_file = AsyncMock(return_value=ToolResult())
        factory = AsyncMock(return_value=box)
        lazy = LazySandbox(factory)
        storage = SimpleNamespace(download_file=AsyncMock(return_value=(io.BytesIO(b'input'),File(filename='input.txt'))))
        runner = _runner(lazy,storage,workspace_dir=None)
        await runner._sync_file_to_sandbox('input')
        shaper = next(h for h in runner._flow.pipeline._after if isinstance(h,ResultShaper))
        invocation = ToolInvocation(call_id='large',function_name='web_search',raw_arguments='{}')
        await shaper(invocation,ToolResult(message='x'*20000))
        assert invocation.shaping.full_output_path in box.files
        factory.assert_awaited_once()
        box.upload_file.assert_awaited_once()
    run(scenario())
