#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging

from fastapi import APIRouter, Depends

from app.application.services.capability_service import CapabilityService
from app.application.services.status_service import StatusService
from app.interfaces.core_descriptor import build_identity, describe_core
from app.interfaces.schemas import Response
from app.interfaces.schemas.core import BuildIdentity, CoreStatus
from app.interfaces.service_dependencies import get_capability_service, get_status_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/status", tags=["状态模块"])


@router.get(
    path="",
    response_model=Response[CoreStatus],
    summary="核心状态",
    description="返回协议与事件版本、构建与实例身份、存储版本、能力声明和依赖服务检查。依赖异常时仍返回 200，healthy 为 false。",
)
async def get_status(
        status_service: StatusService = Depends(get_status_service),
        capability_service: CapabilityService = Depends(get_capability_service),
) -> Response[CoreStatus]:
    services = await status_service.check_all()
    status = CoreStatus(**describe_core(await capability_service.current()),
                        healthy=all(item.status == "ok" for item in services), services=services)
    return Response.success(data=status)


@router.get('/build', response_model=Response[BuildIdentity], summary='读取 API 构建身份')
async def get_build() -> Response[BuildIdentity]:
    return Response.success(data=build_identity())
