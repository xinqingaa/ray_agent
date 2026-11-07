#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""所有失败响应都是 ErrorResponse：HTTP 状态由错误代码决定，原有异常按状态或类型映射到代码。"""
import logging
import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.application.errors.exceptions import AppException
from app.domain.models.error import ErrorCode, ErrorInfo
from app.interfaces.schemas import ErrorResponse

logger = logging.getLogger(__name__)

HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.METHOD_NOT_ALLOWED: 405,
    ErrorCode.CONFLICT: 409,
    ErrorCode.GONE: 410,
    ErrorCode.PAYLOAD_TOO_LARGE: 413,
    ErrorCode.RANGE_NOT_SATISFIABLE: 416,
    ErrorCode.VALIDATION_FAILED: 422,
    ErrorCode.CONTEXT_LIMIT: 422,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.INTERNAL_ERROR: 500,
    ErrorCode.UPSTREAM_ERROR: 502,
    ErrorCode.UNAVAILABLE: 503,
    ErrorCode.TIMEOUT: 504,
}
_STATUS_CODES = {status: code for code, status in HTTP_STATUS.items() if code is not ErrorCode.CONTEXT_LIMIT}


def code_for_status(status: int) -> ErrorCode:
    return _STATUS_CODES.get(status) or (ErrorCode.INTERNAL_ERROR if status >= 500 else ErrorCode.INVALID_REQUEST)


def error_response(info: ErrorInfo, status: int | None = None, headers: dict[str, str] | None = None) -> JSONResponse:
    headers = dict(headers or {})
    if info.retry_after_ms is not None:
        headers["Retry-After"] = str(math.ceil(info.retry_after_ms / 1000))
    return JSONResponse(status_code=status or HTTP_STATUS[info.code],
                        content=ErrorResponse(error=info).model_dump(mode="json"), headers=headers or None)


def register_exception_handlers(app: FastAPI) -> None:
    """业务异常、请求校验、HTTP 异常与未处理异常统一为结构化错误。"""

    from app.domain.services.skill_packages import SkillError

    @app.exception_handler(SkillError)
    async def skill_exception_handler(req: Request, e: SkillError) -> JSONResponse:
        return error_response(ErrorInfo.of(code_for_status(e.status), str(e)), e.status)

    from app.infrastructure.storage.sqlite import DatabaseBusyError

    @app.exception_handler(DatabaseBusyError)
    async def database_busy_handler(req: Request, e: DatabaseBusyError) -> JSONResponse:
        return error_response(ErrorInfo.of(ErrorCode.UNAVAILABLE, str(e), retry_after_ms=1000))

    @app.exception_handler(AppException)
    async def app_exception_handler(req: Request, e: AppException) -> JSONResponse:
        logger.error(f"AppException[{e.info.code}]: {e.info.message}")
        return error_response(e.info)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(req: Request, e: RequestValidationError) -> JSONResponse:
        return error_response(ErrorInfo.of(ErrorCode.VALIDATION_FAILED, "请求参数校验失败，请核实后重试",
                                           details={"errors": jsonable_encoder(e.errors())}))

    @app.exception_handler(HTTPException)
    async def http_exception_handler(req: Request, e: HTTPException) -> JSONResponse:
        logger.error(f"HTTPException: {e.detail}")
        message = e.detail if isinstance(e.detail, str) else "请求失败"
        details = {} if isinstance(e.detail, str) else {"detail": jsonable_encoder(e.detail)}
        return error_response(ErrorInfo.of(code_for_status(e.status_code), message, details=details),
                              e.status_code, e.headers)

    @app.exception_handler(Exception)
    async def exception_handler(req: Request, e: Exception) -> JSONResponse:
        logger.error(f"Exception: {str(e)}")
        return error_response(ErrorInfo.of(ErrorCode.INTERNAL_ERROR, "服务器出现异常请稍后重试"))
