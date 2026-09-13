"""第十章：事件投影与观察缺口；模型、存储、沙箱使用确定性替身。"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from pydantic import TypeAdapter

from app.domain.models.event import Event, ToolEvent, FileToolContent, PlanEvent, UsageEvent
from app.domain.models.llm import LLMInvokeResult, LLMUsage
from app.domain.models.plan import Plan, Step
from app.domain.models.tool_result import ToolResult
from app.interfaces.schemas.event import EventMapper
from test_planner_react_flow import make_flow, read_call, response


def test_live_and_history_projection_preserves_correlation_but_omits_internal_result():
    t = datetime(2026, 9, 13, 1, 0, 0, 100000, tzinfo=timezone.utc)
    events = [ToolEvent(id=f'event-{i}', created_at=t+timedelta(milliseconds=i*20),
                       tool_call_id='call-read', tool_name='file', function_name='read_file',
                       function_args={'filepath': '/hello.txt'}, status=status,
                       function_result=ToolResult(success=False, message='读取失败') if i else None,
                       tool_content=FileToolContent(content='预览内容') if i else None)
              for i, status in enumerate(['calling', 'called'])]
    live = [EventMapper.event_to_sse_event(e).model_dump(mode='json') for e in events]
    restored = [TypeAdapter(Event).validate_json(e.model_dump_json()) for e in events]
    history = [e.model_dump(mode='json') for e in EventMapper.events_to_sse_events(restored)]
    assert live == history
    assert live[0]['data']['event_id'] != live[1]['data']['event_id']
    assert live[0]['data']['tool_call_id'] == live[1]['data']['tool_call_id']
    assert live[0]['data']['created_at'] == live[1]['data']['created_at']
    assert live[1]['data']['content']['content'] == '预览内容'
    assert 'function_result' not in live[1]['data']
    assert 'success' not in live[1]['data']
    assert restored[1].function_result.success is False


def test_plan_projection_does_not_supply_plan_identity_or_phase():
    event = PlanEvent(plan=Plan(id='plan-1', goal='目标', steps=[Step(id='step-1')]), status='updated')
    projected = EventMapper.event_to_sse_event(event).data.model_dump(mode='json')
    assert projected['steps'][0]['id'] == 'step-1'
    assert not {'plan_id', 'goal', 'status'} & projected.keys()


@pytest.mark.parametrize('eventually_valid', [True, False])
def test_returned_usage_is_not_a_complete_attempt_ledger(eventually_valid):
    async def run():
        h = make_flow([])
        empty = LLMInvokeResult(message={'role': 'assistant', 'content': ''}, usage=LLMUsage(total_tokens=7))
        last = LLMInvokeResult(message=response({'message':'完成'}), usage=LLMUsage(total_tokens=11)) if eventually_valid else empty
        h.flow.react._llm.invoke = AsyncMock(side_effect=[empty, last])
        observed = []
        try:
            async for e in h.flow.react.invoke('文本任务'):
                observed.append(e)
        except RuntimeError:
            assert not eventually_valid
        assert h.flow.react._llm.invoke.await_count == 2
        usages = [e for e in observed if isinstance(e, UsageEvent)]
        assert [e.total_tokens for e in usages] == ([7, 11] if eventually_valid else [])
    asyncio.run(asyncio.wait_for(run(), 5))


def test_one_tool_event_pair_can_cover_multiple_execution_attempts():
    async def run():
        h = make_flow([read_call('call-read', '/hello.txt'), response({'message':'完成'})])
        h.sandbox.read_file.side_effect = [RuntimeError('受控首次失败'), ToolResult(success=True)]
        events = [e async for e in h.flow.react.invoke('读取文件')]
        tool_events = [e for e in events if isinstance(e, ToolEvent)]
        assert h.sandbox.read_file.await_count == 2
        assert [e.status for e in tool_events] == ['calling','called']
        assert len({e.tool_call_id for e in tool_events}) == 1
        assert tool_events[-1].function_result.success is True
    asyncio.run(asyncio.wait_for(run(), 5))
