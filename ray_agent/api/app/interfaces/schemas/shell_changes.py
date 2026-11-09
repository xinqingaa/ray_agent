"""Shell 区间观察契约：有界元数据差异、未知归属和不支持撤销。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict


class ObservationVersion(BaseModel):
    size: int
    modified_ns: str


class ObservedChange(BaseModel):
    root_id: str
    relative_path: str
    operation: Literal['create', 'modify', 'delete', 'unclassified']
    before: ObservationVersion | None
    after: ObservationVersion | None


class ObservedRoot(BaseModel):
    root_id: str
    kind: str
    before_files: int
    after_files: int | None
    partial: bool
    errors: list[str]


class ShellChangesResponse(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
    run_id: str
    state: Literal['not_started', 'observing', 'complete', 'unknown']
    started_at: str | None
    ended_at: str | None
    roots: list[ObservedRoot]
    total: int
    entries: list[ObservedChange]
    has_more: bool
    attribution: Literal['unknown']
    undo_available: Literal[False]
