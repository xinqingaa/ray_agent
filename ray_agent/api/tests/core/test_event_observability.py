"""事件投影与观察缺口；模型、存储、沙箱使用确定性替身。"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import TypeAdapter

from app.domain.models.event import ErrorEvent, Event, ToolEvent, FileToolContent, PlanEvent, TurnEvent
from app.domain.models.message import Message
from app.domain.models.plan import Plan, Step
from app.domain.models.tool_result import ToolResult
from app.interfaces.schemas.event import EventMapper
from tests.support.loop_harness import make_loop
from tests.support.scripted_llm import text, tool_call, usage


def test_live_and_history_projection_preserves_correlation_but_omits_internal_result():
    t = datetime(2026, 9, 13, 1, 0, 0, 100000, tzinfo=timezone.utc)
    events = [ToolEvent(id=f'event-{i}', created_at=t+timedelta(milliseconds=i*20),
                       tool_call_id='call-read', tool_name='file', function_name='read_file',
                       function_args={'filepath': '/hello.txt'}, status=status,
                       function_result=ToolResult(success=False, message='读取失败') if i else None,
                       tool_content=FileToolContent(content='预览内容') if i else None,
                       duration_ms=12 if i else None)
              for i, status in enumerate(['calling', 'called'])]
    live = [EventMapper.event_to_sse_event(e).model_dump(mode='json') for e in events]
    restored = [TypeAdapter(Event).validate_json(e.model_dump_json()) for e in events]
    history = [e.model_dump(mode='json') for e in EventMapper.events_to_sse_events(restored)]
    assert live == history
    assert live[0]['data']['event_id'] != live[1]['data']['event_id']
    assert live[0]['data']['tool_call_id'] == live[1]['data']['tool_call_id']
    # created_at 是毫秒时间戳
    assert live[1]['data']['created_at'] - live[0]['data']['created_at'] == 20
    assert live[1]['data']['content']['content'] == '预览内容'
    assert live[1]['data']['duration_ms'] == 12 and live[0]['data']['duration_ms'] is None
    assert 'function_result' not in live[1]['data']
    assert 'success' not in live[1]['data']
    assert restored[1].function_result.success is False


def test_plan_projection_supplies_identity_without_goal_or_phase():
    event = PlanEvent(plan=Plan(id='plan-1', goal='目标', steps=[Step(id='step-1')]), status='updated')
    projected = EventMapper.event_to_sse_event(event).data.model_dump(mode='json')
    assert projected['steps'][0]['id'] == 'step-1'
    assert projected['plan_id'] == 'plan-1'
    assert not {'goal', 'status'} & projected.keys()


@pytest.mark.parametrize('eventually_valid', [True, False])
def test_usage_counts_returned_attempts_but_not_failed_transport(eventually_valid):
    async def run():
        script = [ConnectionError('受控断连'), text('', usage=usage(7, 0))]
        script.append(text('完成', usage=usage(10, 1)) if eventually_valid else text('', usage=usage(7, 0)))
        h = make_loop(script, max_retries=3)
        observed = [e async for e in h.loop.invoke(Message(message='文本任务'))]
        assert h.llm.call_count == 3
        completed = [e for e in observed if isinstance(e, TurnEvent) and e.phase == 'completed']
        # 一轮的用量是返回了响应的尝试（含空回复）之和；传输失败没有响应，也就没有用量，但计入 attempts
        assert len(completed) == 1 and completed[0].attempts == 3
        usage_sum = (completed[0].usage.prompt_tokens, completed[0].usage.completion_tokens)
        assert usage_sum == ((17, 1) if eventually_valid else (14, 0))
        assert any(isinstance(e, ErrorEvent) for e in observed) is not eventually_valid
    asyncio.run(asyncio.wait_for(run(), 5))


def test_one_tool_event_pair_is_one_execution_attempt():
    async def run():
        h = make_loop([tool_call('read_file', {'filepath': '/hello.txt'}, id='call-read'), text('完成')])
        h.sandbox.read_file.side_effect = [RuntimeError('受控首次失败'), ToolResult(success=True)]
        events = [e async for e in h.loop.invoke(Message(message='读取文件'))]
        tool_events = [e for e in events if isinstance(e, ToolEvent)]
        assert h.sandbox.read_file.await_count == 1
        assert [e.status for e in tool_events] == ['calling', 'called']
        assert len({e.tool_call_id for e in tool_events}) == 1
        assert tool_events[-1].function_result.success is False
        assert '受控首次失败' in tool_events[-1].function_result.message
        assert tool_events[-1].duration_ms is not None
    asyncio.run(asyncio.wait_for(run(), 5))
