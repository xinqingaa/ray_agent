"""版本化的美元估算费率。历史金额直接从请求记录读取。"""
from datetime import datetime, timezone
import hashlib
from decimal import Decimal, ROUND_HALF_UP

from app.domain.models.llm import LLMUsage
from app.domain.models.llm_endpoints import TokenRates
from app.domain.models.usage import UsageCharge

PRICE_VERSION = "usd-2026-11-20"
PRICE_SOURCES = {
    "deepseek": "https://api-docs.deepseek.com/quick_start/pricing/",
    "deepseek-asr": "https://api-docs.deepseek.com/guides/asr/",
    "openai": "https://developers.openai.com/api/docs/pricing",
}
TOKEN_PRICES = {
    ("deepseek", "deepseek-flash"): ("0.30", "0.006", "1.20"),
    ("deepseek", "deepseek-v4-pro"): ("1.32", "0.044", "3.96"),
    ("openai", "gpt-6.1-sol"): ("2.00", "0.10", "10.00"),
    ("openai", "gpt-6-luna"): ("0.10", "0.01", "0.50"),
    ("openai", "gpt-6-astra"): ("10.00", "1.00", "50.00"),
}


def _nanos(dollars: Decimal) -> int:
    return int((dollars * 1_000_000_000).to_integral_value(rounding=ROUND_HALF_UP))


def deepseek_peak_at(started_at: datetime) -> bool:
    utc = started_at.astimezone(timezone.utc)
    return utc.weekday() < 5 and (1 <= utc.hour < 4 or 6 <= utc.hour < 10)


def token_charge(
    vendor: str, model: str, started_at: datetime, usage: LLMUsage | None, custom: TokenRates | None = None,
) -> UsageCharge:
    if usage is None or usage.prompt_tokens is None or usage.completion_tokens is None:
        return UsageCharge()
    prices = TOKEN_PRICES.get((vendor, model))
    if custom is None and prices is None:
        return UsageCharge()
    if custom is not None:
        rates = (custom.input, custom.cached_input, custom.output)
        fingerprint = "|".join(str(rate.normalize()) for rate in rates)
        version = "custom-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        period, factor = "custom", Decimal(1)
    else:
        rates = tuple(Decimal(price) for price in prices)
        version = PRICE_VERSION
        if vendor == "deepseek":
            peak = deepseek_peak_at(started_at)
            period, factor = ("peak", Decimal(1)) if peak else ("off_peak", Decimal("0.5"))
        else:
            period, factor = "standard", Decimal(1)
    input_tokens, output_tokens = max(0, usage.prompt_tokens), max(0, usage.completion_tokens)
    cached = min(input_tokens, max(0, usage.cached_tokens or 0))
    cost = ((input_tokens - cached) * rates[0] + cached * rates[1] + output_tokens * rates[2]) * factor / 1_000_000
    return UsageCharge(cost_nano_usd=_nanos(cost), price_version=version, price_period=period)


def deepseek_asr_charge(duration_ms: int) -> UsageCharge:
    seconds = (duration_ms + 999) // 1000
    cost = Decimal("0.116") * seconds / 3600
    return UsageCharge(cost_nano_usd=_nanos(cost), price_version=PRICE_VERSION, price_period="standard")
