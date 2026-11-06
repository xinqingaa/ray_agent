#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Any

from app.domain.models.error import ErrorCode, ErrorInfo, ResourceVersion


class AppException(RuntimeError):
    """应用异常携带结构化错误，HTTP 状态由接口层按错误代码决定。"""

    def __init__(
            self,
            code: ErrorCode,
            msg: str,
            *,
            retryable: bool | None = None,
            retry_after_ms: int | None = None,
            resource_version: ResourceVersion | None = None,
            details: dict[str, Any] | None = None,
    ):
        self.info = ErrorInfo.of(code, msg, retryable=retryable, retry_after_ms=retry_after_ms,
                                 resource_version=resource_version, details=details or {})
        super().__init__(msg)


class BadRequestError(AppException):
    """客户端请求错误"""

    def __init__(self, msg: str = "客户端请求错误，请检查后重试", **fields: Any):
        super().__init__(ErrorCode.INVALID_REQUEST, msg, **fields)


class NotFoundError(AppException):
    """资源未找到错误"""

    def __init__(self, msg: str = "资源未找到，请核实后重试", **fields: Any):
        super().__init__(ErrorCode.NOT_FOUND, msg, **fields)


class ConflictError(AppException):
    """请求与资源当前状态冲突，例如重复回复审批；版本冲突时带 resource_version"""

    def __init__(self, msg: str = "请求与当前状态冲突，请刷新后重试", **fields: Any):
        super().__init__(ErrorCode.CONFLICT, msg, **fields)


class ValidationError(AppException):
    """数据校验错误"""

    def __init__(self, msg: str = "请求参数数据校验错误，请核实后重试", **fields: Any):
        super().__init__(ErrorCode.VALIDATION_FAILED, msg, **fields)


class GoneError(AppException):
    """资源已过期或删除"""

    def __init__(self, msg: str = "资源已过期或删除", **fields: Any):
        super().__init__(ErrorCode.GONE, msg, **fields)


class ServerRequestsError(AppException):
    """服务器异常错误"""

    def __init__(self, msg: str = "服务器出现异常请稍后重试", **fields: Any):
        super().__init__(ErrorCode.INTERNAL_ERROR, msg, **fields)
