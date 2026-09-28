"""交接快照与恢复依据：固定模型，替换存储/传输/沙箱。"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.domain.models.event import MessageEvent, PlanEvent, ToolEvent
from app.domain.models.message import Message
from app.domain.models.session import Session, SessionStatus
from app.domain.models.tool_result import ToolResult
from tests.support.loop_harness import (
    assert_no_dangling,
    input_task,
    make_loop,
    make_runner,
    memory_messages,
    submit,
    tool_results,
)
from tests.support.scripted_llm import ScriptedResponse, ScriptedToolCall, text, tool_call


@pytest.mark.parametrize('resume', [False, True])
def test_tool_result_is_saved_before_called_event_and_stop_keeps_it(tmp_path, resume):
    async def run():
        target = tmp_path / 'hello.txt'
        h = make_loop([tool_call('write_file', {'filepath': str(target), 'content': 'hello'}, id='write-1'),
                       text('完成')])

        async def write_file(filepath, content, **kwargs):
            target.write_text(content)
            return ToolResult(success=True)
        h.sandbox.write_file = AsyncMock(side_effect=write_file)
        events = h.loop.invoke(Message(message='写入文件'))
        saved = None
        async for event in events:
            if isinstance(event, ToolEvent) and event.status == 'calling':
                assert not target.exists()
            if isinstance(event, ToolEvent) and event.status == 'called':
                assert target.read_text() == 'hello'
                saved = Session.model_validate_json(h.session.model_dump_json())
                assert tool_results(memory_messages(saved))['write-1']['success'] is True
                if not resume:
                    break
        await events.aclose()
        if resume:
            assert len(h.llm.requests) == 2
            return
        # 在 called 之后停止：续接时已执行的调用保留真实结果，不会被补成“未执行”
        saved.status = SessionStatus.COMPLETED
        restored = make_loop([text('继续完成')], session=saved)
        resumed = restored.loop.invoke(Message(message='继续'))
        await resumed.__anext__()
        await resumed.aclose()
        messages = memory_messages(restored.session)
        assert_no_dangling(messages)
        assert tool_results(messages)['write-1']['success'] is True
        assert target.read_text() == 'hello'
        assert len(h.llm.requests) == 1
    asyncio.run(asyncio.wait_for(run(), 5))


def test_output_publication_survives_repository_failure():
    async def run():
        h = make_loop([])
        runner, task = make_runner(h), input_task()
        runner._uow.session.add_event = AsyncMock(side_effect=RuntimeError('受控保存失败'))
        with pytest.raises(RuntimeError, match='受控保存失败'):
            await runner._put_and_add_event(task, MessageEvent(message='观察结果'))
        assert len(task.output_stream.history) == 1
        assert json.loads(task.output_stream.history[0])['message'] == '观察结果'
        assert h.session.events == []
    asyncio.run(asyncio.wait_for(run(), 5))


def test_wait_resume_after_serialization_keeps_plan_snapshot_and_identity():
    async def run():
        plan = [{'step': '确认路径', 'status': 'in_progress'}, {'step': '读取文件', 'status': 'pending'}]
        first = make_loop([ScriptedResponse(tool_calls=[
            ScriptedToolCall('update_plan', {'plan': plan}, id='plan-1'),
            ScriptedToolCall('message_ask_user', {'text': '路径？'}, id='ask-1'),
        ])])
        task = input_task()
        await submit(task, '核对文件')
        await make_runner(first).invoke(task)
        restored = Session.model_validate_json(first.session.model_dump_json())
        assert restored is not first.session
        assert restored.status == 'waiting'
        snapshot = restored.get_latest_plan()
        assert [s.status for s in snapshot.steps] == ['running', 'pending']

        done_plan = [{'step': '确认路径', 'status': 'completed'}, {'step': '读取文件', 'status': 'completed'}]
        second = make_loop([
            ScriptedResponse(tool_calls=[
                ScriptedToolCall('read_file', {'filepath': '/hello.txt'}, id='read-1'),
                ScriptedToolCall('update_plan', {'plan': done_plan}, id='plan-2'),
            ]),
            text('完成'),
        ], session=restored)
        task2 = input_task()
        await submit(task2, '/hello.txt')
        await make_runner(second).invoke(task2)
        assert restored.status == 'completed'
        assert first.session.status == 'waiting'
        plans = [e.plan for e in restored.events if isinstance(e, PlanEvent)]
        assert len(plans) == 2 and plans[0].id == plans[1].id
        assert [s.status for s in plans[-1].steps] == ['completed', 'completed']
        assert tool_results(second.llm.requests[0].messages)['ask-1']['data']['reply'] == '/hello.txt'
        second.sandbox.read_file.assert_awaited_once()
        assert second.llm.remaining == 0
    asyncio.run(asyncio.wait_for(run(), 5))
