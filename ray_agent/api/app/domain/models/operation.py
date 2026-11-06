"""长操作：先返回 operation_id，查询、取消与重试沿同一身份。

业务运行保留自己的终态集合，不使用本模型。取消请求是运行中的附加状态，不是终态；
原操作已完成时取消或重试返回完成结果，不制造另一份副作用。
"""
from datetime import datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, Field, model_validator

from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorInfo
from app.domain.models.identity import Generation, OperationId, RequestId, SessionId, WorkspaceId


class OperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def terminal(self) -> bool:
        return self in TERMINAL_OPERATION_STATUSES


TERMINAL_OPERATION_STATUSES = frozenset({OperationStatus.SUCCEEDED, OperationStatus.FAILED, OperationStatus.CANCELLED})


class OperationKind(StrEnum):
    """新增类型在这里登记，各工作包不另起同义名称。"""
    COMPONENT_INSTALL = "component_install"
    DOCUMENT_INDEX = "document_index"
    MEMORY_EXTRACTION = "memory_extraction"
    SESSION_SUMMARY = "session_summary"
    DATA_CLEANUP = "data_cleanup"


class OperationScopeKind(StrEnum):
    APP = "app"
    WORKSPACE = "workspace"
    SESSION = "session"


class OperationScope(BaseModel):
    """操作的所有者范围；查询、取消与重试按范围核对来源。"""
    kind: OperationScopeKind
    workspace_id: WorkspaceId | None = None
    session_id: SessionId | None = None

    @model_validator(mode="after")
    def _ids_match_kind(self) -> Self:
        if self.kind is OperationScopeKind.APP and (self.workspace_id or self.session_id):
            raise ValueError("应用级操作不属于工作区或会话")
        if self.kind is OperationScopeKind.WORKSPACE and (not self.workspace_id or self.session_id):
            raise ValueError("工作区操作只带工作区身份")
        if self.kind is OperationScopeKind.SESSION and not self.session_id:
            raise ValueError("会话操作必须带会话身份")
        return self


class OperationProgress(BaseModel):
    completed: int = Field(default=0, ge=0)
    total: int | None = Field(default=None, ge=0)


class Operation(BaseModel):
    operation_id: OperationId
    kind: OperationKind
    scope: OperationScope
    generation: Generation = 1
    status: OperationStatus = OperationStatus.QUEUED
    phase: str | None = None
    progress: OperationProgress | None = None
    request_id: RequestId | None = None
    cancel_requested_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    finished_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: ErrorInfo | None = None
    retry_supported: bool = False  # 失败或取消后能否按同一身份重试，由操作类型决定

    @model_validator(mode="after")
    def _outcome_matches_status(self) -> Self:
        if self.status is OperationStatus.SUCCEEDED and self.error is not None:
            raise ValueError("成功的操作没有错误")
        if self.status is OperationStatus.FAILED and self.error is None:
            raise ValueError("失败的操作必须带错误")
        if not self.status.terminal and (self.result is not None or self.finished_at is not None):
            raise ValueError("未结束的操作没有结果或结束时间")
        return self

    @property
    def can_cancel(self) -> bool:
        return not self.status.terminal and self.cancel_requested_at is None

    @property
    def can_retry(self) -> bool:
        return self.retry_supported and self.status in (OperationStatus.FAILED, OperationStatus.CANCELLED)
