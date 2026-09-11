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


def parse_completion_usage(usage: Any) -> Optional[LLMUsage]:
    """读取 Chat Completions 的 usage；没有可解析字段时返回 None。"""
    if usage is None:
        return None
    if isinstance(usage, dict):
        prompt = _int_or_none(usage.get("prompt_tokens"))
        completion = _int_or_none(usage.get("completion_tokens"))
        total = _int_or_none(usage.get("total_tokens"))
    else:
        prompt = _int_or_none(getattr(usage, "prompt_tokens", None))
        completion = _int_or_none(getattr(usage, "completion_tokens", None))
        total = _int_or_none(getattr(usage, "total_tokens", None))
    parsed = LLMUsage(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
    )
    return parsed if parsed.available else None
