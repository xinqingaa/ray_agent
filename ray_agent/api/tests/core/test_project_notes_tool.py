"""真实循环/管线、替身模型：笔记权限、固定输入容量及冻结请求重建。"""
import asyncio
import pytest
from unittest.mock import AsyncMock
from app.domain.models.tool_result import ToolResult
from app.domain.models.event import ToolEvent, ToolEventStatus
from app.domain.models.run import RunMode, RunStatus
from app.domain.services.tools.project_notes import ProjectNotesTool
from app.domain.services.prompts.project import build_project_prompt
from tests.support.loop_harness import make_loop, memory_messages
from tests.support.scripted_llm import tool_call, text
from tests.core.test_plan_mode_and_compact import run_once, assert_rebuilds


@pytest.mark.parametrize('mode,policy,expected',[(RunMode.PLAN,{'update_project_notes':'ask'},'plan_mode'),
    (RunMode.NORMAL,{'update_project_notes':'deny'},'policy')])
def test_notes_policy_and_plan_short_circuit(mode,policy,expected):
    async def scenario():
        update=AsyncMock(return_value=ToolResult(success=True,data={'notes_version':1}))
        h=make_loop([tool_call('update_project_notes',{'content':'笔记','base_version':0}),text('结束')],
            extra_tools=[ProjectNotesTool(update)],tool_policy=policy)
        run=await run_once(h,'写笔记',mode)
        update.assert_not_awaited()
        called=next(e for e in h.events if isinstance(e,ToolEvent) and e.function_name=='update_project_notes' and e.status==ToolEventStatus.CALLED)
        assert called.denied_by==expected and not called.function_result.success
        assert_rebuilds(h,run.id,h.llm.requests)
    asyncio.run(scenario())


def test_notes_results_do_not_change_frozen_system_and_independent_has_no_tool():
    async def scenario():
        update=AsyncMock(return_value=ToolResult(success=True,data={'content':'新笔记','notes_version':1}))
        h=make_loop([tool_call('update_project_notes',{'content':'新笔记','base_version':0}),text('结束')],
            extra_tools=[ProjectNotesTool(update)])
        h.loop.project_prompt=build_project_prompt('说明','原笔记',0,['摘要'])
        run=await run_once(h,'写筆記')
        update.assert_awaited_once_with('新笔记',0)
        assert all('原笔记' in r.messages[0]['content'] and '版本 0' in r.messages[0]['content'] for r in h.llm.requests)
        assert all('<project_context>' not in str(m.get('content','')) for m in memory_messages(h.session))
        assert_rebuilds(h,run.id,h.llm.requests)
        plain=make_loop([text('独立')]);await run_once(plain,'独立')
        assert not any(t['function']['name']=='update_project_notes' for t in plain.llm.requests[0].tools)
        assert '<project_context>' not in plain.llm.requests[0].messages[0]['content']
    asyncio.run(scenario())


def test_project_fixed_input_fails_without_model_or_silent_truncation():
    async def scenario():
        h=make_loop([],context_window=4000,max_tokens=1024,extra_tools=[ProjectNotesTool(AsyncMock())])
        prompt=build_project_prompt('说'*8000,'记'*8000,22,['摘'*200]*10)
        h.loop.project_prompt=prompt
        run=await run_once(h,'开始')
        assert run.status==RunStatus.FAILED and run.reason=='context_limit'
        assert not h.llm.requests
        assert run.config_snapshot['project_prompt']==prompt
        assert len(prompt)>16000 and '版本 22' in prompt
    asyncio.run(scenario())
