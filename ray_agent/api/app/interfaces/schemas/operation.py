"""长操作的接口视图：受理返回 operation_id，查询、取消与重试接口都返回这一结构；时间为毫秒时间戳。"""
from typing import Any, Self

from pydantic import BaseModel, ConfigDict

from app.domain.models.error import ErrorInfo
from app.domain.models.identity import Generation, OperationId, RequestId
from app.domain.models.operation import Operation, OperationKind, OperationProgress, OperationScope, OperationStatus
from app.interfaces.schemas.event import to_epoch_ms


class OperationView(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    operation_id: OperationId
    kind: OperationKind
    scope: OperationScope
    generation: Generation
    status: OperationStatus
    phase: str | None = None
    progress: OperationProgress | None = None
    request_id: RequestId | None = None
    cancel_requested_at: int | None = None
    created_at: int
    updated_at: int
    finished_at: int | None = None
    result: dict[str, Any] | None = None
    error: ErrorInfo | None = None
    can_cancel: bool
    can_retry: bool

    @classmethod
    def from_operation(cls, operation: Operation) -> Self:
        def ms(value):
            return to_epoch_ms(value) if value is not None else None
        return cls(
            **operation.model_dump(include={"operation_id", "kind", "scope", "generation", "status", "phase",
                                            "progress", "request_id", "result", "error"}),
            cancel_requested_at=ms(operation.cancel_requested_at),
            created_at=to_epoch_ms(operation.created_at),
            updated_at=to_epoch_ms(operation.updated_at),
            finished_at=ms(operation.finished_at),
            can_cancel=operation.can_cancel,
            can_retry=operation.can_retry,
        )
