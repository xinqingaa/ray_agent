#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.application.services.project_service import ProjectService
from app.domain.models.project import BrowseListing, ProjectListing, ProjectFile, GitStatus, GitDiff, PATH_CHECK_MESSAGES
from app.interfaces.schemas import Response
from app.interfaces.schemas.project import (ProjectRootItem, ProjectRootsResponse, ProjectPage, ProjectDetails,
    CreateProjectRequest, ArchiveProjectRequest, ProjectSettings)
from app.interfaces.schemas.session import ListSessionResponse
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
    supported, reason = project_service.availability()
    return Response.success(
        msg="获取项目根目录成功",
        data=ProjectRootsResponse(
            enabled=enabled,
            supported=supported,
            reason=reason,
            roots=[ProjectRootItem(path=root.path, available=root.available,
                                   reason=PATH_CHECK_MESSAGES.get(root.reason)) for root in roots],
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


@router.get("", response_model=Response[ProjectPage], summary="分页列出长期项目")
async def list_projects(archived: bool = Query(False), offset: int = Query(0, ge=0),
                        limit: int = Query(50, ge=1, le=100), project_service: ProjectService = Depends(get_project_service)):
    projects, total = await project_service.page(archived=archived, offset=offset, limit=limit)
    return Response.success(data=ProjectPage(projects=projects, total=total, offset=offset, limit=limit))


@router.post("", response_model=Response[ProjectDetails], summary="登记项目目录，不创建对话或沙箱")
async def create_project(request: CreateProjectRequest, project_service: ProjectService = Depends(get_project_service)):
    project = await project_service.register(request.path, request.name)
    return Response.success(data=await project_service.detail(project.id))


@router.get("/{project_id}", response_model=Response[ProjectDetails], summary="读取项目与当前可用性")
async def get_project(project_id: str, project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.detail(project_id))


@router.put("/{project_id}", response_model=Response[ProjectDetails], summary="保存项目说明与可选 Git 身份")
async def update_project(project_id: str, request: ProjectSettings, project_service: ProjectService = Depends(get_project_service)):
    await project_service.update(project_id, request)
    return Response.success(data=await project_service.detail(project_id))


@router.post("/{project_id}/archive", response_model=Response[ProjectDetails], summary="归档或恢复，保留历史与目录")
async def archive_project(project_id: str, request: ArchiveProjectRequest, project_service: ProjectService = Depends(get_project_service)):
    await project_service.archive(project_id, request.archived)
    return Response.success(data=await project_service.detail(project_id))


@router.get("/{project_id}/sessions", response_model=Response[ListSessionResponse], summary="分页读取项目对话，不加载历史事件")
async def project_sessions(project_id: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), project_service: ProjectService = Depends(get_project_service)):
    from app.interfaces.endpoints.session_routes import session_list_item
    sessions, total = await project_service.sessions(project_id, offset, limit)
    views = project_service.describe_sessions(sessions)
    return Response.success(data=ListSessionResponse(sessions=[session_list_item(session, project_service, views) for session in sessions], total=total, offset=offset, limit=limit))


@router.get("/{project_id}/tree", response_model=Response[ProjectListing])
async def project_tree(project_id: str, path: str = Query(""), project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.tree(project_id, path, project_level=True))


@router.get("/{project_id}/file", response_model=Response[ProjectFile])
async def project_file(project_id: str, path: str = Query(), project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.read_file(project_id, path, project_level=True))


@router.get("/{project_id}/git/status", response_model=Response[GitStatus])
async def project_git_status(project_id: str, project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.git_status(project_id, project_level=True))


@router.get("/{project_id}/git/diff", response_model=Response[GitDiff])
async def project_git_diff(project_id: str, scope: str = Query("worktree"), path: Optional[str] = Query(None), project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.git_diff(project_id, scope, path, project_level=True))
