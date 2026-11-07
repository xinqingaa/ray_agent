"""按 root_id 加相对路径访问文件：列目录、读元数据与内容、预览、把文件放进工作区文件夹。

接口不接受桌面绝对路径；符号链接只报告类型，不展开；保留目录 `.rayagent` 与排除规则之内的内容不出现。
"""
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from starlette.responses import Response as RawResponse

from app.application.services.file_preview_service import FilePreviewService
from app.application.services.root_access import RootFileService
from app.domain.models.file_preview import PreviewQuery
from app.interfaces.endpoints.preview_routes import inline_content
from app.interfaces.instance_access import issue_ticket
from app.interfaces.schemas import Response
from app.interfaces.schemas.core import ResourceTicket
from app.interfaces.schemas.workspace import RootEntryResponse, RootEntryView, RootListing
from app.interfaces.service_dependencies import get_file_preview_service, get_root_file_service

router = APIRouter(prefix="/roots", tags=["工作区文件"])

PathQuery = Query(default="", max_length=4096, description="根内相对路径，空串为根本身")


@router.get("/{root_id}/entries", response_model=Response[RootListing], summary="列出目录")
async def list_entries(root_id: str, path: str = PathQuery, service: RootFileService = Depends(get_root_file_service)):
    listing = await service.list(root_id, path)
    return Response.success(RootListing(path=listing.path, truncated=listing.truncated,
                                        entries=[RootEntryView.of(entry) for entry in listing.entries]))


@router.get("/{root_id}/entry", response_model=Response[RootEntryResponse], summary="读取文件或目录的元数据")
async def get_entry(root_id: str, path: str = PathQuery, service: RootFileService = Depends(get_root_file_service)):
    return Response.success(RootEntryResponse(entry=RootEntryView.of(await service.stat(root_id, path))))


@router.get("/{root_id}/content", summary="读取文件的原始字节",
            description="按 offset 与 length 分段读取，单次有上限；始终作为附件返回，不内联渲染")
async def read_content(root_id: str, path: str = PathQuery, offset: int = Query(default=0, ge=0),
                       length: int | None = Query(default=None, ge=0),
                       service: RootFileService = Depends(get_root_file_service)):
    data, entry = await service.read(root_id, path, offset, length)
    return RawResponse(data, media_type="application/octet-stream", headers={
        "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "X-File-Size": str(entry.version.size)})


@router.get("/{root_id}/preview", summary="文件预览",
            description="与附件预览同一协议；revision 随文件大小与修改时间变化")
async def preview(root_id: str, path: str = PathQuery, query: PreviewQuery = Depends(),
                  service: FilePreviewService = Depends(get_file_preview_service)):
    return Response.success(data=await service.preview(query, root_id=root_id, relative_path=path))


@router.post("/{root_id}/preview/ticket", response_model=Response[ResourceTicket], summary="签发原始内容的读取票据",
             description="图片、PDF 与网页按 URL 加载：用 /roots/{root_id}/preview/content/{path} 并带 ticket 参数")
async def content_ticket(root_id: str, request: Request, path: str = Query(min_length=1, max_length=4096)):
    ticket, expires_at = issue_ticket(request.app.url_path_for("root_content", root_id=root_id, relative_path=path))
    return Response.success(data=ResourceTicket(ticket=ticket, expires_at=expires_at))


@router.get("/{root_id}/preview/content/{relative_path:path}", name="root_content", summary="原始内容的内联读取",
            description="只放行图片、PDF 与网页；需要票据")
async def content(root_id: str, relative_path: str, request: Request, revision: str | None = None,
                  service: FilePreviewService = Depends(get_file_preview_service)):
    return await inline_content(request, service, revision, root_id=root_id, relative_path=relative_path)


@router.post("/{root_id}/upload", response_model=Response[RootEntryResponse], summary="把文件放进工作区文件夹",
             description="复制到根目录，directory 可指定子目录；同名文件不覆盖，自动取不冲突的名称。归档的工作区不可写")
async def upload(root_id: str, file: UploadFile = File(...), directory: str = Form(default=""),
                 service: RootFileService = Depends(get_root_file_service)):
    entry = await service.add_file(root_id, directory, file.filename or "", file.file)
    return Response.success(RootEntryResponse(entry=RootEntryView.of(entry)))
