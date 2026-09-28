#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 OpenAI 兼容响应中读取 usage。"""
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


def parse_completion_usage(usage: Any) -> Optional[LLMUsage]:
    """读取 Chat Completions 的 usage；没有可解析字段时返回 None。"""
    if usage is None:
        return None
    cached = _int_or_none(_field(_field(usage, "prompt_tokens_details"), "cached_tokens"))
    if cached is None:
        cached = _int_or_none(_field(usage, "prompt_cache_hit_tokens"))
    parsed = LLMUsage(
        prompt_tokens=_int_or_none(_field(usage, "prompt_tokens")),
        completion_tokens=_int_or_none(_field(usage, "completion_tokens")),
        total_tokens=_int_or_none(_field(usage, "total_tokens")),
        cached_tokens=cached,
        reasoning_tokens=_int_or_none(_field(_field(usage, "completion_tokens_details"), "reasoning_tokens")),
    )
    return parsed if parsed.available else None
