"""用量记录与查询结果。金额以十亿分之一美元保存，空值表示缺少计价依据。"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.models.voice import VoicePreference

UsagePurpose = Literal["main", "compact", "title", "memory", "summary", "transcribe", "connection_test"]
UsageRange = Literal["today", "24h", "3d", "7d", "30d", "90d", "custom"]


@dataclass(frozen=True)
class UsageContext:
    purpose: UsagePurpose = "main"
    session_id: str | None = None
    run_id: str | None = None
    workspace_id: str | None = None


usage_context = ContextVar("usage_context", default=UsageContext())


@contextmanager
def usage_scope(**fields):
    token = usage_context.set(replace(usage_context.get(), **fields))
    try:
        yield
    finally:
        usage_context.reset(token)


class UsageCharge(BaseModel):
    cost_nano_usd: int | None = None
    price_version: str | None = None
    price_period: str | None = None


class UsageTotals(BaseModel):
    requests: int = 0
    failed_requests: int = 0
    unpriced_requests: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    reasoning_tokens: int = 0
    audio_duration_ms: int = 0
    cost_nano_usd: int | None = None


class UsageGroup(UsageTotals):
    key: str
    models: list["UsageGroup"] = Field(default_factory=list)


class UsageBucket(UsageTotals):
    start: datetime
    end: datetime
    providers: list[UsageGroup] = Field(default_factory=list)
    top_models: list[str] = Field(default_factory=list)
    top_model_counts: dict[str, int] = Field(default_factory=dict)
    price_periods: list[str] = Field(default_factory=list)


class UsageHour(UsageTotals):
    weekday: int
    hour: int
    top_models: list[str] = Field(default_factory=list)
    top_model_counts: dict[str, int] = Field(default_factory=dict)
    price_periods: list[str] = Field(default_factory=list)
    deepseek_peak: bool = False


class UsageReport(BaseModel):
    start: datetime
    end: datetime
    previous_start: datetime
    selectable_from: datetime
    timezone: str
    price_version: str
    price_sources: dict[str, str]
    bucket_unit: Literal["hour", "3h", "day"]
    totals: UsageTotals
    previous: UsageTotals
    buckets: list[UsageBucket]
    providers: list[UsageGroup]
    purposes: list[UsageGroup]
    hours: list[UsageHour]
    calendar: list[UsageBucket]


class UsagePreferences(BaseModel):
    show_conversation_cost: bool = True
    # None 表示用户尚未选择：输入框显示麦克风，首次使用时确认启用。
    voice: VoicePreference | None = None
