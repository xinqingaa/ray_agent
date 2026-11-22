"""读取上游模型列表后的能力归并：目录优先，其次上游报告，最后是标为未确认的默认值。纯函数，不做网络请求。"""
from app.domain.models.llm_endpoints import ProbedModel, UpstreamModelReport
from app.domain.models.model_catalog import (
    UNCONFIRMED_CONTEXT_WINDOW, UNCONFIRMED_MAX_OUTPUT, ModelSpec, find_model,
)
from app.domain.services.usage_pricing import builtin_token_rates

# 上游报告的窗口与输出都必须在这个范围内，与 CustomModel 的字段约束一致
CONTEXT_WINDOW_RANGE = (2, 10_000_000)
MAX_OUTPUT_LIMIT = 10_000_000


def _catalog_probe(spec: ModelSpec, claimed_by: str | None) -> ProbedModel:
    efforts = [choice.effort for choice in spec.choices if choice.thinking == "enabled" and choice.effort]
    thinking = any(choice.thinking == "enabled" for choice in spec.choices)
    rates = builtin_token_rates(spec.provider, spec.id)
    return ProbedModel(
        id=spec.id, catalog=True, claimed_by=claimed_by,
        context_window=spec.context_window, max_output=spec.max_output, tools=spec.tools, vision=spec.vision,
        thinking=thinking, reasoning_efforts=efforts, rates=rates,
        sources={key: "catalog" for key in ("context_window", "max_output", "tools", "vision", "thinking", "reasoning_efforts")}
        | {"rates": "catalog" if rates is not None else "unconfirmed"},
    )


def probe_model(report: UpstreamModelReport, *, claimed_by: str | None = None) -> ProbedModel:
    """把一条上游报告归并成可展示、可保存的能力。目录模型一律以目录为准，忽略上游的报告。"""
    spec = find_model(report.id)
    if spec is not None:
        return _catalog_probe(spec, claimed_by)

    sources: dict[str, str] = {}

    window = report.context_window if report.context_window is not None and (
        CONTEXT_WINDOW_RANGE[0] <= report.context_window <= CONTEXT_WINDOW_RANGE[1]) else None
    context_window = window if window is not None else UNCONFIRMED_CONTEXT_WINDOW
    sources["context_window"] = "upstream" if window is not None else "unconfirmed"

    output = report.max_output if report.max_output is not None and (
        1 <= report.max_output <= MAX_OUTPUT_LIMIT) and report.max_output < context_window * 0.95 else None
    max_output = output if output is not None else min(UNCONFIRMED_MAX_OUTPUT, context_window // 2)
    sources["max_output"] = "upstream" if output is not None else "unconfirmed"

    tools = report.tools if report.tools is not None else True
    sources["tools"] = "upstream" if report.tools is not None else "unconfirmed"
    vision = report.vision if report.vision is not None else False
    sources["vision"] = "upstream" if report.vision is not None else "unconfirmed"

    efforts = list(report.reasoning_efforts or ())
    thinking_reported = report.thinking if report.thinking is not None else (True if efforts else None)
    thinking = thinking_reported if thinking_reported is not None else False
    sources["thinking"] = "upstream" if thinking_reported is not None else "unconfirmed"
    sources["reasoning_efforts"] = "upstream" if report.reasoning_efforts is not None else "unconfirmed"

    rates = report.rates
    sources["rates"] = "upstream" if rates is not None else "unconfirmed"

    return ProbedModel(
        id=report.id, catalog=False, claimed_by=claimed_by,
        context_window=context_window, max_output=max_output, tools=tools, vision=vision, thinking=thinking,
        reasoning_efforts=efforts, rates=rates, sources=sources,
    )
