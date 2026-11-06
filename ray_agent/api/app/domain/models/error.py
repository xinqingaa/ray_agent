"""结构化错误：接口错误响应、握手失败与长操作失败共用同一结构。"""
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorCode(StrEnum):
    """机器可读的错误代码，按客户端的处理方式区分；具体原因写在 message 与 details。"""
    INVALID_REQUEST = "invalid_request"  # 请求本身不成立，修改后再提交
    VALIDATION_FAILED = "validation_failed"  # 参数未通过校验
    FORBIDDEN = "forbidden"  # 当前调用方或范围不允许
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    CONFLICT = "conflict"  # 与资源当前状态或版本冲突，先读回再决定
    GONE = "gone"  # 资源曾经存在，已过期或删除
    PAYLOAD_TOO_LARGE = "payload_too_large"
    RANGE_NOT_SATISFIABLE = "range_not_satisfiable"
    CONTEXT_LIMIT = "context_limit"  # 输入超过模型上下文容量
    RATE_LIMITED = "rate_limited"
    INTERNAL_ERROR = "internal_error"
    UPSTREAM_ERROR = "upstream_error"  # 模型或外部服务返回失败
    UNAVAILABLE = "unavailable"  # 核心或其依赖暂不可用，请求未被处理
    TIMEOUT = "timeout"  # 超过期限，结果未知时先读回再决定是否重试


RETRYABLE_BY_DEFAULT = frozenset({ErrorCode.RATE_LIMITED, ErrorCode.UNAVAILABLE})

type ResourceVersion = int | str


class ErrorInfo(BaseModel):
    """retryable 表示原样重试不会制造重复副作用；结果未知的失败为 false，需要先读回。"""
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    code: ErrorCode
    message: str = Field(description="给用户看的原因")
    retryable: bool = False
    retry_after_ms: int | None = Field(default=None, ge=0, description="建议的最短重试等待")
    resource_version: ResourceVersion | None = Field(default=None, description="冲突时资源的当前版本")
    details: dict[str, Any] = Field(default_factory=dict, description="与代码相关的补充字段")

    @classmethod
    def of(cls, code: ErrorCode, message: str, *, retryable: bool | None = None, **fields: Any) -> "ErrorInfo":
        return cls(code=code, message=message,
                   retryable=code in RETRYABLE_BY_DEFAULT if retryable is None else retryable, **fields)
