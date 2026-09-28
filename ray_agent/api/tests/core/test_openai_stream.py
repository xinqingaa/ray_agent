"""OpenAI 兼容客户端的流式组装、usage 与 stream_options 回退。不访问网络。"""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from openai import BadRequestError

from app.domain.external.llm import LLMRequestError
from app.domain.models.app_config import LLMConfig
from app.domain.services.flows.agent_loop import normalize_assistant_message
from app.infrastructure.external.llm.openai_llm import OpenAILLM


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=5))


def _usage(prompt, completion, *, cached=None, reasoning=None):
    return SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        prompt_tokens_details=SimpleNamespace(cached_tokens=cached) if cached is not None else None,
        prompt_cache_hit_tokens=None,
        completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning) if reasoning is not None else None,
    )


def _chunk(*, content=None, reasoning=None, tool_calls=None, finish_reason=None, usage=None, choices=None):
    if choices is None:
        delta = SimpleNamespace(content=content, reasoning_content=reasoning, tool_calls=tool_calls)
        choices = [SimpleNamespace(delta=delta, finish_reason=finish_reason)]
    return SimpleNamespace(choices=choices, usage=usage)


def _tool(index, *, call_id=None, name=None, arguments=None):
    return SimpleNamespace(
        index=index,
        id=call_id,
        type="function",
        function=SimpleNamespace(name=name, arguments=arguments),
    )


class _ListStream:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)

    async def aclose(self):
        self.closed = True


class _HangStream:
    def __init__(self):
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(5)
        raise StopAsyncIteration

    async def aclose(self):
        self.closed = True


class _Completions:
    def __init__(self, items):
        self.items = list(items)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        if kwargs.get("stream"):
            return item if not isinstance(item, list) else _ListStream(item)
        return item


def _llm(items, *, streaming=True, timeout=30.0):
    llm = OpenAILLM(LLMConfig(
        base_url="https://example.test/v1",
        api_key="test-key",
        model_name="fake",
        streaming=streaming,
        request_timeout=timeout,
    ))
    completions = _Completions(items)
    llm._client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return llm, completions


def _rejected(message, status=400):
    request = httpx.Request("POST", "http://llm.test/chat/completions")
    return BadRequestError(message, response=httpx.Response(status, request=request), body={"message": message})


def test_interleaved_text_reasoning_and_tool_fragments_match_a_whole_message():
    chunks = [
        _chunk(reasoning="先"),
        _chunk(content="请"),
        _chunk(tool_calls=[_tool(0, call_id="call_a", name="echo", arguments='{"te')]),
        _chunk(reasoning="想"),
        _chunk(content="帮"),
        _chunk(tool_calls=[_tool(1, call_id="call_b", name="read_file", arguments='{"path":')]),
        _chunk(tool_calls=[_tool(0, arguments='xt":"hi"}')]),
        _chunk(tool_calls=[_tool(1, arguments='"/a.txt"}')]),
        _chunk(finish_reason="tool_calls"),
        _chunk(choices=[], usage=_usage(11, 4, cached=2, reasoning=3)),
    ]
    llm, completions = _llm([chunks])
    deltas = []

    async def on_delta(text):
        deltas.append(text)

    result = run(llm.invoke([{"role": "user", "content": "hi"}], tools=[{"type": "function"}], on_delta=on_delta))

    assert deltas == ["请", "帮"]
    assert result.finish_reason == "tool_calls"
    assert result.ttft_ms is not None and result.ttft_ms >= 0
    assert (result.usage.prompt_tokens, result.usage.completion_tokens) == (11, 4)
    assert (result.usage.cached_tokens, result.usage.reasoning_tokens) == (2, 3)
    assert result.message["content"] == "请帮"
    assert result.message["reasoning_content"] == "先想"
    assert result.message["tool_calls"] == [
        {"id": "call_a", "type": "function", "function": {"name": "echo", "arguments": '{"text":"hi"}'}},
        {"id": "call_b", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"/a.txt"}'}},
    ]
    sent = completions.calls[0]
    assert sent["stream"] is True
    assert sent["stream_options"] == {"include_usage": True}
    assert sent["parallel_tool_calls"] is False


