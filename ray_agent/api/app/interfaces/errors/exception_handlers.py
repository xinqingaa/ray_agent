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


_PROVIDERS_PATH = "/api/app-config/llm/providers"


def _problem_text(item: dict) -> str:
    """把 Pydantic 错误类型译成简短中文；只说明问题，不回显用户输入的取值。"""
    kind, ctx = item["type"], item.get("ctx") or {}
    if kind == "value_error":
        return str(item["msg"]).removeprefix("Value error, ")
    if kind == "greater_than":
        return f"须大于 {ctx.get('gt')}"
    if kind == "less_than_equal":
        return f"须不超过 {ctx.get('le')}"
    if kind == "too_long":
        return f"长度不能超过 {ctx.get('max_length')}"
    if kind == "string_pattern_mismatch":
        return "格式不正确"
    if kind == "missing":
        return "缺少该项"
    if kind.startswith("url_"):
        return "地址格式不正确"
    if kind.endswith(("_type", "_parsing")):
        return "类型不正确"
    return "取值不合法"


def provider_validation(errors: list[dict]) -> tuple[str, dict[str, str]]:
    """提供商保存或检测的请求校验：返回总消息，以及每个模型 ID 各自的说明，便于界面定位到对应模型行。"""
    parts: list[str] = []
    models: dict[str, str] = {}
    for item in errors:
        loc = [str(part) for part in item["loc"] if part != "body"]
        text = _problem_text(item)
        if len(loc) >= 2 and loc[0] == "custom_models":
            model, fields = loc[1], [part for part in loc[2:] if not part.isdigit()]
            line = f"模型 {model} 的 {'.'.join(fields)} 无效：{text}" if fields else f"模型 {model} 无效：{text}"
            models.setdefault(model, line)
        else:
            fields = [part for part in loc if not part.isdigit()]
            line = f"{'.'.join(fields) or '请求'} 无效：{text}"
        parts.append(line)
    return "；".join(dict.fromkeys(parts)) or "请求参数校验失败，请核实后重试", models


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
        errors = e.errors()
        message = "请求参数校验失败，请核实后重试"
        details: dict = {}
        if req.url.path.startswith(_PROVIDERS_PATH):
            message, models = provider_validation(errors)
            details["models"] = models
            errors = [{"loc": item["loc"], "type": item["type"], "msg": item["msg"]} for item in errors]
        details["errors"] = jsonable_encoder(errors)
        return error_response(ErrorInfo.of(ErrorCode.VALIDATION_FAILED, message, details=details))

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
