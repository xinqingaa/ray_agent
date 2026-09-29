#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import List

from fastapi import APIRouter, Depends, Query

from app.application.services.project_service import ProjectService
from app.domain.models.project import BrowseListing, ProjectView
from app.interfaces.schemas import Response
from app.interfaces.schemas.project import ProjectRootItem, ProjectRootsResponse
from app.interfaces.service_dependencies import get_project_service

router = APIRouter(prefix="/projects", tags=["项目模块"])


@router.get(
    path="/roots",
    response_model=Response[ProjectRootsResponse],
    summary="列出允许接入的项目根目录",
    description="enabled 为 PROJECT_ROOTS 非空。每个根目录带 available；不存在或不是目录的根仍返回且 available 为 false",
)
async def list_project_roots(
        project_service: ProjectService = Depends(get_project_service),
) -> Response[ProjectRootsResponse]:
    enabled, roots = project_service.list_roots()
    return Response.success(
        msg="获取项目根目录成功",
        data=ProjectRootsResponse(
            enabled=enabled,
            roots=[ProjectRootItem(path=root.path, available=root.available) for root in roots],
        ),
    )


@router.get(
    path="/browse",
    response_model=Response[BrowseListing],
    summary="浏览允许根目录内的一层子目录",
    description="只列目录，并标出哪些是 Git 仓库。路径校验失败返回 400",
)
async def browse_projects(
        path: str = Query(),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[BrowseListing]:
    listing = await project_service.browse(path)
    return Response.success(msg="浏览项目目录成功", data=listing)


@router.get(
    path="/recent",
    response_model=Response[List[ProjectView]],
    summary="最近绑定过的项目",
    description="按 project_path 分组，取组内最大 updated_at 倒序。每项的 available/reason 实时计算",
)
async def list_recent_projects(
        limit: int = Query(default=10, ge=1, le=100),
        project_service: ProjectService = Depends(get_project_service),
) -> Response[List[ProjectView]]:
    projects = await project_service.list_recent(limit)
    return Response.success(msg="获取最近项目成功", data=projects)
