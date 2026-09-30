"""请求容量估算。

每次模型请求前估算输入量：上一次响应的 ``prompt_tokens`` 作为已知部分，加上其后新增消息与工具 schema 变化的
字符估算；没有 usage（或记忆被替换、裁剪过）时全部按字符估算。估算按来源分为系统提示词、工具 schema、
对话历史、工具结果四部分，四部分之和就是总估算值。

可用输入上限 = context_window − max_tokens − 安全余量（窗口 × safety_ratio）；压缩水位 = 上限 × watermark_ratio。
"""
import json
import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# 字符到 token 的系数：中日韩字符约 0.6–0.7 token/字，其余（英文、数字、标点、JSON）约 4 字符/token。取偏高值，宁可早压缩
CJK_TOKENS_PER_CHAR = 0.7
OTHER_TOKENS_PER_CHAR = 0.3
MESSAGE_OVERHEAD_TOKENS = 4  # 每条消息的角色与分隔开销

PARTS = ("system_prompt", "tools", "history", "tool_results")


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return (0x3000 <= code <= 0x9FFF or 0xAC00 <= code <= 0xD7AF
            or 0xF900 <= code <= 0xFAFF or 0xFF00 <= code <= 0xFFEF)


def estimate_text(text: str) -> float:
    if not text:
        return 0.0
    cjk = sum(1 for char in text if _is_cjk(char))
    return cjk * CJK_TOKENS_PER_CHAR + (len(text) - cjk) * OTHER_TOKENS_PER_CHAR


def _message_text(message: Dict[str, Any]) -> str:
    parts: List[str] = []
    content = message.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        parts.extend(str(item.get("text", "")) if isinstance(item, dict) else str(item) for item in content)
    if message.get("reasoning_content"):
        parts.append(str(message["reasoning_content"]))
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        parts.append(str(function.get("name", "")))
        parts.append(str(function.get("arguments", "")))
    return "".join(parts)


def estimate_message(message: Dict[str, Any]) -> float:
    return estimate_text(_message_text(message)) + MESSAGE_OVERHEAD_TOKENS


def estimate_tools(tools: Optional[List[Dict[str, Any]]]) -> float:
    return estimate_text(json.dumps(tools or [], ensure_ascii=False))


def _part_of(message: Dict[str, Any]) -> str:
    role = message.get("role")
    if role == "system":
        return "system_prompt"
    if role == "tool":
        return "tool_results"
    return "history"


def raw_parts(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]]) -> Dict[str, float]:
    """按字符估算的四部分（未取整）。"""
    parts = {name: 0.0 for name in PARTS}
    parts["tools"] = estimate_tools(tools)
    for message in messages:
        parts[_part_of(message)] += estimate_message(message)
    return parts


@dataclass
class ContextEstimate:
    system_prompt: int
    tools: int
    history: int
    tool_results: int
    limit: int  # 可用输入上限
    watermark: int  # 压缩水位
    context_window: int
    max_tokens: int
    method: str  # usage：以上次 prompt_tokens 为已知部分；chars：全部按字符估算

    @property
    def total(self) -> int:
        return self.system_prompt + self.tools + self.history + self.tool_results

    @property
    def over_watermark(self) -> bool:
        return self.total > self.watermark

    @property
    def over_limit(self) -> bool:
        return self.total > self.limit

    def as_dict(self) -> Dict[str, Any]:
        return {
            "system_prompt": self.system_prompt,
            "tools": self.tools,
            "history": self.history,
            "tool_results": self.tool_results,
            "total": self.total,
            "limit": self.limit,
            "watermark": self.watermark,
            "context_window": self.context_window,
            "max_tokens": self.max_tokens,
            "method": self.method,
        }


@dataclass
class _UsageBase:
    prompt_tokens: int
    message_count: int
    parts: Dict[str, float]  # 那次请求按字符估算的四部分，用来把 prompt_tokens 按比例分摊


class ContextBudget:
    """一个 Agent 循环实例的容量估算器；记忆被替换或裁剪后调用 reset，下一次改为全部按字符估算。"""

    def __init__(self, context_window: int, max_tokens: int, safety_ratio: float, watermark_ratio: float) -> None:
        self.context_window = context_window
        self.max_tokens = max_tokens
        self.limit = context_window - max_tokens - math.ceil(context_window * safety_ratio)
        self.watermark = int(max(self.limit, 0) * watermark_ratio)
        self._base: Optional[_UsageBase] = None

    def reset(self) -> None:
        self._base = None

    def record_usage(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]],
                     prompt_tokens: Optional[int]) -> None:
        """模型返回 usage 后记下这次请求的实际输入量，作为下一次估算的已知部分。"""
        if not prompt_tokens:
            return
        self._base = _UsageBase(prompt_tokens=prompt_tokens, message_count=len(messages),
                                parts=raw_parts(messages, tools))

    def estimate(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]]) -> ContextEstimate:
        base = self._base if self._base is not None and self._base.message_count <= len(messages) else None
        if base is None:
            parts = raw_parts(messages, tools)
            method = "chars"
        else:
            known = sum(base.parts.values())
            factor = base.prompt_tokens / known if known > 0 else 1.0
            added = raw_parts(messages[base.message_count:], None)
            parts = {name: base.parts[name] * factor + added[name] for name in PARTS}
            parts["tools"] += estimate_tools(tools) - base.parts["tools"]
            method = "usage"
        return ContextEstimate(
            **{name: max(0, round(parts[name])) for name in PARTS},
            limit=self.limit,
            watermark=self.watermark,
            context_window=self.context_window,
            max_tokens=self.max_tokens,
            method=method,
        )


FIXED_INPUT_GUIDANCE = "项目说明/笔记等固定输入超过容量，压缩历史无法解决；请精简项目说明、笔记或调整模型窗口"

def fixed_input_estimate(budget: ContextBudget, messages: List[Dict[str, Any]],
                         tools: Optional[List[Dict[str, Any]]]) -> ContextEstimate:
    """固定输入使用字符预算，不用上一请求 usage 校准掩盖新配置的容量。"""
    fresh = ContextBudget(budget.context_window, budget.max_tokens, 0, 0)
    fresh.limit, fresh.watermark = budget.limit, budget.watermark
    return fresh.estimate([m for m in messages if m.get("role") == "system"], tools)
