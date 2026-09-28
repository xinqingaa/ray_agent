#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模型 usage 解析与轮次事件的用量投影。"""
from types import SimpleNamespace

from pydantic import TypeAdapter

from app.domain.models.event import Event, TurnEvent, TurnUsage
from app.infrastructure.external.llm.usage import parse_completion_usage
from app.interfaces.schemas.event import EventMapper


def test_parse_completion_usage_from_object_and_dict():
    parsed = parse_completion_usage(SimpleNamespace(
        prompt_tokens=10,
        completion_tokens=4,
        total_tokens=14,
    ))
    assert parsed is not None
    assert parsed.prompt_tokens == 10
    assert parsed.completion_tokens == 4
    assert parsed.total_tokens == 14
    assert parsed.available
    assert parsed.cached_tokens is None and parsed.reasoning_tokens is None

    parsed_dict = parse_completion_usage({
        "prompt_tokens": 3,
        "completion_tokens": 1,
        "total_tokens": 4,
    })
    assert parsed_dict is not None
    assert parsed_dict.resolved_total == 4


def test_parse_cached_and_reasoning_tokens():
    openai_style = parse_completion_usage({
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "prompt_tokens_details": {"cached_tokens": 64},
        "completion_tokens_details": {"reasoning_tokens": 12},
    })
    assert (openai_style.cached_tokens, openai_style.reasoning_tokens) == (64, 12)
    deepseek_style = parse_completion_usage(SimpleNamespace(
        prompt_tokens=100, completion_tokens=20, total_tokens=120,
        prompt_tokens_details=None, prompt_cache_hit_tokens=80,
    ))
    assert deepseek_style.cached_tokens == 80


def test_parse_completion_usage_missing_is_none():
    assert parse_completion_usage(None) is None
    assert parse_completion_usage({}) is None
    assert parse_completion_usage(SimpleNamespace(prompt_tokens=None)) is None


def test_turn_event_round_trips_and_projects_usage():
    event = TurnEvent(phase="completed", index=2, model_ms=35, attempts=2, finish_reason="stop",
                      usage=TurnUsage(prompt_tokens=12, completion_tokens=3, cached_tokens=8),
                      tool_call_ids=["c-1"], tools_ms=4)
    event.seq, event.run_id = 9, "run-1"
    parsed = TypeAdapter(Event).validate_json(event.model_dump_json())
    assert isinstance(parsed, TurnEvent) and parsed.usage.cached_tokens == 8
    sse = EventMapper.event_to_sse_event(parsed)
    assert sse.event == "turn"
    data = sse.data.model_dump(mode="json")
    assert (data["seq"], data["run_id"], data["index"], data["attempts"]) == (9, "run-1", 2, 2)
    assert data["usage"]["prompt_tokens"] == 12 and data["tool_call_ids"] == ["c-1"]
    assert isinstance(data["created_at"], int) and data["created_at"] > 10 ** 12
