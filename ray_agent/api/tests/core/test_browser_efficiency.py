"""本轮契约验证；浏览器行为用单个受控 Chromium 场景，不接触用户页面。"""
import asyncio
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import TypeAdapter

from app.domain.models.event import Event, ToolEvent
from app.domain.models.file import File
from app.domain.models.message import Message
from app.domain.models.tool_result import ToolResult
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.context.shaping import ResultShaper
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.tools.browser import BrowserTool
from app.infrastructure.external.browser.playwright_browser import PlaywrightBrowser
from app.infrastructure.external.browser.web_content import extract_webpage
from app.interfaces.schemas.event import EventMapper
from tests.support.loop_harness import make_loop, make_runner, assert_no_dangling, tool_results
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text


def test_browser_write_batch_fails_closed_but_read_batch_continues():
    async def scenario():
        browser = SimpleNamespace(click=AsyncMock(return_value=ToolResult(success=False, message='目标已失效')),
                                  input=AsyncMock(), view_page=AsyncMock(return_value=ToolResult()))
        h = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('browser_click', {'index':1}, id='a'),
            ScriptedToolCall('browser_input', {'text':'must not type','index':2}, id='b'),
            ScriptedToolCall('echo', {'text':'must skip'}, id='c')]), text('已停止本批次')],
            extra_tools=[BrowserTool(browser)])
        events = [e async for e in h.loop.invoke(Message(message='操作表单'))]
        browser.input.assert_not_awaited()
        assert not h.recording.calls
        skipped = [e for e in events if isinstance(e, ToolEvent) and e.denied_by == 'batch']
        assert [e.tool_call_id for e in skipped] == ['b','c']
        request = h.llm.requests[1].messages
        assert_no_dangling(request)
        assert tool_results(request)['b']['data']['executed'] is False
        h = make_loop([ScriptedResponse(tool_calls=[ScriptedToolCall('boom', {}, id='a'),
            ScriptedToolCall('browser_view', {'mode':'text','max_chars':300}, id='b')]), text('读取完成')],
            extra_tools=[BrowserTool(browser)])
        _ = [e async for e in h.loop.invoke(Message(message='读页'))]
        browser.view_page.assert_awaited_once_with(mode='text',max_chars=300)
    asyncio.run(scenario())


def test_display_uses_result_and_round_trips_browser_file_and_shell():
    async def scenario():
        runner = AgentTaskRunner.__new__(AgentTaskRunner)
        runner._browser = SimpleNamespace(screenshot=AsyncMock())
        runner._sandbox = SimpleNamespace(read_file=AsyncMock(),read_shell_output=AsyncMock())
        for tool, data in [('browser',{'url':'https://example.org/result','content':'目标状态'}),
                           ('file',{'content':'这次读取的两行'}),('shell',{'console_records':[]}),('deliver',{'items':[]})]:
            event = ToolEvent(tool_call_id=tool, tool_name=tool, function_name='test',function_args={},
                              status='called',function_result=ToolResult(success=False,message='受控错误',data=data))
            await runner._handle_tool_event(event)
            live = EventMapper.event_to_sse_event(event).model_dump(mode='json')
            restored = TypeAdapter(Event).validate_json(event.model_dump_json())
            assert live == EventMapper.event_to_sse_event(restored).model_dump(mode='json')
            assert live['data']['content']['outcome']['success'] is False
            assert 'projection' in live['data']['stages_ms']
        runner._browser.screenshot.assert_not_awaited()
        runner._sandbox.read_file.assert_not_awaited()
        runner._sandbox.read_shell_output.assert_not_awaited()
        old = ToolEvent(tool_call_id='old',tool_name='browser',function_name='browser_view',function_args={},
                        tool_content={'screenshot':'/api/files/image/file'})
        assert old.tool_content.screenshot == '/api/files/image/file'
    asyncio.run(scenario())


def test_screenshot_quota_resumes_from_run_and_returns_owned_artifact():
    async def scenario():
        h = make_loop([])
        runner = make_runner(h)
        runner._screenshot_usage_loaded = False
        runner._screenshot_count = runner._screenshot_bytes = 0
        runner._delivery_call_id = 'shot'
        runner._browser = SimpleNamespace(capture_screenshot=AsyncMock(return_value=(b'png',{
            'width':1,'height':1,'size':3,'url':'https://example.org','stages_ms':{'capture':2}})))
        runner._sandbox.upload_file = AsyncMock(return_value=ToolResult())
        runner._deliver_file = AsyncMock(return_value=File(id='image',filepath='/tmp/img.png'))
        runner._file_storage = SimpleNamespace(get_file_url=lambda f:'/api/files/image/download')
        result = await runner._capture_screenshot(purpose='保留提交状态',scope='viewport',ref=None,tab_id=None)
        assert result.success and result.data['visual_input'] is False
        assert result.data['run_id'] == runner.run_id and result.data['tool_call_id']=='shot'
        assert result.data['screenshot_usage'] == {'count':1,'bytes':3}
        h.events.append(ToolEvent(run_id=runner.run_id, tool_call_id='prior',tool_name='browser',
            function_name='browser_screenshot', function_args={}, status='called',
            function_result=ToolResult(data={'screenshot_usage':{'count':8,'bytes':100}}), seq=1))
        runner._screenshot_usage_loaded = False
        runner._screenshot_count = runner._screenshot_bytes = 0
        result = await runner._capture_screenshot(purpose='第九张',scope='viewport',ref=None,tab_id=None)
        assert not result.success and '配额' in result.message
        assert runner._browser.capture_screenshot.await_count == 1
    asyncio.run(scenario())


