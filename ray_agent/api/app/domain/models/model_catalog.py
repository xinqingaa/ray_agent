#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""可选模型目录。页面只显示并保存厂商的请求 id 与思考参数原词。"""
from dataclasses import dataclass
from typing import Callable, Literal, Optional
from urllib.parse import urlparse

from app.domain.models.app_config import LLMConfig, ModelSampling


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
    temperature: float
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


def configured_sampling(config: LLMConfig, model_id: Optional[str]) -> ModelSampling:
    """该模型单独保存的数值；没有时用全局三项。未指定模型时用辅助模型的单独配置。"""
    if model_id and model_id in config.model_profiles:
        return config.model_profiles[model_id]
    provider = provider_for(str(config.base_url))
    if provider and not model_id:
        auxiliary = next((item for item in model_list(provider) if item.auxiliary), None)
        if auxiliary and auxiliary.id in config.model_profiles:
            return config.model_profiles[auxiliary.id]
    return ModelSampling(
        temperature=config.temperature, max_tokens=config.max_tokens, context_window=config.context_window,
    )


def current_sampling(config: LLMConfig, model_id: Optional[str]) -> ModelSampling:
    """新建对话要冻结的数值：不超过模型目录上限，不含思考开启时临时抬高的输出。"""
    provider = provider_for(str(config.base_url))
    spec = None
    if provider:
        try:
            spec, _choice = resolve_selection(provider, model_id, None)
        except ValueError:
            spec = None
    raw = configured_sampling(config, spec.id if spec else model_id)
    if spec is None:
        return raw
    return raw.model_copy(update={
        "context_window": min(raw.context_window, spec.context_window),
        "max_tokens": min(raw.max_tokens, spec.max_output),
    })


def choose_sampling(
        *, frozen: Optional[ModelSampling], model_changed: bool, snapshot: Optional[dict], current: ModelSampling,
) -> ModelSampling:
    """改设置不改已有对话。对话里换了模型，就用目标模型当前的配置。旧对话没有冻结值时沿用上次运行快照。"""
    if model_changed:
        return current
    if frozen is not None:
        return frozen
    if snapshot and snapshot.get("context_window"):
        temperature = snapshot.get("temperature")
        tokens = snapshot.get("max_tokens")
        return ModelSampling(
            temperature=float(temperature) if isinstance(temperature, (int, float)) else current.temperature,
            max_tokens=int(tokens) if isinstance(tokens, int) and not isinstance(tokens, bool) else current.max_tokens,
            context_window=int(snapshot["context_window"]),
        )
    return current


def tuned_limits(
        configured_max_tokens: int, configured_context_window: int, spec: ModelSpec, choice: ReasoningChoice,
) -> tuple[int, int]:
    """窗口用配置值，再封顶到模型目录里的上下文上限。思考开启时把生成预算抬到建议下限，再封顶到该模型的最大输出。"""
    tokens = configured_max_tokens
    if choice.thinking == "enabled":
        tokens = max(tokens, spec.thinking_output_floor)
    return min(configured_context_window, spec.context_window), min(tokens, spec.max_output)


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
        sampling: Optional[ModelSampling] = None,
) -> Optional[ModelRequest]:
    """未知厂商返回 None，调用方继续用全局配置。续接优先用该次运行快照。sampling 是这条对话已经记下的数值。"""
    provider = provider_for(str(config.base_url))
    if provider is None:
        return None
    if snapshot and snapshot.get("model_name"):
        return _from_snapshot(snapshot, config.context_window, config.max_tokens, config.temperature)
    spec, choice = resolve_selection(provider, model_id, reasoning)
    base = sampling or configured_sampling(config, spec.id)
    window, tokens = tuned_limits(base.max_tokens, base.context_window, spec, choice)
    return ModelRequest(
        spec.id, window, tokens, base.temperature, choice.thinking, choice.effort, choice.id, choice.replay == "all_turns",
    )


def _from_snapshot(snapshot: dict, fallback_window: int, fallback_tokens: int, fallback_temperature: float) -> ModelRequest:
    """没有思考字段的旧快照不补参数，续接仍按当时的请求形状。"""
    thinking = snapshot.get("thinking")
    reasoning = snapshot.get("reasoning")
    enabled = thinking == "enabled"
    effort = reasoning if enabled and reasoning not in (None, "disabled") else None
    temperature = snapshot.get("temperature")
    return ModelRequest(
        model_name=str(snapshot["model_name"]),
        context_window=int(snapshot.get("context_window") or fallback_window),
        max_tokens=int(snapshot.get("max_tokens") or fallback_tokens),
        temperature=float(temperature) if isinstance(temperature, (int, float)) else fallback_temperature,
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
    updates["context_window"] = min(configured_sampling(config, spec.id).context_window, spec.context_window)
    updates["max_tokens"] = min(max_tokens, spec.max_output)
    return config.model_copy(update=updates), choice.thinking, choice.effort
