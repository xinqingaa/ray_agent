#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.application.errors.exceptions import AppException
from app.interfaces.schemas import Response
from app.domain.services.project_transactions import ProjectRunConflict

logger = logging.getLogger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    """处理MoocManus项目中所有的异常并进行统一处理，涵盖：自定义业务状态异常、HTTP异常、通用异常"""

    @app.exception_handler(ProjectRunConflict)
    async def project_conflict_handler(req: Request, e: ProjectRunConflict) -> JSONResponse:
        data = {"occupying_session_id": e.occupying_session_id} if e.occupying_session_id else {}
        if e.operation:
            data.update(project_id=e.project_id, file_operation=e.operation.model_dump(mode="json"),
                repair_action="retry_settling" if e.operation.kind == "settling" else "repair_restore" if e.operation.kind == "restore" else "read_operation")
        return JSONResponse(status_code=409, content=Response(code=409, msg=str(e), data=data).model_dump())

    @app.exception_handler(AppException)
    async def app_exception_handler(req: Request, e: AppException) -> JSONResponse:
        """处理MoocManus业务异常，将所有状态统一响应结构"""
        logger.error(f"AppException: {e.msg}")
        return JSONResponse(
            status_code=e.code,
            content=Response(
                code=e.status_code,
                msg=e.msg,
                data=e.data if e.data is not None else {}
            ).model_dump(),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(req: Request, e: HTTPException) -> JSONResponse:
        """处理FastAPI抛出的http异常，将所有状态统一响应结构"""
        logger.error(f"HTTPException: {e.detail}")
        return JSONResponse(
            status_code=e.status_code,
            content=Response(
                code=e.status_code,
                msg=e.detail,
                data={}
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def exception_handler(req: Request, e: Exception) -> JSONResponse:
        """处理MoocManus中抛出的未定义的任意一场，将状态码统一设置为500"""
        logger.error(f"Exception: {str(e)}")
        return JSONResponse(
            status_code=500,
            content=Response(
                code=500,
                msg="服务器出现异常请稍后重试",
                data={},
            ).model_dump()
        )
