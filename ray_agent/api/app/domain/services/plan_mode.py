#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""计划模式的执行前处理：按允许清单放行只读工具，其余调用短路为失败结果，不执行、不进入审批。

按允许清单而不是禁止清单实现，以后新增的工具（包括新接入的 MCP 工具）默认不能在计划模式下执行。
清单按“函数名 → 工具集”配对，MCP 别名即使与内置函数同名也不会被放行。Shell 全部禁止，不看命令内容。
"""
from typing import Dict, Optional

from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.tool_pipeline import ToolInvocation

PLAN_MODE_ALLOWED: Dict[str, str] = {
    "read_file": "file",
    "search_in_file": "file",
    "find_files": "file",
    "search_web": "search",
    "web_fetch": "web",
    "browser_view": "browser",
    "browser_console_view": "browser",
    "browser_tabs": "browser",
    "update_plan": "plan",
    "message_ask_user": "message",
    "get_remote_agent_cards": "a2a",  # 只读本地已发现的卡片，不联系远端
}

PLAN_MODE_DENIED_PREFIX = "计划模式下不执行"


def plan_mode_denied_message(function_name: str) -> str:
    return (f"{PLAN_MODE_DENIED_PREFIX}：{function_name} 可能产生副作用，本次运行只允许只读调研，该调用未执行。"
            "不要换用其他工具绕过；请用 update_plan 写出计划并在回复中说明，用户确认后会以普通模式执行。")


class PlanModeGuard:
    """注册在 ToolPolicyGuard 之前，使被拒绝的调用不会触发审批。enabled 由循环按运行模式设置。"""

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled

    async def __call__(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if not self.enabled:
            return None
        if PLAN_MODE_ALLOWED.get(invocation.function_name) == invocation.toolkit_name:
            return None
        invocation.denied_by = "plan_mode"
        return ToolResult(success=False, message=plan_mode_denied_message(invocation.function_name))
