#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""判断步骤是否只口头完成、没有实际调用工具。"""
from typing import Iterable, Optional, Sequence

NOTIFY_TOOLS = {"message_notify_user", "message_ask_user"}

TOOL_HINTS = (
    "write_file",
    "read_file",
    "replace_in_file",
    "search_in_file",
    "find_files",
    "search_web",
    "browser_",
    "shell",
)

FAKE_TOOL_RETRY_PROMPT = (
    "你刚才没有通过 tool_calls 实际调用工具，只返回了口头结果。"
    "必须先调用工具函数（如 write_file、read_file），等工具返回成功后，再给出 JSON 结果。"
    "不要只声称已写入、已读取或已搜索。attachments 只能填写工具已创建的真实路径。"
)

FAKE_TOOL_ERROR = "步骤声称已完成，但没有实际调用工具，文件未写入沙箱。可在本任务中重试。"
MISSING_ATTACHMENT_ERROR = "声称交付的附件在沙箱中不存在，工具可能未被实际调用。可在本任务中重试。"


def real_tool_names(used_tools: Iterable[str]) -> set[str]:
    return {name for name in used_tools if name and name not in NOTIFY_TOOLS}


def step_requires_tool(description: str, attachments: Optional[Sequence[str]] = None) -> bool:
    if attachments:
        return True
    text = (description or "").lower()
    return any(hint in text for hint in TOOL_HINTS)


def is_fake_step_completion(
        description: str,
        attachments: Optional[Sequence[str]],
        used_tools: Iterable[str],
) -> bool:
    """步骤要求用工具或交出附件，但本轮没有任何实质工具调用。"""
    if not step_requires_tool(description, attachments):
        return False
    return not real_tool_names(used_tools)
