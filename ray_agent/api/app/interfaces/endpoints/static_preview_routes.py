"""独立只读静态预览挂载与目录打包导出接口。"""
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response as RawResponse, StreamingResponse

from app.application.services.static_preview_service import StaticPreviewService
from app.interfaces.schemas import Response
from app.interfaces.schemas.static_preview import (
    StaticPreviewDeleteResult,
    StaticPreviewMount,
    StaticPreviewMountRequest,
)
from app.interfaces.service_dependencies import get_static_preview_service

router = APIRouter(prefix="/previews/static", tags=["静态预览"])


@router.post(
    "/mounts",
    response_model=Response[StaticPreviewMount],
    summary="创建独立静态预览挂载",
    description="为单 HTML 附件、工作区/会话 HTML 文件或静态目录签发短期只读挂载地址",
)
async def create_static_mount(
    body: StaticPreviewMountRequest,
    request: Request,
    service: StaticPreviewService = Depends(get_static_preview_service),
) -> Response[StaticPreviewMount]:
    mount = await service.create_mount(body, parent_origin=request.headers.get("origin"))
    return Response.success(data=mount)


@router.delete(
    "/mounts/{mount_token}",
    response_model=Response[StaticPreviewDeleteResult],
    summary="撤销静态预览挂载",
)
async def delete_static_mount(
    mount_token: str,
    service: StaticPreviewService = Depends(get_static_preview_service),
) -> Response[StaticPreviewDeleteResult]:
    service.delete_mount(mount_token)
    return Response.success(data=StaticPreviewDeleteResult(deleted=True))


@router.get("/mounts/{mount_token}/export.zip", summary="将静态目录预览打包导出为 ZIP")
@router.head("/mounts/{mount_token}/export.zip", summary="核对静态目录 ZIP 导出是否可用")
async def export_static_mount_zip(
    mount_token: str,
    request: Request,
    service: StaticPreviewService = Depends(get_static_preview_service),
):
    if request.method == "HEAD":
        _, filename = service.check_export_zip(mount_token)
        encoded = quote(filename, safe="")
        return RawResponse(
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=utf-8''{encoded}",
                "Cache-Control": "no-store",
            },
        )
    stream, filename = await service.export_zip(mount_token)
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
