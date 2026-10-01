#!/usr/bin/env python
# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, Query, UploadFile, File
from pydantic import BaseModel
from app.application.services.project_file_service import ProjectFileService
from app.application.errors.exceptions import BadRequestError, ServerRequestsError, NotFoundError

from app.application.services.project_service import ProjectService
from app.domain.models.project import ProjectListing, ProjectFile
from app.interfaces.schemas import Response
from app.interfaces.schemas.project import (ProjectPage, ProjectDetails,
    CreateProjectRequest, ArchiveProjectRequest, ProjectSettings)
from app.interfaces.schemas.session import ListSessionResponse
from app.interfaces.service_dependencies import get_project_service, get_project_file_service

from app.domain.models.project_upload import ProjectUploadSelection

router = APIRouter(prefix="/projects", tags=["项目模块"])


@router.get('/upload-rules', response_model=Response[dict])
async def upload_rules(service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=service.upload_rules())


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


class RepairRestoreRequest(BaseModel):
    operation_id: str
    return_before: bool = False


async def file_action(awaitable):
    try:
        return await awaitable
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
    except FileNotFoundError as exc:
        raise NotFoundError('项目文件不存在') from exc
    except OSError as exc:
        raise ServerRequestsError('项目文件操作失败：' + str(exc)) from exc


@router.get('/{project_id}/snapshots', response_model=Response[list])
async def snapshots(project_id: str, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.snapshots(project_id)))


@router.post('/{project_id}/snapshots/{snapshot_id}/restore', response_model=Response[dict])
async def restore_snapshot(project_id: str, snapshot_id: str, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.restore(project_id, snapshot_id)))


@router.post('/{project_id}/restore/repair', response_model=Response[dict])
async def repair_restore(project_id: str, request: RepairRestoreRequest, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.repair_restore(project_id, request.operation_id, return_before=request.return_before)))


@router.post('/{project_id}/snapshots/cleanup', response_model=Response[dict])
async def cleanup_snapshots(project_id: str, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.cleanup(project_id)))


@router.post('/{project_id}/operations/reconcile', response_model=Response[dict])
async def reconcile_files(project_id: str, request: RepairRestoreRequest, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.reconcile_operation(project_id, request.operation_id)))


@router.post('/{project_id}/uploads/preflight', response_model=Response[dict])
async def preflight_upload(project_id: str, request: ProjectUploadSelection, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.preflight_upload(project_id, request)))


@router.post('/{project_id}/uploads', response_model=Response[dict])
async def start_upload(project_id: str, request: ProjectUploadSelection, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.start_upload(project_id, request)))


@router.put('/{project_id}/uploads/{operation_id}/file', response_model=Response[dict])
async def upload_item(project_id: str, operation_id: str, path: str = Query(), file: UploadFile = File(),
                      service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.upload_item(project_id, operation_id, path, file.file)))


@router.post('/{project_id}/uploads/{operation_id}/finish', response_model=Response[dict])
async def finish_upload(project_id: str, operation_id: str, cancel: bool = Query(False),
                        service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await file_action(service.end_upload(project_id, operation_id, cancel=cancel)))


@router.get('/{project_id}/operations/{operation_id}', response_model=Response[dict])
async def operation_result(project_id: str, operation_id: str, service: ProjectFileService = Depends(get_project_file_service)):
    return Response.success(data=await service.operation_result(project_id, operation_id))


@router.get('/{project_id}/download')
async def download_project(project_id: str, path: str | None = Query(None), service: ProjectFileService = Depends(get_project_file_service)):
    from urllib.parse import quote
    from starlette.responses import StreamingResponse
    content, filename, media_type, warning = await file_action(service.download(project_id, path))
    return StreamingResponse(content, media_type=media_type, headers={
        'Content-Disposition': "attachment; filename*=utf-8''" + quote(filename, safe=''),
        'X-RayAgent-Download-Warning': quote(warning, safe=''),
        'Cache-Control': 'no-store',
    })


@router.get('/{project_id}/file-copies', response_model=Response[list])
async def file_copies(project_id: str, service: ProjectFileService = Depends(get_project_file_service)):
    await service.get(project_id)
    async with service.factory() as uow:
        copies = await uow.project.file_copies(project_id)
    return Response.success(data=copies)