def test_embedded_tool_use_is_parsed_after_the_text_is_assembled():
    raw = json.dumps({
        "type": "tool_use", "name": "echo", "id": "1", "input": {"text": "hi"},
    }, ensure_ascii=False)
    mid = len(raw) // 2
    llm, _ = _llm([[
        _chunk(content=raw[:mid]),
        _chunk(content=raw[mid:], finish_reason="stop"),
    ]])
    result = run(llm.invoke([{"role": "user", "content": "hi"}]))
    assert result.message["content"] == raw
    normalized = normalize_assistant_message(result.message)
    assert normalized["content"] is None
    assert normalized["tool_calls"][0]["id"] == "1"
    assert json.loads(normalized["tool_calls"][0]["function"]["arguments"]) == {"text": "hi"}


def test_usage_on_the_last_chunk_is_kept_and_missing_usage_is_none():
    llm, _ = _llm([
        [
            _chunk(content="好", finish_reason="stop"),
            _chunk(choices=[], usage=_usage(9, 1)),
        ],
        [_chunk(content="无", finish_reason="stop")],
    ])
    with_usage = run(llm.invoke([{"role": "user", "content": "a"}]))
    without = run(llm.invoke([{"role": "user", "content": "b"}]))
    assert (with_usage.usage.prompt_tokens, with_usage.usage.completion_tokens) == (9, 1)
    assert without.usage is None
    assert without.finish_reason == "stop"


def test_stream_without_finish_reason_is_retryable_and_closes():
    stream_chunks = [_chunk(content="半", tool_calls=[_tool(0, call_id="c", name="echo", arguments='{"')])]
    llm, completions = _llm([stream_chunks])
    with pytest.raises(LLMRequestError) as caught:
        run(llm.invoke([{"role": "user", "content": "a"}]))
    assert caught.value.retryable and caught.value.reason == "stream_interrupted"
    assert completions.calls[0]["stream"] is True


def test_provider_rejecting_stream_options_retries_once_and_remembers():
    ok = [_chunk(content="好", finish_reason="stop", usage=_usage(2, 1))]
    llm, completions = _llm([
        _rejected("Unrecognized request argument supplied: stream_options"),
        ok,
        [_chunk(content="再", finish_reason="stop", usage=_usage(3, 1))],
    ])
    first = run(llm.invoke([{"role": "user", "content": "a"}]))
    second = run(llm.invoke([{"role": "user", "content": "b"}]))
    assert first.message["content"] == "好" and second.message["content"] == "再"
    assert "stream_options" in completions.calls[0]
    assert "stream_options" not in completions.calls[1]
    assert "stream_options" not in completions.calls[2]
    assert llm._include_stream_usage is False


def test_unrelated_400_does_not_drop_stream_options():
    llm, completions = _llm([_rejected("Invalid parameter: temperature")])
    with pytest.raises(LLMRequestError) as caught:
        run(llm.invoke([{"role": "user", "content": "a"}]))
    assert caught.value.retryable is False
    assert llm._include_stream_usage is True
    assert len(completions.calls) == 1


def test_context_length_400_is_not_treated_as_stream_options():
    llm, completions = _llm([_rejected("This model's maximum context length is 65536 tokens")])
    with pytest.raises(LLMRequestError) as caught:
        run(llm.invoke([{"role": "user", "content": "a"}]))
    assert caught.value.context_exceeded is True
    assert llm._include_stream_usage is True
    assert len(completions.calls) == 1


def test_chunk_gap_timeout_is_retryable():
    hang = _HangStream()
    llm, _ = _llm([hang], timeout=0.05)
    with pytest.raises(LLMRequestError) as caught:
        run(llm.invoke([{"role": "user", "content": "a"}]))
    assert caught.value.retryable and caught.value.reason == "transport"
    assert hang.closed is True


def test_non_streaming_path_keeps_whole_response_and_empty_ttft():
    message = {
        "role": "assistant",
        "content": "整包",
        "reasoning_content": "想过",
        "tool_calls": None,
    }
    completion = SimpleNamespace(
        choices=[SimpleNamespace(
            message=SimpleNamespace(content="整包", tool_calls=None, model_dump=lambda: message),
            finish_reason="stop",
        )],
        usage=_usage(5, 2),
        model_dump=lambda: {"whole": True},
    )
    llm, completions = _llm([completion], streaming=False)
    deltas = []
    result = run(llm.invoke(
        [{"role": "user", "content": "a"}],
        on_delta=lambda text: deltas.append(text) or asyncio.sleep(0),
    ))
    assert deltas == []
    assert result.ttft_ms is None
    assert result.message["reasoning_content"] == "想过"
    assert result.usage.prompt_tokens == 5
    assert "stream" not in completions.calls[0]
    assert completions.calls[0]["timeout"] == 30.0
