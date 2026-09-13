"""第九章：交接快照与恢复依据；固定模型，替换存储/传输/沙箱。"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.domain.models.event import MessageEvent, ToolEvent, PlanEvent, StepEvent
from app.domain.models.message import Message
from app.domain.models.session import Session
from app.domain.models.tool_result import ToolResult
from test_planner_react_flow import make_flow, read_call, response
from test_task_execution_control import make_runner, input_task, plan, submit


@pytest.mark.parametrize('resume', [False, True])
def test_called_event_precedes_saved_tool_result_and_rollback_keeps_file(tmp_path, resume):
    async def run():
        target = tmp_path / 'hello.txt'
        call = read_call('write-1', str(target))
        call['tool_calls'][0]['function'] = {'name': 'write_file', 'arguments': json.dumps({
            'filepath': str(target), 'content': 'hello'})}
        h = make_flow([call, response({'message': '完成'})])

        async def write_file(filepath, content, **kwargs):
            target.write_text(content)
            return ToolResult(success=True)
        h.sandbox.write_file = AsyncMock(side_effect=write_file)
        events = h.flow.react.invoke('写入文件')
        async for event in events:
            if isinstance(event, ToolEvent) and event.status == 'calling':
                assert not target.exists()
            if isinstance(event, ToolEvent) and event.status == 'called':
                assert target.read_text() == 'hello'
                saved = Session.model_validate_json(h.session.model_dump_json())
                assert saved.memories['react'].messages[-1]['tool_calls'][0]['id'] == 'write-1'
                assert not any(m.get('tool_call_id') == 'write-1' for m in saved.memories['react'].messages)
                if not resume:
                    break
        await events.aclose()
        if resume:
            assert any(m.get('tool_call_id') == 'write-1' for m in h.session.memories['react'].messages)
            assert len(h.requests) == 2
        else:
            restored = make_flow([], session=saved)
            await restored.flow.react.roll_back(Message(message='继续'))
            assert not restored.session.memories['react'].messages[-1].get('tool_calls')
            assert target.read_text() == 'hello'
            assert len(h.requests) == 1
    asyncio.run(asyncio.wait_for(run(), 5))


def test_output_publication_survives_repository_failure():
    async def run():
        h = make_flow([])
        runner, task = make_runner(h), input_task()
        runner._uow.session.add_event = AsyncMock(side_effect=RuntimeError('受控保存失败'))
        with pytest.raises(RuntimeError, match='受控保存失败'):
            await runner._put_and_add_event(task, MessageEvent(message='观察结果'))
        assert len(task.output_stream.history) == 1
        assert json.loads(task.output_stream.history[0])['message'] == '观察结果'
        assert h.session.events == []
    asyncio.run(asyncio.wait_for(run(), 5))


def test_wait_resume_after_serialization_uses_plan_snapshot_not_step_projection():
    async def run():
        ask = read_call('ask-1', '/unused')
        ask['tool_calls'][0]['function'] = {'name': 'message_ask_user', 'arguments': json.dumps({'text': '路径？'})}
        first = make_flow([plan(), ask])
        task = input_task()
        await submit(task, '核对文件')
        await make_runner(first).invoke(task)
        restored = Session.model_validate_json(first.session.model_dump_json())
        assert restored is not first.session
        assert restored.status == 'waiting'
        # StepEvent 已记录 started，但最新 PlanEvent 的独立快照仍为 pending。
        step_event = next(e for e in restored.events if isinstance(e, StepEvent))
        assert step_event.step.status == 'running'
        assert restored.get_latest_plan().steps[0].status == 'pending'
        second = make_flow([read_call('read-1', '/hello.txt'), response({'success': True, 'result': '已读取'}),
                            response({'steps': []}), response({'message': '完成', 'attachments': []})], session=restored)
        task2 = input_task()
        await submit(task2, '/hello.txt')
        await make_runner(second).invoke(task2)
        assert restored.status == 'completed'
        assert first.session.status == 'waiting'
        assert sum(isinstance(e, PlanEvent) and e.status == 'created' for e in restored.events) == 1
        assert any(m.get('tool_call_id') == 'ask-1' for m in second.requests[0]['messages'])
        second.sandbox.read_file.assert_awaited_once()
        assert not second.remaining
    asyncio.run(asyncio.wait_for(run(), 5))
