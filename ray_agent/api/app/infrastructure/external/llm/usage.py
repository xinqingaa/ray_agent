#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 OpenAI Chat Completions 与 Responses 兼容响应中读取 usage。"""
from typing import Any, Optional

from app.domain.models.llm import LLMUsage


def _int_or_none(value: Any) -> Optional[int]:
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _field(source: Any, name: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def _first_int(*values: Any) -> Optional[int]:
    for value in values:
        parsed = _int_or_none(value)
        if parsed is not None:
            return parsed
    return None


def _parse_usage(usage: Any, *, prefer_responses: bool) -> Optional[LLMUsage]:
    if usage is None:
        return None
    in_details = _field(usage, "input_tokens_details")
    prompt_details = _field(usage, "prompt_tokens_details")
    out_details = _field(usage, "output_tokens_details")
    comp_details = _field(usage, "completion_tokens_details")
    write_details = _field(in_details, "cache_write_details") or _field(prompt_details, "cache_write_details")

    prompt = (
        _first_int(_field(usage, "input_tokens"), _field(usage, "prompt_tokens"))
        if prefer_responses
        else _first_int(_field(usage, "prompt_tokens"), _field(usage, "input_tokens"))
    )
    completion = (
        _first_int(_field(usage, "output_tokens"), _field(usage, "completion_tokens"))
        if prefer_responses
        else _first_int(_field(usage, "completion_tokens"), _field(usage, "output_tokens"))
    )
    cached = _first_int(
        _field(in_details, "cached_tokens"),
        _field(prompt_details, "cached_tokens"),
        _field(usage, "prompt_cache_hit_tokens"),
    )
    reasoning = _first_int(
        _field(out_details, "reasoning_tokens"),
        _field(comp_details, "reasoning_tokens"),
    )
    cache_write = _first_int(
        _field(in_details, "cache_write_tokens"),
        _field(prompt_details, "cache_write_tokens"),
        _field(usage, "cache_creation_input_tokens"),
    )
    cache_write_30m = _first_int(
        _field(write_details, "ttl_30m_tokens"),
        _field(in_details, "ttl_30m_tokens"),
    )
    cache_write_12h = _first_int(
        _field(write_details, "ttl_12h_tokens"),
        _field(in_details, "ttl_12h_tokens"),
    )
    if cache_write is None and (cache_write_30m is not None or cache_write_12h is not None):
        cache_write = (cache_write_30m or 0) + (cache_write_12h or 0)

    parsed = LLMUsage(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=_int_or_none(_field(usage, "total_tokens")),
        cached_tokens=cached,
        cache_write_tokens=cache_write,
        cache_write_30m_tokens=cache_write_30m,
        cache_write_12h_tokens=cache_write_12h,
        reasoning_tokens=reasoning,
    )
    return parsed if parsed.available else None


def parse_completion_usage(usage: Any) -> Optional[LLMUsage]:
    """读取 Chat Completions 的 usage（兼容 Responses/Anthropic 字段别名）；没有可解析字段时返回 None。"""
    return _parse_usage(usage, prefer_responses=False)


def parse_response_usage(usage: Any) -> Optional[LLMUsage]:
    """读取 Responses API 的 usage（兼容 Chat Completions 字段别名与 cache_write_tokens）；没有可解析字段时返回 None。"""
    return _parse_usage(usage, prefer_responses=True)
