#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模型请求预算的阶段：按已用请求数先提醒收敛，最后一段只允许核对、交付与结束。

预算从最近一条用户消息起算（新消息、运行中补充的消息与提问回复都重新计算），审批续接沿用审批前的计数。
上限小于 MIN_PHASED_LIMIT 时不分阶段，只保留到达上限即失败的保护。
"""
import math
from enum import Enum
from typing import Dict, Optional

from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.tool_pipeline import ToolInvocation

MIN_PHASED_LIMIT = 10
REMIND_RATIO = 0.7
FINALIZE_RATIO = 0.1
MIN_FINALIZE_RESERVE = 2

BUDGET_NOTICE_PREFIX = "[运行预算]"
BUDGET_FINALIZE_MARK = "已进入收尾"
BUDGET_DENIED_PREFIX = "收尾阶段不执行"

FINALIZE_ALLOWED: Dict[str, str] = {
    "read_file": "file",
    "search_in_file": "file",
    "find_files": "file",
    "deliver_files": "deliver",
    "update_plan": "plan",
}


class BudgetPhase(str, Enum):
    NORMAL = "normal"
    REMIND = "remind"
    FINALIZE = "finalize"


def finalize_reserve(limit: int) -> int:
    return max(MIN_FINALIZE_RESERVE, math.ceil(limit * FINALIZE_RATIO))


def budget_phase(used: int, limit: int) -> BudgetPhase:
    if limit < MIN_PHASED_LIMIT:
        return BudgetPhase.NORMAL
    if used >= limit - finalize_reserve(limit):
        return BudgetPhase.FINALIZE
    if used >= math.floor(limit * REMIND_RATIO):
        return BudgetPhase.REMIND
    return BudgetPhase.NORMAL


def budget_notice(phase: BudgetPhase, used: int, limit: int, plan_mode: bool = False) -> Optional[str]:
    if phase == BudgetPhase.REMIND:
        return (f"{BUDGET_NOTICE_PREFIX} 本次运行已使用 {used}/{limit} 次模型请求。请判断主要成果是否已经可用："
                "已可用就先交付，剩余预算只用于必要修复，不要开始新的可选扩展。")
    if phase == BudgetPhase.FINALIZE:
        allowed = "读取文件和更新计划" if plan_mode else "读取文件、交付文件和更新计划"
        goal = "给出计划与说明" if plan_mode else "交付已有成果并给出最终答复"
        return (f"{BUDGET_NOTICE_PREFIX} 剩余 {max(0, limit - used)} 次模型请求，{BUDGET_FINALIZE_MARK}：只能{allowed}，"
                f"其他工具会被拒绝。请{goal}，说明已验证的内容和未完成的部分。")
    return None


def noticed_phase(content: str) -> Optional[BudgetPhase]:
    """记忆中一条 user 消息若是预算提示，返回它对应的阶段。"""
    if not content.startswith(BUDGET_NOTICE_PREFIX):
        return None
    return BudgetPhase.FINALIZE if BUDGET_FINALIZE_MARK in content else BudgetPhase.REMIND


def budget_denied_message(function_name: str) -> str:
    return (f"{BUDGET_DENIED_PREFIX}：模型请求预算即将用完，{function_name} 未执行。"
            "不要换用其他工具绕过；请交付已有成果并给出最终答复，说明未完成的部分。")


class FinalizeGuard:
    """收尾阶段的执行前处理，注册在计划模式检查之后、策略检查之前；enabled 由循环按预算阶段设置。"""

    def __init__(self) -> None:
        self.enabled = False

    async def __call__(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if not self.enabled:
            return None
        if FINALIZE_ALLOWED.get(invocation.function_name) == invocation.toolkit_name:
            return None
        invocation.denied_by = "budget"
        return ToolResult(success=False, message=budget_denied_message(invocation.function_name))
