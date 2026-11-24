"""应用内受管轻量服务与项目预览接口。"""
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import Response as RawResponse, StreamingResponse

from app.application.services.preview_runtime_service import PreviewRuntimeService
from app.domain.models.identity import PreviewId, SessionId, WorkspaceId
from app.interfaces.schemas import Response
from app.interfaces.schemas.managed_preview import (
    ManagedPreviewDeleteResponse,
    ManagedPreviewListResponse,
    ManagedPreviewLogsResponse,
    ManagedPreviewView,
)
from app.interfaces.service_dependencies import get_preview_runtime_service

router = APIRouter(prefix="/previews", tags=["项目预览"])


@router.get(
    "",
    response_model=Response[ManagedPreviewListResponse],
    summary="获取已登记的项目预览列表",
)
async def list_managed_previews(
    workspace_id: Optional[WorkspaceId] = Query(default=None),
    session_id: Optional[SessionId] = Query(default=None),
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewListResponse]:
    previews = await service.list_previews(workspace_id=workspace_id, session_id=session_id)
    return Response.success(data=ManagedPreviewListResponse(previews=previews))


@router.get(
    "/{preview_id}",
    response_model=Response[ManagedPreviewView],
    summary="获取单个项目预览详情与当前运行状态",
)
async def get_managed_preview(
    preview_id: PreviewId,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewView]:
    preview = await service.get_preview(preview_id)
    return Response.success(data=preview)


@router.post(
    "/{preview_id}/start",
    response_model=Response[ManagedPreviewView],
    summary="启动轻量预览服务",
)
async def start_managed_preview(
    preview_id: PreviewId,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewView]:
    preview = await service.start(preview_id)
    return Response.success(data=preview)


@router.post(
    "/{preview_id}/stop",
    response_model=Response[ManagedPreviewView],
    summary="停止轻量预览服务",
)
async def stop_managed_preview(
    preview_id: PreviewId,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewView]:
    preview = await service.stop(preview_id)
    return Response.success(data=preview)


@router.post(
    "/{preview_id}/restart",
    response_model=Response[ManagedPreviewView],
    summary="重启轻量预览服务",
)
async def restart_managed_preview(
    preview_id: PreviewId,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewView]:
    preview = await service.restart(preview_id)
    return Response.success(data=preview)


@router.get(
    "/{preview_id}/logs",
    response_model=Response[ManagedPreviewLogsResponse],
    summary="读取轻量预览服务增量日志",
)
async def get_managed_preview_logs(
    preview_id: PreviewId,
    offset: int = Query(default=0, ge=0),
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewLogsResponse]:
    logs = await service.read_logs(preview_id, offset=offset)
    return Response.success(data=logs)


@router.get("/{preview_id}/export.zip", summary="将已登记预览项目目录打包导出为 ZIP")
@router.head("/{preview_id}/export.zip", summary="核对项目目录 ZIP 导出是否可用")
async def export_managed_preview_zip(
    preview_id: PreviewId,
    request: Request,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
):
    if request.method == "HEAD":
        _, filename = await service.check_export_zip(preview_id)
        encoded = quote(filename, safe="")
        return RawResponse(
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=utf-8''{encoded}",
                "Cache-Control": "no-store",
            },
        )
    stream, filename = await service.export_zip(preview_id)
    encoded = quote(filename, safe="")

    def chunks():
        try:
            while chunk := stream.read(256 * 1024):
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=utf-8''{encoded}",
            "Cache-Control": "no-store",
        },
    )


@router.delete(
    "/{preview_id}",
    response_model=Response[ManagedPreviewDeleteResponse],
    summary="停止并移除项目预览登记",
)
async def delete_managed_preview(
    preview_id: PreviewId,
    service: PreviewRuntimeService = Depends(get_preview_runtime_service),
) -> Response[ManagedPreviewDeleteResponse]:
    deleted = await service.delete(preview_id)
    return Response.success(data=ManagedPreviewDeleteResponse(deleted=deleted))
