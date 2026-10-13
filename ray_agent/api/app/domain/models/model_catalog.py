#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""可选模型目录。页面只显示并保存厂商的请求 id 与思考参数原词。"""
from dataclasses import dataclass
from typing import Callable, Literal, Optional
from urllib.parse import urlparse

from app.domain.models.app_config import LLMConfig, ModelSampling
from app.domain.models.llm_endpoints import LlmEndpoint


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
    # 能力由模型声明；UI 不猜测强度顺序、关闭标识或采样兼容性。
    reasoning_ordered: bool = False
    reasoning_family: Optional[str] = None
    temperature_when: Literal["always", "disabled", "never"] = "always"
    temperature_max: Optional[float] = None
    # enabled 发送 true，provider_default 不发送该可选字段，disabled 发送 false。
    tool_batching: Literal["enabled", "provider_default", "disabled"] = "disabled"
    # DeepSeek 把思考开关放在 extra_body。OpenAI 兼容端点只发送 reasoning_effort。
    emit_thinking: bool = True

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
        provider="deepseek", context_window=1_000_000, max_output=393_216, tools=True,
        choices=choices, default_choice="high", thinking_output_floor=32_768,
        reasoning_ordered=True, reasoning_family="deepseek-v4", tool_batching="provider_default", temperature_when="disabled", temperature_max=2,
    )
    return (
        ModelSpec(id="deepseek-flash", vision=True, auxiliary=True, **shared),
        ModelSpec(id="deepseek-v4-pro", vision=False, auxiliary=False, **shared),
    )


def _gpt_choices(efforts: tuple[str, ...]) -> tuple[ReasoningChoice, ...]:
    """目录中的 none 对应关闭档；请求显式发送 reasoning_effort=none。"""
    return tuple(
        ReasoningChoice(effort, "disabled" if effort == "none" else "enabled", effort, "current_turn")
        for effort in efforts
    )


def _gpt_spec(model_id: str, efforts: tuple[str, ...], default: str) -> ModelSpec:
    """应用窗口按 200000 封顶；思考档位保持当前接入目录中的原词。"""
    return ModelSpec(
        id=model_id, provider="openai", context_window=200_000, max_output=128_000, tools=True, vision=True,
        auxiliary=False, choices=_gpt_choices(efforts),
        default_choice=default, thinking_output_floor=0, reasoning_ordered=True, reasoning_family="gpt-6",
        temperature_when="disabled", temperature_max=2, tool_batching="provider_default", emit_thinking=False,
    )


def gpt_models() -> tuple[ModelSpec, ...]:
    """当前接入的 GPT 能力声明；真实上游支持范围需独立验证。"""
    opened = ("low", "medium", "high", "xhigh", "max")
    return (
        _gpt_spec("gpt-6.1-sol", opened, "medium"),
        _gpt_spec("gpt-6-luna", ("none",) + opened, "medium"),
        _gpt_spec("gpt-6-astra", opened, "medium"),
    )


def find_model(model_id: Optional[str]) -> Optional[ModelSpec]:
    """能力目录与端点可用性分开；端点移除不能使已保存模型变成未知模型。"""
    return next((item for item in (*deepseek_models(), *gpt_models()) if item.id == model_id), None)


def endpoint_for(config: LLMConfig, model_id: str) -> Optional[LlmEndpoint]:
    name = config.model_endpoints.get(model_id)
    if not name or name not in config.llm_endpoints:
        return None
    if name in config.resolved_endpoints:
        return config.resolved_endpoints[name]
    if name == "deepseek" and config.llm_endpoints[name].url_env == "DEEPSEEK_URL":
        return LlmEndpoint(base_url=config.base_url, api_key=config.api_key, api_protocol=config.llm_endpoints[name].api_protocol)
    return None


def active_models(config: LLMConfig) -> tuple[ModelSpec, ...]:
    """返回已设置地址的模型；缺失密钥仍可查看能力，在实际调用时明确拒绝。"""
    return tuple(item for item in (*deepseek_models(), *gpt_models()) if endpoint_for(config, item.id))


def default_model(config: LLMConfig) -> Optional[ModelSpec]:
    # 兼容旧默认名称，不依赖上游域名；自定义模型仍走原全局接口。
    model_id = "deepseek-flash" if config.model_name in ("deepseek-chat", "deepseek-reasoner") else config.model_name
    return find_model(model_id)


_FACTORIES: dict[str, Callable[[], tuple[ModelSpec, ...]]] = {"deepseek": deepseek_models, "openai": gpt_models}


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
    """该模型单独保存的数值；没有时用全局三项。未指定模型时用默认模型配置。"""
    if model_id and model_id in config.model_profiles:
        return config.model_profiles[model_id]
    spec = default_model(config) if not model_id else None
    if spec and spec.id in config.model_profiles:
        return config.model_profiles[spec.id]
    return ModelSampling(
        temperature=config.temperature, max_tokens=config.max_tokens, context_window=config.context_window,
    )


