#!/usr/bin/env python
# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, Query

from app.application.services.project_service import ProjectService
from app.domain.models.project import ProjectListing, ProjectFile
from app.interfaces.schemas import Response
from app.interfaces.schemas.project import (ProjectPage, ProjectDetails,
    CreateProjectRequest, ArchiveProjectRequest, ProjectSettings)
from app.interfaces.schemas.session import ListSessionResponse
from app.interfaces.service_dependencies import get_project_service

router = APIRouter(prefix="/projects", tags=["项目模块"])


@router.get("", response_model=Response[ProjectPage], summary="分页列出长期项目")
async def list_projects(archived: bool = Query(False), offset: int = Query(0, ge=0),
                        limit: int = Query(50, ge=1, le=100), project_service: ProjectService = Depends(get_project_service)):
    projects, total = await project_service.page(archived=archived, offset=offset, limit=limit)
    return Response.success(data=ProjectPage(projects=projects, total=total, offset=offset, limit=limit))


@router.post("", response_model=Response[ProjectDetails], summary="新建托管项目，不创建对话或沙箱")
async def create_project(request: CreateProjectRequest, project_service: ProjectService = Depends(get_project_service)):
    project = await project_service.create(request.name, request.instructions)
    return Response.success(data=await project_service.detail(project.id))


@router.get("/{project_id}", response_model=Response[ProjectDetails], summary="读取项目与当前可用性")
async def get_project(project_id: str, project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.detail(project_id))


@router.put("/{project_id}", response_model=Response[ProjectDetails], summary="保存项目名称与说明")
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


@router.post("/{project_id}/settling/retry", response_model=Response[ProjectDetails])
async def retry_settling(project_id: str, project_service: ProjectService = Depends(get_project_service)):
    await project_service.retry_settling(project_id)
    return Response.success(data=await project_service.detail(project_id))


@router.get("/{project_id}/events", response_model=Response[list[dict]])
async def project_events(project_id: str, after_seq: int = Query(0, ge=0),
                         limit: int = Query(50, ge=1, le=100),
                         project_service: ProjectService = Depends(get_project_service)):
    return Response.success(data=await project_service.events(project_id, after_seq, limit))
