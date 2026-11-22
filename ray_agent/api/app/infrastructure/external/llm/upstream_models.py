"""解析上游 /models 的返回。各服务字段不同，只认识常见的别名；每个字段单独校验，无效或缺失的字段记为未报告，不影响同一列表里的其他模型。"""
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from pydantic import ValidationError

from app.domain.models.llm_endpoints import MAX_REASONING_EFFORTS, RESERVED_EFFORTS, TokenRates, UpstreamModelReport

_EFFORT = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")
_CONTEXT_KEYS = (("context_length",), ("top_provider", "context_length"), ("max_context_length",),
                 ("context_window",), ("max_input_tokens",), ("inputTokenLimit",))
_OUTPUT_KEYS = (("max_output_tokens",), ("max_completion_tokens",), ("top_provider", "max_completion_tokens"),
                ("outputTokenLimit",))
_EFFORT_KEYS = ("supported_reasoning_efforts", "reasoning_efforts")
_MILLION = Decimal(1_000_000)
_CENT = Decimal("0.00000001")


def _dig(entry: dict, path: tuple[str, ...]) -> Any:
    value: Any = entry
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _integer(entry: dict, keys: tuple[tuple[str, ...], ...], low: int, high: int) -> Optional[int]:
    for path in keys:
        value = _dig(entry, path)
        if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
            return value
    return None


def _parameters(entry: dict) -> Optional[set[str]]:
    """supported_parameters 存在时是权威列表：没有列出的参数视为不支持。"""
    value = entry.get("supported_parameters")
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return set(value)
    return None


def _flag(entry: dict, key: str) -> Optional[bool]:
    value = entry.get(key)
    return value if isinstance(value, bool) else None


def _tools(entry: dict) -> Optional[bool]:
    parameters = _parameters(entry)
    if parameters is not None:
        return "tools" in parameters
    for key in ("supports_function_calling", "supports_tools"):
        if _flag(entry, key) is not None:
            return _flag(entry, key)
    return None


def _vision(entry: dict) -> Optional[bool]:
    modalities = _dig(entry, ("architecture", "input_modalities"))
    if isinstance(modalities, list) and all(isinstance(item, str) for item in modalities):
        return "image" in modalities
    return _flag(entry, "supports_vision")


def _thinking(entry: dict) -> Optional[bool]:
    parameters = _parameters(entry)
    if parameters is not None:
        return bool({"reasoning", "include_reasoning"} & parameters)
    return _flag(entry, "supports_reasoning")


def _efforts(entry: dict) -> Optional[tuple[str, ...]]:
    for key in _EFFORT_KEYS:
        value = entry.get(key)
        if isinstance(value, list):
            efforts = [item for item in value if isinstance(item, str) and _EFFORT.match(item) and item not in RESERVED_EFFORTS]
            return tuple(dict.fromkeys(efforts))[:MAX_REASONING_EFFORTS]
    return None


def _per_million(value: Any) -> Optional[Decimal]:
    """上游单价按每个 Token 的美元计，可能是字符串或数字；负数（如动态定价的 -1）视为未报告。"""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        dollars = Decimal(str(value).strip()) * _MILLION
    except ArithmeticError:
        return None
    if not dollars.is_finite() or dollars < 0:
        return None
    return dollars.quantize(_CENT, rounding=ROUND_HALF_UP)


def _rates(entry: dict) -> Optional[TokenRates]:
    pricing = entry.get("pricing")
    if isinstance(pricing, dict):
        source = {"input": pricing.get("prompt"), "cached": pricing.get("input_cache_read"), "output": pricing.get("completion")}
    else:
        source = {"input": entry.get("input_cost_per_token"), "cached": entry.get("cache_read_input_token_cost"),
                  "output": entry.get("output_cost_per_token")}
    input_rate, output_rate = _per_million(source["input"]), _per_million(source["output"])
    if input_rate is None or output_rate is None:
        return None
    cached = _per_million(source["cached"])
    try:
        return TokenRates(input=input_rate, cached_input=input_rate if cached is None else cached, output=output_rate)
    except ValidationError:
        return None


def parse_upstream_entry(entry: Any) -> Optional[UpstreamModelReport]:
    if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
        return None
    return UpstreamModelReport(
        id=entry["id"],
        context_window=_integer(entry, _CONTEXT_KEYS, 2, 10_000_000),
        max_output=_integer(entry, _OUTPUT_KEYS, 1, 10_000_000),
        tools=_tools(entry), vision=_vision(entry), thinking=_thinking(entry),
        reasoning_efforts=_efforts(entry), rates=_rates(entry),
    )


def parse_model_list(payload: Any, *, secret: str) -> list[UpstreamModelReport]:
    """返回按 id 排序、去重后的报告。顶层不是 data 列表时抛出 ValueError；单项无效只跳过该项。"""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("上游返回的模型列表格式无效")
    reports: dict[str, UpstreamModelReport] = {}
    for entry in payload["data"]:
        report = parse_upstream_entry(entry)
        if report is None or (secret and secret in report.id):
            continue
        reports.setdefault(report.id, report)
    return [reports[model_id] for model_id in sorted(reports)]