def test_fetch_extracts_once_and_keeps_long_tail_for_shaping():
    result = extract_webpage(ToolResult(data={'body':'<main><h1>Title</h1><div><p>unique</p></div>'+
        '<p>'+'long '*15000+'TAIL</p><script>hidden</script></main>', 'status':200,'mime':'text/html'}))
    assert result.data['content'].count('unique')==1
    assert result.full_content['content'].endswith('TAIL')
    assert 'hidden' not in result.full_content['content']
    async def shape():
        saved={}
        async def write(path, content): saved[path]=content
        invocation=ToolInvocation(call_id='fetch',function_name='web_fetch',raw_arguments='{}')
        preview=await ResultShaper(8000,write)(invocation,result)
        assert preview.data['content'] == result.data['content']
        assert saved[preview.data['full_output_path']].find('TAIL')>50000
    asyncio.run(shape())


@pytest.mark.skipif(os.environ.get('RAY_TEST_BROWSER') != '1', reason='显式启用受控 Chromium 行为检查')
def test_controlled_browser_read_form_refs_logs_tabs_and_screenshot():
    from playwright.async_api import async_playwright
    async def scenario():
        async with async_playwright() as pw:
            chromium=await pw.chromium.launch(headless=True, executable_path=os.environ.get('RAY_TEST_CHROMIUM'))
            page=await chromium.new_page(viewport={'width':900,'height':700})
            browser=PlaywrightBrowser('unused')
            browser.browser, browser.page=chromium,page
            browser._register(page)
            try:
                await page.set_content('''<body>裸文本CODE-42<div><p>唯一段落</p></div>
                    <p hidden>隐藏消息</p><script>console.warn('启动警告')</script>
                    <label>名字<input id="name" value="old"></label>
                    <button onclick="document.querySelector('#state').innerText=document.querySelector('#name').value">提交</button>
                    <p id="state">尚未提交</p><p>'''+ 'long '*15000 + '''TAIL-65537</p></body>''')
                view=await browser.view_page()
                assert view.success, view.message
                assert '裸文本CODE-42' in view.data['content'] and view.data['content'].count('唯一段落')==1
                assert '隐藏消息' not in view.full_content['content'] and view.full_content['content'].endswith('TAIL-65537')
                entries=view.data['interactive_elements']; name,button=entries[0],entries[1]
                assert not (await browser.click()).success
                assert not (await browser.input('bad',index=-1)).success
                assert not (await browser.click(index=0,coordinate_x=1)).success
                assert (await browser.input('Alice',ref=name['ref'])).success
                assert await page.locator('#name').input_value()=='Alice'
                assert (await browser.click(ref=button['ref'],observe='text')).success
                assert await page.locator('#state').inner_text()=='Alice'
                observed=await browser.view_page(scope='viewport',max_chars=300)
                assert observed.success
                assert not (await browser.click(ref=button['ref'])).success
                assert not (await browser.click(index=button['index'])).success
                # 日志在 console_exec 之前捕获，重复执行不会清空或叠加。
                await browser.console_exec("console.error('一次错误')")
                logs=await browser.console_view()
                assert [r['text'] for r in logs.data['logs']]==['启动警告','一次错误']
                await browser.console_exec("console.log('第二条')")
                assert len((await browser.console_view(since=2)).data['logs'])==1
                original=page
                popup=await chromium.new_page(); browser._register(popup)
                await popup.set_content('<p>第二页</p>')
                assert (await browser.view_page(mode='text')).data['tab_id']==view.data['tab_id']
                tabs=await browser.tabs(); new_tab=next(t['tab_id'] for t in tabs.data['tabs'] if not t['active'])
                assert (await browser.view_page(tab_id=new_tab,mode='text')).data['content']=='第二页'
                assert not (await browser.click(ref=entries[0]['ref'])).success
                await popup.close()
                assert (await browser.tabs()).success
                await browser.tabs(view.data['tab_id'])
                image,meta=await browser.capture_screenshot()
                assert image.startswith(b'\x89PNG') and (meta['width'],meta['height'])==(900,700)
                await page.evaluate("document.body.style.minHeight='9000px'")
                with pytest.raises(ValueError,match='尺寸上限'):
                    await browser.capture_screenshot(scope='full_page')
                # 有直接目标等待；观察失败仍明确动作已成功。
                await original.evaluate("setTimeout(()=>document.querySelector('#state').textContent='ready-now',30)")
                assert (await browser.view_page(mode='text',wait_for_text='ready-now')).success
                original_view=browser.view_page
                browser.view_page=AsyncMock(return_value=ToolResult(success=False,message='受控观察失败'))
                result=await browser.press_key('Tab',observe='text')
                assert result.success and result.data['action_success'] and result.data['observation_status']=='failed'
                browser.view_page=original_view
            finally:
                await chromium.close()
    asyncio.run(scenario())


def test_screenshot_is_already_delivered_without_completion_retry():
    async def scenario():
        capture=AsyncMock(return_value=ToolResult(data={'file':File(id='shot',filepath='/tmp/a.png').model_dump()}))
        h=make_loop([ScriptedResponse(tool_calls=[ScriptedToolCall('browser_screenshot',{'purpose':'留证'},id='shot')]),
                     text('已交付截图文件')],extra_tools=[BrowserTool(None,capture)])
        events=[e async for e in h.loop.invoke(Message(message='交付截图文件'))]
        assert h.llm.call_count == 2
        messages=[e for e in events if e.type=='message' and e.attachments]
        assert len(messages)==1 and messages[0].attachments[0].id=='shot'
    asyncio.run(scenario())
