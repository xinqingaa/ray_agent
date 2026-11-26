"""版本化的双币种估算费率。DeepSeek 按官方人民币计价，OpenAI 按官方美元计价；历史金额直接从请求记录读取。"""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from app.domain.models.llm import LLMUsage
from app.domain.models.llm_endpoints import Currency, TokenRates
from app.domain.models.usage import UsageCharge

PRICE_VERSION = "multi-2026-11-25"
PRICE_SOURCES = {
    "deepseek": "https://api-docs.deepseek.com/quick_start/pricing/",
    "deepseek-asr": "https://api-docs.deepseek.com/guides/asr/",
    "openai": "https://developers.openai.com/api/docs/pricing",
}


@dataclass(frozen=True)
class _ModelPricing:
    currency: Currency
    input: str
    cached_input: str
    output: str
    cache_write_30m: Optional[str] = None
    cache_write_12h: Optional[str] = None
    long_context_threshold: Optional[int] = None
    long_input_factor: str = "1"
    long_output_factor: str = "1"


_BUILTIN_PRICING: dict[tuple[str, str], _ModelPricing] = {
    ("deepseek", "deepseek-flash"): _ModelPricing(
        currency="CNY", input="2.00", cached_input="0.04", output="8.00",
    ),
    ("deepseek", "deepseek-v4-pro"): _ModelPricing(
        currency="CNY", input="9.00", cached_input="0.30", output="27.00",
    ),
    ("openai", "gpt-6.2-sol"): _ModelPricing(
        currency="USD", input="2.00", cached_input="0.10", output="10.00",
        cache_write_30m="2.50", cache_write_12h="5.00",
        long_context_threshold=272_000, long_input_factor="2", long_output_factor="1.5",
    ),
    ("openai", "gpt-6.2-astra"): _ModelPricing(
        currency="USD", input="8.00", cached_input="0.40", output="40.00",
        cache_write_30m="10.00", cache_write_12h="20.00",
        long_context_threshold=272_000, long_input_factor="2", long_output_factor="1.5",
    ),
    ("openai", "gpt-6.1-sol"): _ModelPricing(
        currency="USD", input="2.00", cached_input="0.10", output="10.00",
        cache_write_30m="2.50", cache_write_12h="5.00",
        long_context_threshold=272_000, long_input_factor="2", long_output_factor="1.5",
    ),
    ("openai", "gpt-6-luna"): _ModelPricing(
        currency="USD", input="0.10", cached_input="0.01", output="0.50",
        cache_write_30m="0.125", cache_write_12h="0.25",
        long_context_threshold=272_000, long_input_factor="2", long_output_factor="1.5",
    ),
    ("openai", "gpt-6-astra"): _ModelPricing(
        currency="USD", input="10.00", cached_input="1.00", output="50.00",
        cache_write_30m="12.50", cache_write_12h="25.00",
        long_context_threshold=272_000, long_input_factor="2", long_output_factor="1.5",
    ),
}

# 保留标准三元组映射，供只读取基础单价的调用方兼容访问
TOKEN_PRICES: dict[tuple[str, str], tuple[str, str, str]] = {
    key: (spec.input, spec.cached_input, spec.output)
    for key, spec in _BUILTIN_PRICING.items()
}

_MODEL_ALIASES = {
    "deepseek-v4.1-flash-1017": "deepseek-flash",
    "deepseek-v4.1-flash": "deepseek-flash",
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
    "deepseek-v4-pro-0813": "deepseek-v4-pro",
}
_CANONICAL_MODELS_BY_LENGTH = sorted({model for _, model in _BUILTIN_PRICING}, key=len, reverse=True)


def _normalize_model_id(model: str) -> str:
    cleaned = model.strip().lower()
    if "/" in cleaned:
        prefix, tail = cleaned.split("/", 1)
        if prefix in ("openai", "deepseek"):
            cleaned = tail
    if cleaned in _MODEL_ALIASES:
        return _MODEL_ALIASES[cleaned]
    for base in _CANONICAL_MODELS_BY_LENGTH:
        if cleaned == base or cleaned.startswith(base + "-") or cleaned.startswith(base + ":"):
            return base
    return cleaned


def _resolve_builtin_pricing(vendor: str, model: str) -> tuple[str, _ModelPricing] | None:
    canonical = _normalize_model_id(model)
    if (vendor, canonical) in _BUILTIN_PRICING:
        return vendor, _BUILTIN_PRICING[(vendor, canonical)]
    # 中转站或未标明 vendor 的连接，若模型 ID 明确对应内置官方目录模型，仍按官方标准计费
    if vendor not in ("deepseek", "openai"):
        matches = [(item_vendor, spec) for (item_vendor, item_model), spec in _BUILTIN_PRICING.items() if item_model == canonical]
        if len(matches) == 1:
            return matches[0]
    return None