def resolve_active(config: LLMConfig, model_id: Optional[str], reasoning: Optional[str]) -> tuple[ModelSpec, ReasoningChoice]:
    """解析用户模型，不根据 URL 猜厂商或回退到别的模型。"""
    spec = find_model(model_id) if model_id else default_model(config)
    if spec is None:
        raise ValueError(f"未知模型 {model_id}" if model_id else "当前接口没有可选模型")
    if endpoint_for(config, spec.id) is None:
        raise ValueError(f"{spec.id} 未配置模型接口")
    choice_id = reasoning or spec.default_choice
    choice = spec.choice(choice_id)
    if choice is None:
        raise ValueError(f"未知思考强度 {choice_id}")
    return spec, choice


def current_sampling(config: LLMConfig, model_id: Optional[str]) -> ModelSampling:
    """新建对话冻结采样值，并按模型能力封顶。"""
    spec = find_model(model_id) if model_id else default_model(config)
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
    """未指定目录模型且默认是自定义模型时返回 None，调用方继续用全局配置。续接优先用该次运行快照。sampling 是这条对话已经记下的数值。"""
    if snapshot and snapshot.get("model_name"):
        return _from_snapshot(snapshot, config.context_window, config.max_tokens, config.temperature)
    if model_id is None and default_model(config) is None:
        return None
    spec, choice = resolve_active(config, model_id, reasoning)
    base = sampling or configured_sampling(config, spec.id)
    window, tokens = tuned_limits(base.max_tokens, base.context_window, spec, choice)
    thinking = choice.thinking if spec.emit_thinking else None
    return ModelRequest(
        spec.id, window, tokens, base.temperature, thinking, choice.effort, choice.id, choice.replay == "all_turns",
    )


def _from_snapshot(snapshot: dict, fallback_window: int, fallback_tokens: int, fallback_temperature: float) -> ModelRequest:
    """没有思考字段的旧快照不补参数，续接仍按当时的请求形状。"""
    thinking = snapshot.get("thinking")
    reasoning = snapshot.get("reasoning")
    enabled = thinking == "enabled"
    effort = snapshot["reasoning_effort"] if "reasoning_effort" in snapshot else (reasoning if enabled else None)
    temperature = snapshot.get("temperature")
    return ModelRequest(
        model_name=str(snapshot["model_name"]),
        context_window=int(snapshot.get("context_window") or fallback_window),
        max_tokens=int(snapshot.get("max_tokens") or fallback_tokens),
        temperature=float(temperature) if isinstance(temperature, (int, float)) else fallback_temperature,
        thinking=thinking if thinking in ("enabled", "disabled") else None,
        reasoning_effort=effort if isinstance(effort, str) else None,
        reasoning_id=reasoning if isinstance(reasoning, str) else None,
        keep_reasoning=bool(snapshot.get("keep_reasoning", enabled)),
    )


def auxiliary_call(
        config: LLMConfig, *, max_tokens: int, temperature: float, timeout: float,
) -> tuple[LLMConfig, Optional[str], Optional[str]]:
    """标题和摘要：DeepSeek 用辅助模型；其他模型优先关闭档，没有时用最低档。"""
    updates = {"max_tokens": max_tokens, "temperature": temperature, "streaming": False, "request_timeout": timeout}
    spec = default_model(config)
    if spec is None:
        return config.model_copy(update=updates), None, None
    if spec.provider == "deepseek":
        spec = next(item for item in deepseek_models() if item.auxiliary)
    choice = next((item for item in spec.choices if item.thinking == "disabled"), spec.choices[0])
    updates["model_name"] = spec.id
    updates["context_window"] = min(configured_sampling(config, spec.id).context_window, spec.context_window)
    updates["max_tokens"] = min(max_tokens, spec.max_output)
    return client_config(config, spec.id).model_copy(update=updates), choice.thinking if spec.emit_thinking else None, choice.effort


def client_config(config: LLMConfig, model_name: str) -> LLMConfig:
    """已知模型必须使用配置的端点，端点缺失绝不回退到全局地址。"""
    if find_model(model_name) is None:
        return config
    endpoint = endpoint_for(config, model_name)
    if endpoint is None:
        raise ValueError(f"{model_name} 未配置模型接口")
    return config.model_copy(update={"base_url": endpoint.base_url, "api_key": endpoint.api_key, "api_protocol": endpoint.api_protocol})


def public_capabilities(spec: ModelSpec) -> dict:
    """前端只读取展示能力，厂商请求编码仍由模型目录/适配层负责。"""
    return dict(id=spec.id, vendor=spec.provider, vendor_label={"deepseek": "DeepSeek", "openai": "OpenAI"}.get(spec.provider, spec.provider), vision=spec.vision, context_window=spec.context_window, max_output=spec.max_output,
        choices=[c.id for c in spec.choices], default_choice=spec.default_choice,
        reasoning_options=[dict(id=c.id, enabled=c.thinking == "enabled") for c in spec.choices],
        reasoning_ordered=spec.reasoning_ordered, reasoning_family=spec.reasoning_family,
        temperature_when=spec.temperature_when, temperature_max=spec.temperature_max)
