"""自动压缩的纯函数部分：选择压缩范围、提取用户原文、渲染摘要请求与替换后的消息。

压缩只作用于发给模型的记忆。保留 system 与最近 K 轮原样（一轮 = 一条助手消息及其全部工具结果），
范围边界总是落在某一轮的结束处，调用与结果不会被拆开；最后一轮（其结果正等待模型回复）永远在保留区。
"""
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from app.domain.models.memory import Memory
from app.domain.services.prompts.compact import (
    OMITTED_NOTE,
    SUMMARY_HEADER,
    SUMMARY_MARKER,
    TRANSCRIPT_HEADER,
    TRANSCRIPT_OMITTED,
)
from app.domain.services.tools.message import ASK_USER_TOOL

SYSTEM_NOTICE_PREFIX = "[系统提示]"  # 循环自己写入的 user 角色提示（如截断重试），不是用户原文
ENTRY_MAX_CHARS = 2000  # 摘要请求里单条助手回复或工具结果的最大字符数
USER_ENTRY_MAX_CHARS = 4000  # 摘要请求里单条用户消息的最大字符数
MIN_GAIN_RATIO = 0.15  # 水位触发时，可摘要部分（扣除重新注入的原文）至少占可用上限的比例，否则跳过

Messages = List[Dict[str, Any]]


@dataclass
class CompactionPlan:
    boundary: int  # messages[1:boundary] 进入摘要，messages[boundary:] 原样保留
    summarized_turns: int
    kept_turns: int


@dataclass
class UserOrigin:
    """摘要范围内一条来自用户的原文：普通用户消息，或提问调用的回复。"""
    content: str
    reply: bool = False
    event_seq: Optional[int] = None


@dataclass
class Reinjection:
    messages: Messages = field(default_factory=list)
    event_seqs: List[int] = field(default_factory=list)
    omitted: int = 0


def is_summary_message(message: Dict[str, Any]) -> bool:
    return message.get("role") == "user" and str(message.get("content") or "").startswith(SUMMARY_MARKER)


def plan_compaction(messages: Messages, keep_turns: int, fits: Callable[[Messages], bool]) -> Optional[CompactionPlan]:
    """选择压缩范围；没有可摘要的完整轮次时返回 None。

    从 keep_turns 开始，若保留区本身仍放不进水位（fits 返回 False）就减少保留轮数，最少保留最后一轮。
    """
    rounds = Memory(messages=messages).rounds()
    if len(rounds) < 2:
        return None
    for kept in range(min(keep_turns, len(rounds) - 1), 0, -1):
        boundary = rounds[len(rounds) - kept - 1][1]
        if fits(messages[boundary:]) or kept == 1:
            return CompactionPlan(boundary=boundary, summarized_turns=len(rounds) - kept, kept_turns=kept)
    return None


def _ask_reply(message: Dict[str, Any]) -> Optional[str]:
    if message.get("role") != "tool" or message.get("function_name") != ASK_USER_TOOL:
        return None
    try:
        data = (json.loads(message.get("content") or "{}") or {}).get("data") or {}
    except (TypeError, ValueError):
        return None
    reply = data.get("reply") if isinstance(data, dict) else None
    return reply if isinstance(reply, str) and reply else None


def user_origins(summarized: Messages) -> List[UserOrigin]:
    """摘要范围内来自用户的原文，按时间顺序；排除上一次的摘要消息与循环自己写入的提示。"""
    origins: List[UserOrigin] = []
    for message in summarized:
        if message.get("role") == "user":
            content = str(message.get("content") or "")
            if content and not is_summary_message(message) and not content.startswith(SYSTEM_NOTICE_PREFIX):
                origins.append(UserOrigin(content=content))
            continue
        reply = _ask_reply(message)
        if reply is not None:
            origins.append(UserOrigin(content=reply, reply=True))
    return origins


def match_events(origins: List[UserOrigin], events: Sequence[Tuple[int, str]]) -> None:
    """按时间顺序把原文对应到会话里的用户消息事件。events 为 (seq, 消息文本)；
    记忆里的用户消息可能在文本后附有附件路径清单，所以前缀相同也算对应。"""
    position = 0
    for origin in origins:
        for index in range(position, len(events)):
            seq, text = events[index]
            if text and (origin.content == text or origin.content.startswith(text + "\n\n")):
                origin.event_seq = seq
                position = index + 1
                break


def select_reinjection(origins: List[UserOrigin], max_chars: int) -> Reinjection:
    """从最近的一条往前取，原文总量不超过 max_chars；其余只由摘要覆盖。"""
    chosen: List[UserOrigin] = []
    total = 0
    for origin in reversed(origins):
        if total + len(origin.content) > max_chars:
            break
        chosen.append(origin)
        total += len(origin.content)
    chosen.reverse()
    return Reinjection(
        messages=[{"role": "user", "content": origin.content} for origin in chosen],
        event_seqs=[origin.event_seq for origin in chosen if origin.event_seq is not None],
        omitted=len(origins) - len(chosen),
    )


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = int(limit * 0.75)
    return f"{text[:head]}\n…（省略 {len(text) - limit} 字符）…\n{text[-(limit - head):]}"


def _entry(message: Dict[str, Any]) -> str:
    role = message.get("role")
    content = str(message.get("content") or "")
    if role == "user":
        label = "上一次摘要" if is_summary_message(message) else "用户"
        return f"[{label}]\n{_clip(content, USER_ENTRY_MAX_CHARS * (3 if label == '上一次摘要' else 1))}"
    if role == "assistant":
        lines = [f"[助手]\n{_clip(content, ENTRY_MAX_CHARS)}" if content.strip() else "[助手]"]
        for call in message.get("tool_calls") or []:
            function = call.get("function") or {}
            lines.append(f"调用 {function.get('name', '')}({_clip(str(function.get('arguments', '')), ENTRY_MAX_CHARS)})"
                         f" id={call.get('id', '')}")
        return "\n".join(lines)
    if role == "tool":
        return (f"[工具结果 {message.get('function_name', '')} id={message.get('tool_call_id', '')}]\n"
                f"{_clip(content, ENTRY_MAX_CHARS)}")
    return f"[{role}]\n{_clip(content, ENTRY_MAX_CHARS)}"


def render_transcript(summarized: Messages, fits: Callable[[str], bool]) -> str:
    """摘要请求的用户消息；整体放不进窗口时从最早的记录开始省略（用户原文另行重新注入）。"""
    entries = [_entry(message) for message in summarized]
    for start in range(len(entries)):
        omitted = TRANSCRIPT_OMITTED.format(count=start) if start else ""
        text = TRANSCRIPT_HEADER + omitted + "\n\n".join(entries[start:])
        if fits(text):
            return text
    return TRANSCRIPT_HEADER + TRANSCRIPT_OMITTED.format(count=len(entries) - 1) + entries[-1]


def summary_message(summary: str, summarized_turns: int, omitted: int) -> Dict[str, Any]:
    lines = [SUMMARY_HEADER.format(turns=summarized_turns)]
    if omitted:
        lines.append(OMITTED_NOTE.format(count=omitted))
    lines.append(f"<summary>\n{summary.strip()}\n</summary>")
    return {"role": "user", "content": "\n".join(lines)}
