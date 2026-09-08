#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把写进 content 的非 OpenAI 工具调用，转成 SDK 使用的 tool_calls。"""
import json
import logging
import uuid
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _as_items(parsed: Any) -> List[Dict[str, Any]]:
    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    if isinstance(parsed, dict):
        return [parsed]
    return []


def _tool_call_from_tool_use(item: Dict[str, Any]) -> Dict[str, Any] | None:
    if item.get("type") != "tool_use" or not item.get("name"):
        return None
    return {
        "id": item.get("id") or str(uuid.uuid4()),
        "type": "function",
        "function": {
            "name": item["name"],
            "arguments": json.dumps(item.get("input") or {}, ensure_ascii=False),
        },
    }


def extract_embedded_tool_calls(message: Dict[str, Any]) -> Dict[str, Any]:
    """若 content 是 Anthropic 风格 tool_use JSON，则补上 tool_calls。"""
    if message.get("tool_calls"):
        return message

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        return message

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return message

    tool_calls = []
    for item in _as_items(parsed):
        converted = _tool_call_from_tool_use(item)
        if converted:
            tool_calls.append(converted)

    if not tool_calls:
        return message

    logger.info(f"将 content 中的 tool_use 转为 {len(tool_calls)} 个 tool_calls")
    normalized = dict(message)
    normalized["tool_calls"] = tool_calls
    normalized["content"] = None
    return normalized