def builtin_token_rates(vendor: str, model: str) -> TokenRates | None:
    """内置目录的标准单价（每百万 Token）；没有内置计价的模型返回空。DeepSeek 的错峰折扣不在这里表达。"""
    resolved = _resolve_builtin_pricing(vendor, model)
    if resolved is None:
        return None
    _, pricing = resolved
    return TokenRates(
        currency=pricing.currency,
        input=Decimal(pricing.input),
        cached_input=Decimal(pricing.cached_input),
        output=Decimal(pricing.output),
    )


def _nanos(amount: Decimal) -> int:
    return int((amount * 1_000_000_000).to_integral_value(rounding=ROUND_HALF_UP))


def deepseek_peak_at(started_at: datetime) -> bool:
    utc = started_at.astimezone(timezone.utc)
    return utc.weekday() < 5 and (1 <= utc.hour < 4 or 6 <= utc.hour < 10)


def _charge_for_currency(currency: Currency, amount: Decimal, version: str, period: str) -> UsageCharge:
    nanos = _nanos(amount)
    if currency == "CNY":
        return UsageCharge(cost_nano_cny=nanos, price_version=version, price_period=period)
    return UsageCharge(cost_nano_usd=nanos, price_version=version, price_period=period)


def _tier_multiplier(service_tier: Optional[str]) -> Decimal:
    tier = (service_tier or "").strip().lower()
    if tier in ("priority", "fast"):
        return Decimal(2)
    if tier in ("batch", "flex"):
        return Decimal("0.5")
    return Decimal(1)


def token_charge(
    vendor: str, model: str, started_at: datetime, usage: LLMUsage | None,
    custom: TokenRates | None = None, *, service_tier: Optional[str] = None,
) -> UsageCharge:
    if usage is None or usage.prompt_tokens is None or usage.completion_tokens is None:
        return UsageCharge()
    resolved = _resolve_builtin_pricing(vendor, model)
    if custom is None and resolved is None:
        return UsageCharge()

    input_tokens, output_tokens = max(0, usage.prompt_tokens), max(0, usage.completion_tokens)
    cached = min(input_tokens, max(0, usage.cached_tokens or 0))
    remaining_input = input_tokens - cached
    write_12h = min(remaining_input, max(0, usage.cache_write_12h_tokens or 0))
    if usage.cache_write_30m_tokens is not None:
        write_30m = min(remaining_input - write_12h, max(0, usage.cache_write_30m_tokens))
    elif usage.cache_write_tokens is not None:
        write_30m = min(remaining_input - write_12h, max(0, usage.cache_write_tokens - write_12h))
    else:
        write_30m = 0
    uncached = remaining_input - write_12h - write_30m

    if custom is not None:
        rates = (custom.input, custom.cached_input, custom.output)
        currency = custom.currency
        fingerprint = "|".join([currency, *(str(rate.normalize()) for rate in rates)])
        version = "custom-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        period = "custom"
        in_factor = out_factor = Decimal(1)
        write_30m_rate = write_12h_rate = rates[0]
    else:
        resolved_vendor, pricing = resolved
        currency = pricing.currency
        rates = (Decimal(pricing.input), Decimal(pricing.cached_input), Decimal(pricing.output))
        write_30m_rate = Decimal(pricing.cache_write_30m) if pricing.cache_write_30m else rates[0]
        write_12h_rate = Decimal(pricing.cache_write_12h) if pricing.cache_write_12h else rates[0]
        version = PRICE_VERSION
        if resolved_vendor == "deepseek":
            peak = deepseek_peak_at(started_at)
            period = "peak" if peak else "off_peak"
            in_factor = out_factor = Decimal(1) if peak else Decimal("0.5")
        else:
            tier_factor = _tier_multiplier(service_tier)
            if pricing.long_context_threshold is not None and input_tokens > pricing.long_context_threshold:
                period = "long_context"
                in_factor = Decimal(pricing.long_input_factor) * tier_factor
                out_factor = Decimal(pricing.long_output_factor) * tier_factor
            else:
                period = "standard"
                in_factor = out_factor = tier_factor

    input_cost = (uncached * rates[0] + cached * rates[1] + write_30m * write_30m_rate + write_12h * write_12h_rate) * in_factor
    output_cost = output_tokens * rates[2] * out_factor
    cost = (input_cost + output_cost) / 1_000_000
    return _charge_for_currency(currency, cost, version, period)


def deepseek_asr_charge(duration_ms: int) -> UsageCharge:
    """DeepSeek 语音识别按官方人民币刊例价 ¥0.78 / 小时（按秒向上取整）估算。"""
    seconds = (duration_ms + 999) // 1000
    cost = Decimal("0.78") * seconds / 3600
    return UsageCharge(cost_nano_cny=_nanos(cost), price_version=PRICE_VERSION, price_period="standard")
