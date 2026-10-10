"""不可逆数据操作的持久状态；失败保留固定清单，重试不扩大范围。"""
from datetime import datetime
from pydantic import BaseModel, Field


class CleanupTask(BaseModel):
    id: str
    scope: str
    project_id: str | None = None
    name: str
    state: str = 'running'
    phase: str = 'resources'
    completed: int = 0
    total: int = 0
    error: str | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    session_ids: list[str] = Field(default_factory=list)
    project_ids: list[str] = Field(default_factory=list)
    files: list[dict] = Field(default_factory=list, exclude=True)
    sandbox_ids: list[str] = Field(default_factory=list, exclude=True)
    task_ids: list[str] = Field(default_factory=list, exclude=True)
    created_at: datetime
    updated_at: datetime


class CleanupPreview(BaseModel):
    name: str
    counts: dict[str, int]
    blocked_reason: str | None = None
    occupying_session_id: str | None = None
    task: CleanupTask | None = None
