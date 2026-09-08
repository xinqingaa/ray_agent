#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""content 内嵌 tool_use 的兼容转换。"""
import json

from app.domain.services.agents.tool_call_compat import extract_embedded_tool_calls


def test_keeps_existing_tool_calls():
    message = {
        "role": "assistant",
        "content": None,
        "tool_calls": [{"id": "1", "type": "function", "function": {"name": "search_web", "arguments": "{}"}}],
    }
    assert extract_embedded_tool_calls(message)["tool_calls"][0]["id"] == "1"


def test_converts_anthropic_tool_use_list():
    message = {
        "role": "assistant",
        "content": json.dumps([{
            "type": "tool_use",
            "name": "search_web",
            "id": "toolu_1",
            "input": {"query": "Flutter state management", "date_range": "all"},
        }]),
        "tool_calls": None,
    }
    result = extract_embedded_tool_calls(message)
    assert result["content"] is None
    assert result["tool_calls"][0]["function"]["name"] == "search_web"
    args = json.loads(result["tool_calls"][0]["function"]["arguments"])
    assert args["query"] == "Flutter state management"


def test_leaves_plain_step_json_unchanged():
    content = '{"success": true, "result": "ok", "attachments": []}'
    message = {"role": "assistant", "content": content, "tool_calls": None}
    result = extract_embedded_tool_calls(message)
    assert result["content"] == content
    assert not result.get("tool_calls")
