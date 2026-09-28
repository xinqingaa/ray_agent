#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""工具策略：按规则表决定调用直接执行、请求批准还是禁止，作为工具管线的执行前处理。

规则键的格式见 ``ToolPolicyConfig``。一次调用按从具体到宽泛的候选键依次查表，第一个命中的规则生效，都未命中为 allow。
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.domain.models.app_config import (
    POLICY_EXEMPT_FUNCTIONS,
    POLICY_EXEMPT_TOOLSETS,
    ToolPolicy,
    ToolPolicyConfig,
)
from app.domain.models.event import ApprovalEvent, ApprovalStatus
from app.domain.models.tool_result import ToolResult
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.browser import BrowserTool
from app.domain.services.tools.deliver import DeliverTool
from app.domain.services.tools.file import FileTool
from app.domain.services.tools.search import SearchTool
from app.domain.services.tools.shell import ShellTool

A2A_CALL_TOOL = "call_remote_agent"

USER_REJECTED = "用户拒绝执行：该调用未执行。不要原样重复提交；可以换一种不需要该操作的做法，或向用户说明。"


def policy_denied_message(function_name: str, rule: Optional[str]) -> str:
    return f"策略禁止：工具策略规则 {rule} 不允许执行 {function_name}，该调用未执行。请换用其他工具，或向用户说明。"


@dataclass
class PolicyMatch:
    policy: ToolPolicy
    rule: Optional[str] = None  # 命中的规则键；未命中或豁免时为空
    service: Optional[str] = None  # MCP 服务名或 A2A 远程 Agent id
    service_tool: Optional[str] = None  # MCP 原始工具名；A2A 为 call_remote_agent


def policy_candidates(
        toolset: str,
        function_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        mcp_route: Optional[Tuple[str, str]] = None,
) -> Tuple[List[str], Optional[str], Optional[str]]:
    """一次调用的候选规则键（从具体到宽泛），以及它指向的服务与服务端工具名。"""
    if toolset == "mcp":
        if mcp_route is None:
            return ["mcp:*"], None, None
        server, original = mcp_route
        return [f"mcp:{server}:{original}", f"mcp:{server}:*", "mcp:*"], server, original
    if toolset == "a2a":
        if function_name != A2A_CALL_TOOL:
            # 只读本地已发现卡片，不接触远程服务
            return [function_name], None, None
        agent_id = str((arguments or {}).get("id") or "")
        if not agent_id:
            return ["a2a:*"], None, A2A_CALL_TOOL
        return [f"a2a:{agent_id}:{A2A_CALL_TOOL}", f"a2a:{agent_id}:*", "a2a:*"], agent_id, A2A_CALL_TOOL
    return [function_name, f"{toolset}:*"], None, None


def builtin_tool_catalog() -> List[Dict[str, Any]]:
    """设置页可配置的内置工具：工具集与函数名。MCP 与 A2A 的服务和工具由各自的列表接口提供。"""
    toolkits = [FileTool(None), ShellTool(None), BrowserTool(None), SearchTool(None), DeliverTool(None)]
    catalog = [{"toolset": t.name, "functions": [s["function"]["name"] for s in t.get_tools()]} for t in toolkits]
    catalog.append({"toolset": A2ATool.name, "functions": [
        s["function"]["name"] for s in A2ATool(None).get_tools() if s["function"]["name"] != A2A_CALL_TOOL]})
    return catalog


def resolve_policy(
        config: ToolPolicyConfig,
        toolset: str,
        function_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        mcp_route: Optional[Tuple[str, str]] = None,
) -> PolicyMatch:
    if toolset in POLICY_EXEMPT_TOOLSETS or function_name in POLICY_EXEMPT_FUNCTIONS:
        return PolicyMatch(ToolPolicy.ALLOW)
    candidates, service, service_tool = policy_candidates(toolset, function_name, arguments, mcp_route)
    for key in candidates:
        if key in config.rules:
            return PolicyMatch(config.rules[key], key, service, service_tool)
    return PolicyMatch(ToolPolicy.ALLOW, None, service, service_tool)


class ToolPolicyGuard:
    """执行前处理：用户拒绝与 deny 短路为失败结果；ask 且本次调用未经批准时挂起并给出审批请求事件。

    批准只对被批准的那一次调用有效（``invocation.approval``）；批准后策略若已改为 deny，仍按 deny 处理。
    """

    def __init__(self, config: Optional[ToolPolicyConfig] = None) -> None:
        self.config = config or ToolPolicyConfig()

    def match(self, invocation: ToolInvocation) -> PolicyMatch:
        route = getattr(invocation.tool, "route", None)
        mcp_route = route(invocation.function_name) if callable(route) else None
        return resolve_policy(self.config, invocation.toolkit_name, invocation.function_name,
                              invocation.arguments, mcp_route)

    async def __call__(self, invocation: ToolInvocation) -> Optional[ToolResult]:
        if invocation.approval == ApprovalStatus.REJECTED.value:
            invocation.denied_by = "user"
            return ToolResult(success=False, message=USER_REJECTED)
        match = self.match(invocation)
        if match.policy == ToolPolicy.DENY:
            invocation.denied_by = "policy"
            return ToolResult(success=False, message=policy_denied_message(invocation.function_name, match.rule))
        if match.policy == ToolPolicy.ASK and invocation.approval != ApprovalStatus.APPROVED.value:
            invocation.suspend_event = ApprovalEvent(
                tool_call_id=invocation.call_id,
                tool_name=invocation.toolkit_name,
                function_name=invocation.function_name,
                function_args=dict(invocation.arguments),
                rule=match.rule,
                service=match.service,
                service_tool=match.service_tool,
            )
        return None
