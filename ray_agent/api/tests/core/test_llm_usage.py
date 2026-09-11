#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模型 usage 解析与会话累计。"""
from types import SimpleNamespace

from pydantic import TypeAdapter

from app.domain.models.event import Event, MessageEvent, UsageEvent
from app.domain.models.token_usage import apply_usage_call, stamp_usage_event, totals_from_events
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

    parsed_dict = parse_completion_usage({
        "prompt_tokens": 3,
        "completion_tokens": 1,
        "total_tokens": 4,
    })
    assert parsed_dict is not None
    assert parsed_dict.resolved_total == 4


def test_parse_completion_usage_missing_is_none():
    assert parse_completion_usage(None) is None
    assert parse_completion_usage({}) is None
    assert parse_completion_usage(SimpleNamespace(prompt_tokens=None)) is None


def test_totals_from_events_resets_turn_on_user_message():
    events = [
        UsageEvent(agent="planner", available=True, prompt_tokens=5, completion_tokens=2, total_tokens=7),
        MessageEvent(role="user", message="下一轮"),
        UsageEvent(agent="react", available=True, prompt_tokens=8, completion_tokens=1, total_tokens=9),
    ]
    totals = totals_from_events(events)
    assert totals.session_total_tokens == 16
    assert totals.turn_total_tokens == 9
    assert totals.session_prompt_tokens == 13
    assert totals.turn_prompt_tokens == 8


def test_unavailable_usage_does_not_increase_totals():
    event = UsageEvent(agent="react", available=False, context_window=65536)
    totals = totals_from_events([event])
    assert totals.session_total_tokens == 0
    stamped = stamp_usage_event(event, totals)
    assert stamped.session_total_tokens == 0
    assert stamped.available is False


def test_apply_usage_falls_back_to_prompt_plus_completion():
    event = UsageEvent(
        agent="planner",
        available=True,
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=None,
    )
    totals = totals_from_events([])
    apply_usage_call(totals, event)
    assert totals.session_total_tokens == 15


def test_event_mapper_maps_usage_event():
    EventMapper._cache_mapping = None
    event = UsageEvent(
        agent="react",
        available=True,
        prompt_tokens=12,
        completion_tokens=3,
        total_tokens=15,
        session_prompt_tokens=12,
        session_completion_tokens=3,
        session_total_tokens=15,
        turn_prompt_tokens=12,
        turn_completion_tokens=3,
        turn_total_tokens=15,
        context_window=65536,
    )
    sse = EventMapper.event_to_sse_event(event)
    assert sse.event == "usage"
    assert sse.data.agent == "react"
    assert sse.data.available is True
    assert sse.data.prompt_tokens == 12
    assert sse.data.session_total_tokens == 15
    assert sse.data.context_window == 65536


def test_usage_event_json_roundtrip():
    event = UsageEvent(
        agent="planner",
        available=True,
        prompt_tokens=4,
        completion_tokens=1,
        total_tokens=5,
        session_total_tokens=5,
        turn_total_tokens=5,
        context_window=65536,
    )
    parsed = TypeAdapter(Event).validate_json(event.model_dump_json())
    assert isinstance(parsed, UsageEvent)
    assert parsed.agent == "planner"
    assert parsed.prompt_tokens == 4
    assert parsed.session_total_tokens == 5
