#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""会话与本轮 token 累计，供任务运行器记账。"""
from dataclasses import dataclass
from typing import Iterable

from .event import Event, MessageEvent, UsageEvent


@dataclass
class TokenUsageTotals:
    session_prompt_tokens: int = 0
    session_completion_tokens: int = 0
    session_total_tokens: int = 0
    turn_prompt_tokens: int = 0
    turn_completion_tokens: int = 0
    turn_total_tokens: int = 0


def reset_turn(totals: TokenUsageTotals) -> None:
    totals.turn_prompt_tokens = 0
    totals.turn_completion_tokens = 0
    totals.turn_total_tokens = 0


def apply_usage_call(totals: TokenUsageTotals, event: UsageEvent) -> None:
    """按单次调用的 token 累加会话与本轮合计。未返回用量时不加。"""
    if not event.available:
        return
    call_total = event.total_tokens
    if call_total is None:
        call_total = (event.prompt_tokens or 0) + (event.completion_tokens or 0)
    prompt = event.prompt_tokens or 0
    completion = event.completion_tokens or 0
    totals.session_prompt_tokens += prompt
    totals.session_completion_tokens += completion
    totals.session_total_tokens += call_total
    totals.turn_prompt_tokens += prompt
    totals.turn_completion_tokens += completion
    totals.turn_total_tokens += call_total


def stamp_usage_event(event: UsageEvent, totals: TokenUsageTotals) -> UsageEvent:
    return event.model_copy(update={
        "session_prompt_tokens": totals.session_prompt_tokens,
        "session_completion_tokens": totals.session_completion_tokens,
        "session_total_tokens": totals.session_total_tokens,
        "turn_prompt_tokens": totals.turn_prompt_tokens,
        "turn_completion_tokens": totals.turn_completion_tokens,
        "turn_total_tokens": totals.turn_total_tokens,
    })


def totals_from_events(events: Iterable[Event]) -> TokenUsageTotals:
    """从已持久化事件重建累计。遇到用户消息则本轮清零。"""
    totals = TokenUsageTotals()
    for event in events:
        if isinstance(event, MessageEvent) and event.role == "user":
            reset_turn(totals)
        elif isinstance(event, UsageEvent):
            apply_usage_call(totals, event)
    return totals
