"""循环层的流式增量、首字延迟、失败尝试与请求重建。模型用 ScriptedLLM，不访问网络。"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.application.services.agent_service import AgentService
from app.domain.external.event_notifier import OutputDelta
from app.domain.models.event import (
    AttemptEvent,
    AttemptReason,
    MessageEvent,
    TurnEvent,
    TurnPhase,
)
from app.domain.models.message import Message
from app.domain.models.run import RunStatus
from app.domain.models.session import Session
from app.domain.services.request_rebuild import rebuild_request
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.task import redis_stream_task as task_module
from app.interfaces.endpoints.session_routes import to_session_sse
from tests.support.loop_harness import (
    MemoryNotifier,
    MemoryQueue,
    input_task,
    make_loop,
    make_runner,
    make_uow_factory,
    memory_messages,
    start_run,
)
from tests.support.scripted_llm import ScriptedChunk, ScriptedLLM, ScriptedResponse, ScriptedToolCall, text, tool_call, usage


def run(coro, timeout=5):
    return asyncio.run(asyncio.wait_for(coro, timeout=timeout))


def collect(loop, message="任务"):
    async def _collect():
        return [event async for event in loop.invoke(Message(message=message))]
    return run(_collect())


def test_interrupted_tool_arguments_retry_without_executing_or_entering_history():
    partial = ScriptedResponse(
        chunks=[
            ScriptedChunk(text="先看"),
            ScriptedChunk(tool_index=0, tool_id="c-cut", tool_name="echo", tool_arguments='{"text":'),
        ],
        interrupted=True,
    )
    h = make_loop([partial, text("完成", usage=usage(20, 2))], max_retries=2)
    deltas = []

    async def publish(turn, attempt, delta):
        deltas.append((turn, attempt, delta))

    h.loop._publish_delta = publish
    events = collect(h.loop)

    assert h.recording.calls == []
    assert deltas == [(1, 1, "先看")]
    attempts = [event for event in events if isinstance(event, AttemptEvent)]
    assert len(attempts) == 1
    assert attempts[0].turn == 1 and attempts[0].attempt == 1
    assert attempts[0].reason == AttemptReason.STREAM_INTERRUPTED
    assert attempts[0].chars == 2 and attempts[0].retried is True
    assistant = [message.get("content") for message in memory_messages(h.session) if message.get("role") == "assistant"]
    assert assistant == ["完成"]
    assert "先看" not in json.dumps(memory_messages(h.session), ensure_ascii=False)
    completed = [event for event in events if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED]
    assert completed[-1].attempts == 2
    assert [event.attempt for event in events if isinstance(event, MessageEvent) and event.role == "assistant"] == [2]


def test_length_still_discards_the_response_and_records_ttft():
    h = make_loop([
        ScriptedResponse(
            content="太长",
            finish_reason="length",
            chunks=[ScriptedChunk(text="太长")],
            usage=usage(10, 4),
        ),
        text("短", usage=usage(12, 1)),
    ])
    events = collect(h.loop)
    completed = [event for event in events if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED]
    assert [(event.finish_reason, event.attempts) for event in completed] == [("length", 1), ("stop", 1)]
    assert completed[0].ttft_ms is not None
    assert not any(isinstance(event, AttemptEvent) for event in events)
    assert h.recording.calls == []
    assistant = [message.get("content") for message in memory_messages(h.session) if message.get("role") == "assistant"]
    assert assistant == ["短"]


def test_first_chunk_delay_lands_in_ttft_and_plain_responses_leave_it_empty():
    streamed = make_loop([ScriptedResponse(
        content="你好",
        chunks=[ScriptedChunk(text="你"), ScriptedChunk(text="好")],
        first_chunk_delay=0.06,
        chunk_interval=0.05,
        usage=usage(8, 2),
    )])
    events = collect(streamed.loop)
    completed = next(event for event in events if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
    assert completed.ttft_ms is not None and completed.ttft_ms >= 50
    assert completed.model_ms >= completed.ttft_ms
    assert completed.usage.prompt_tokens == 8

    plain = make_loop([text("好", usage=usage(4, 1))])
    plain_events = collect(plain.loop)
    plain_turn = next(event for event in plain_events
                      if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
    assert plain_turn.ttft_ms is None


def test_usage_calibrates_the_next_estimate_and_absence_stays_on_characters():
    """流式响应末片的 prompt_tokens 校准下一轮；从未收到时保持字符估算。

    纯文本回复会结束运行，所以用一次工具调用把循环留在下一轮。
    """
    calibrated = make_loop([
        ScriptedResponse(
            content="先",
            tool_calls=[ScriptedToolCall(name="echo", arguments={"text": "a"}, id="c1")],
            chunks=[ScriptedChunk(text="先")],
            usage=usage(500, 3),
        ),
        text("第二"),
    ])
    events = collect(calibrated.loop)
    started = [event.context_estimate["method"] for event in events
               if isinstance(event, TurnEvent) and event.phase == TurnPhase.STARTED]
    assert started == ["chars", "usage"]
    first_done = next(event for event in events if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
    assert first_done.usage.prompt_tokens == 500

    missing = make_loop([
        ScriptedResponse(
            content="先",
            tool_calls=[ScriptedToolCall(name="echo", arguments={"text": "a"}, id="c1")],
            chunks=[ScriptedChunk(text="先")],
        ),
        text("第二"),
    ])
    missing_events = collect(missing.loop)
    methods = [event.context_estimate["method"] for event in missing_events
               if isinstance(event, TurnEvent) and event.phase == TurnPhase.STARTED]
    assert methods == ["chars", "chars"]
    completed = next(event for event in missing_events
                     if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
    assert completed.usage.prompt_tokens is None and completed.usage.completion_tokens is None

    # 曾经拿到过 prompt_tokens 后，某一次响应没有 usage 不会清掉已知基数
    kept = make_loop([
        tool_call("echo", {"text": "a"}, id="c1", usage=usage(500, 3)),
        tool_call("echo", {"text": "b"}, id="c2"),
        text("第三"),
    ])
    kept_events = collect(kept.loop)
    kept_methods = [event.context_estimate["method"] for event in kept_events
                    if isinstance(event, TurnEvent) and event.phase == TurnPhase.STARTED]
    assert kept_methods == ["chars", "usage", "usage"]


def test_empty_streamed_reply_is_an_attempt_and_not_in_history():
    h = make_loop([
        ScriptedResponse(content="  ", chunks=[ScriptedChunk(text="  ")], finish_reason="stop"),
        text("好"),
    ], max_retries=2)
    events = collect(h.loop)
    attempt = next(event for event in events if isinstance(event, AttemptEvent))
    assert attempt.reason == AttemptReason.EMPTY and attempt.chars == 2 and attempt.retried is True
    assistant = [message.get("content") for message in memory_messages(h.session) if message.get("role") == "assistant"]
    assert assistant == ["好"]


def test_rebuild_ignores_attempt_events():
    async def scenario():
        h = make_loop([
            ScriptedResponse(
                chunks=[ScriptedChunk(text="半"), ScriptedChunk(tool_index=0, tool_id="c", tool_name="echo",
                                                                tool_arguments="{")],
                interrupted=True,
            ),
            text("完成", usage=usage(15, 2)),
        ], max_retries=2)
        task = input_task()
        active = await start_run(h, task, "读一下")
        await make_runner(h, run=active).invoke(task)
        attempts = [event for event in h.events if isinstance(event, AttemptEvent)]
        assert len(attempts) == 1 and attempts[0].reason == AttemptReason.STREAM_INTERRUPTED
        rebuilt = rebuild_request(h.events, h.runs[active.id], 1)
        assert rebuilt.messages == h.llm.requests[-1].messages
        assert "半" not in json.dumps(rebuilt.messages, ensure_ascii=False)
    run(scenario())


def test_stop_during_stream_persists_cancelled_attempt(monkeypatch):
    monkeypatch.setattr(task_module, "RedisStreamMessageQueue", MemoryQueue)

    async def scenario():
        hold = asyncio.Event()
        h = make_loop([ScriptedResponse(
            content="半截",
            chunks=[ScriptedChunk(text="半截")],
            hold=hold,
        )])
        service = AgentService.__new__(AgentService)
        service._uow_factory = h.loop._uow_factory
        service._uow = service._uow_factory()
        service._ledger = h.ledger
        service._notifier = h.notifier
        task = task_module.RedisStreamTask(None)
        active = await start_run(h, task, "生成中停止")
        runner = make_runner(h, run=active)
        task._task_runner = runner
        service._get_task = AsyncMock(return_value=task)
        await task.invoke()
        for _ in range(50):
            if any(item.delta == "半截" for item in h.notifier.deltas):
                break
            await asyncio.sleep(0.02)
        else:
            raise AssertionError("没有收到文本增量")

        stopped = await service.stop_session(h.session.id)
        assert stopped.status == RunStatus.CANCELLED and stopped.reason == "user_stop"
        with pytest.raises(asyncio.CancelledError):
            await task._execution_task
        attempts = [event for event in h.events if isinstance(event, AttemptEvent)]
        assert len(attempts) == 1
        assert attempts[0].reason == AttemptReason.CANCELLED
        assert attempts[0].chars == 2 and attempts[0].retried is False and attempts[0].attempt == 1
        closing = next(event for event in h.events
                       if isinstance(event, TurnEvent) and event.phase == TurnPhase.COMPLETED)
        assert closing.error == "user_stop" and closing.attempts == 1
        assert closing.ttft_ms is not None
        assert attempts[0].seq < closing.seq
        assistant = [message for message in memory_messages(h.session) if message.get("role") == "assistant"]
        assert assistant == []
        assert h.notifier.deltas[0].turn == 1 and h.notifier.deltas[0].attempt == 1

    run(scenario())


def test_reasoning_chunk_is_not_a_text_delta():
    async def scenario():
        seen = []

        async def on_delta(text):
            seen.append(text)

        llm = ScriptedLLM([
            ScriptedResponse(
                content="好",
                chunks=[ScriptedChunk(reasoning="先想"), ScriptedChunk(text="好")],
                first_chunk_delay=0.02,
            ),
        ])
        result = await llm.invoke([{"role": "user", "content": "hi"}], on_delta=on_delta)
        assert seen == ["好"]
        assert result.ttft_ms is not None and result.ttft_ms >= 15
        assert result.message["content"] == "好"
    run(scenario())


def test_delta_sse_has_no_seq_and_is_not_replayed():
    async def scenario():
        session = Session(id="sse-delta")
        factory = make_uow_factory(session)
        notifier = MemoryNotifier()
        service = AgentService.__new__(AgentService)
        service._uow_factory = factory
        service._uow = factory()
        service._notifier = notifier
        stream = service.stream_events(session.id, after_seq=0)
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0.05)
        await notifier.publish_delta(session.id, "run-1", 3, 2, "你")
        item = await asyncio.wait_for(pending, 2)
        assert isinstance(item, OutputDelta)
        assert (item.turn, item.attempt, item.delta) == (3, 2, "你")

        ledger = RunLedger(factory, notifier)
        active = await ledger.start(session.id)
        await ledger.append(session.id, [MessageEvent(role="assistant", message="你好", attempt=2)], run_id=active.id)
        message = None
        while message is None:
            nxt = await asyncio.wait_for(anext(stream), 2)
            if getattr(nxt, "type", None) == "message":
                message = nxt
        assert message.attempt == 2 and message.seq is not None
        await stream.aclose()

        again = service.stream_events(session.id, after_seq=message.seq)
        late = asyncio.create_task(anext(again))
        await asyncio.sleep(0.15)
        assert late.done() is False
        late.cancel()
        with pytest.raises(asyncio.CancelledError):
            await late
        await again.aclose()

        delta_sse = to_session_sse(OutputDelta(session.id, "run-1", 3, 2, "你"))
        assert delta_sse.event == "delta" and not delta_sse.id
        assert json.loads(delta_sse.data) == {
            "session_id": session.id, "run_id": "run-1", "turn": 3, "attempt": 2, "delta": "你",
        }
        stored = MessageEvent(role="assistant", message="你好", attempt=2)
        stored.seq, stored.run_id = message.seq, active.id
        message_sse = to_session_sse(stored)
        assert message_sse.id == str(message.seq)
        assert json.loads(message_sse.data)["attempt"] == 2
        turn = TurnEvent(phase=TurnPhase.COMPLETED, index=3, model_ms=40, attempts=2, ttft_ms=15,
                         finish_reason="stop")
        turn.seq, turn.run_id = message.seq, active.id
        assert json.loads(to_session_sse(turn).data)["ttft_ms"] == 15
        attempt = AttemptEvent(turn=3, attempt=1, reason=AttemptReason.STREAM_INTERRUPTED, chars=4, retried=True)
        attempt.seq, attempt.run_id = 1, active.id
        body = json.loads(to_session_sse(attempt).data)
        assert body["reason"] == "stream_interrupted" and body["chars"] == 4 and body["retried"] is True
        assert "seq" in body and body["seq"] == 1

    run(scenario())
