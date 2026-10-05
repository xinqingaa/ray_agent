#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""可选模型目录。页面只显示并保存厂商的请求 id 与思考参数原词。"""
from dataclasses import dataclass
from typing import Callable, Literal, Optional
from urllib.parse import urlparse

from app.domain.models.app_config import LLMConfig


Replay = Literal["current_turn", "all_turns"]


@dataclass(frozen=True)
class ReasoningChoice:
    """一次请求的思考参数。id 是菜单和会话里保存的原词。"""
    id: str
    thinking: Literal["enabled", "disabled"]
    effort: Optional[str]  # reasoning_effort；关闭思考时不发送
    replay: Replay


@dataclass(frozen=True)
class ModelSpec:
    id: str
    provider: str
    context_window: int
    max_output: int
    tools: bool
    vision: bool
    auxiliary: bool
    choices: tuple[ReasoningChoice, ...]
    default_choice: str
    thinking_output_floor: int

    def choice(self, choice_id: str) -> Optional[ReasoningChoice]:
        return next((item for item in self.choices if item.id == choice_id), None)


@dataclass(frozen=True)
class ModelRequest:
    """一次运行实际使用的模型与思考参数。thinking 为空表示不附加思考字段。"""
    model_name: str
    context_window: int
    max_tokens: int
    thinking: Optional[str]
    reasoning_effort: Optional[str]
    reasoning_id: Optional[str]
    keep_reasoning: bool


def _deepseek_choices() -> tuple[ReasoningChoice, ...]:
    return (
        ReasoningChoice("disabled", "disabled", None, "current_turn"),
        ReasoningChoice("low", "enabled", "low", "all_turns"),
        ReasoningChoice("high", "enabled", "high", "all_turns"),
        ReasoningChoice("max", "enabled", "max", "all_turns"),
    )


def deepseek_models() -> tuple[ModelSpec, ...]:
    choices = _deepseek_choices()
    shared = dict(
        provider="deepseek", context_window=1_000_000, max_output=384_000, tools=True,
        choices=choices, default_choice="high", thinking_output_floor=32_768,
    )
    return (
        ModelSpec(id="deepseek-flash", vision=True, auxiliary=True, **shared),
        ModelSpec(id="deepseek-v4-pro", vision=False, auxiliary=False, **shared),
    )


_FACTORIES: dict[str, Callable[[], tuple[ModelSpec, ...]]] = {"deepseek": deepseek_models}


def provider_for(base_url: str) -> Optional[str]:
    host = urlparse(str(base_url)).hostname
    if host == "api.deepseek.com":
        return "deepseek"
    return None


def model_list(provider: str) -> tuple[ModelSpec, ...]:
    factory = _FACTORIES.get(provider)
    return factory() if factory else ()


def resolve_selection(provider: str, model_id: Optional[str], reasoning: Optional[str]) -> tuple[ModelSpec, ReasoningChoice]:
    """缺省时用该厂商的辅助模型与其默认力度。未知 id 拒绝。"""
    models = model_list(provider)
    if not models:
        raise ValueError("当前接口没有可选模型")
    if model_id:
        spec = next((item for item in models if item.id == model_id), None)
        if spec is None:
            raise ValueError(f"未知模型 {model_id}")
    else:
        spec = next(item for item in models if item.auxiliary)
    choice_id = reasoning or spec.default_choice
    choice = spec.choice(choice_id)
    if choice is None:
        raise ValueError(f"未知思考强度 {choice_id}")
    return spec, choice


def tuned_limits(configured_max_tokens: int, spec: ModelSpec, choice: ReasoningChoice) -> tuple[int, int]:
    """思考开启时把生成预算抬到建议下限，再封顶到该模型的最大输出。"""
    tokens = configured_max_tokens
    if choice.thinking == "enabled":
        tokens = max(tokens, spec.thinking_output_floor)
    return spec.context_window, min(tokens, spec.max_output)


def missing_reasoning(messages: list) -> bool:
    """助手消息还在、但没有 reasoning_content。带工具且开启思考时再请求会得到 400。"""
    return any(
        isinstance(message, dict) and message.get("role") == "assistant" and "reasoning_content" not in message
        for message in messages
    )


def model_request(
        config: LLMConfig,
        *,
        model_id: Optional[str],
        reasoning: Optional[str],
        snapshot: Optional[dict] = None,
) -> Optional[ModelRequest]:
    """未知厂商返回 None，调用方继续用全局配置。续接优先用该次运行快照。"""
    provider = provider_for(str(config.base_url))
    if provider is None:
        return None
    if snapshot and snapshot.get("model_name"):
        return _from_snapshot(snapshot, config.context_window, config.max_tokens)
    spec, choice = resolve_selection(provider, model_id, reasoning)
    window, tokens = tuned_limits(config.max_tokens, spec, choice)
    return ModelRequest(
        spec.id, window, tokens, choice.thinking, choice.effort, choice.id, choice.replay == "all_turns",
    )


def _from_snapshot(snapshot: dict, fallback_window: int, fallback_tokens: int) -> ModelRequest:
    """没有思考字段的旧快照不补参数，续接仍按当时的请求形状。"""
    thinking = snapshot.get("thinking")
    reasoning = snapshot.get("reasoning")
    enabled = thinking == "enabled"
    effort = reasoning if enabled and reasoning not in (None, "disabled") else None
    return ModelRequest(
        model_name=str(snapshot["model_name"]),
        context_window=int(snapshot.get("context_window") or fallback_window),
        max_tokens=int(snapshot.get("max_tokens") or fallback_tokens),
        thinking=thinking if thinking in ("enabled", "disabled") else None,
        reasoning_effort=effort if isinstance(effort, str) else None,
        reasoning_id=reasoning if isinstance(reasoning, str) else None,
        keep_reasoning=enabled,
    )


def auxiliary_call(
        config: LLMConfig, *, max_tokens: int, temperature: float, timeout: float,
) -> tuple[LLMConfig, Optional[str], Optional[str]]:
    """标题和摘要：已知厂商用辅助模型并关闭思考；其余沿用配置里的模型名。"""
    updates = {"max_tokens": max_tokens, "temperature": temperature, "streaming": False, "request_timeout": timeout}
    provider = provider_for(str(config.base_url))
    if provider is None:
        return config.model_copy(update=updates), None, None
    spec = next(item for item in model_list(provider) if item.auxiliary)
    choice = spec.choice("disabled")
    assert choice is not None
    updates["model_name"] = spec.id
    updates["context_window"] = spec.context_window
    updates["max_tokens"] = min(max_tokens, spec.max_output)
    return config.model_copy(update=updates), choice.thinking, choice.effort
