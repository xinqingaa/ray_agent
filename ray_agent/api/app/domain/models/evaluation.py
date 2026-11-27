"""本机评测批次、用例结果及可比较条件。"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

EvaluationCaseId = Literal["ppt", "excel", "brief"]
EvaluationSide = Literal["baseline", "candidate"]
EvaluationOutcome = Literal["passed", "failed", "error"]
EvaluationState = Literal["running", "completed", "cancelled", "interrupted", "failed"]


class EvaluationCase(BaseModel):
    id: EvaluationCaseId
    title: str
    criteria: str


class EvaluationStart(BaseModel):
    model: str = Field(min_length=1)
    cases: list[EvaluationCaseId] = Field(min_length=1, max_length=3)
    repeats: int = Field(default=1, ge=1, le=3)
    compare: bool = False
    request_id: UUID
    reference_id: UUID | None = None


class EvaluationCheck(BaseModel):
    label: str
    passed: bool
    detail: str


class EvaluationArtifact(BaseModel):
    file_id: str
    filename: str


class EvaluationMetrics(BaseModel):
    elapsed_ms: int
    first_model_ms: int | None = None
    model_ms: int | None = None
    tool_ms: int | None = None
    model_requests: int = 0
    tool_calls: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_nano_usd: int | None = None
    cost_nano_cny: int | None = None


class EvaluationResult(BaseModel):
    case_id: EvaluationCaseId
    side: EvaluationSide
    repetition: int
    outcome: EvaluationOutcome
    checks: list[EvaluationCheck] = Field(default_factory=list)
    artifacts: list[EvaluationArtifact] = Field(default_factory=list)
    metrics: EvaluationMetrics | None = None
    run_id: str | None = None
    note: str | None = None
    reply: str | None = None


class EvaluationBatch(BaseModel):
    id: UUID
    created_at: datetime
    state: EvaluationState
    model: str
    cases: list[EvaluationCaseId]
    repeats: int
    candidate: str
    baseline: str | None = None
    reference_id: UUID | None = None
    suite_version: str
    conditions: str | None = None
    sampling: dict[str, int | float] = Field(default_factory=dict)
    results: list[EvaluationResult] = Field(default_factory=list)
    current: str | None = None
    error: str | None = None


class EvaluationCatalog(BaseModel):
    cases: list[EvaluationCase]
    candidate: str
    baseline: str | None = None


class EvaluationOverview(BaseModel):
    catalog: EvaluationCatalog
    batches: list[EvaluationBatch]
