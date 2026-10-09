"""来源独立，预览协议共用；原始内容按范围读取，仅允许图片/PDF 内联。"""
import mimetypes
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import StreamingResponse

from app.application.errors.exceptions import BadRequestError, AppException
from app.domain.models.file_preview import PreviewQuery, preview_kind
from app.domain.services.project_file_coordinator import run_file_io
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_file_preview_service

router = APIRouter(tags=['文件预览'])


@router.get('/files/{file_id}/preview')
async def attachment_preview(file_id: str, query: PreviewQuery = Depends(), service=Depends(get_file_preview_service)):
    return Response.success(data=await service.preview(query, file_id=file_id))


@router.get('/projects/{identifier}/preview')
async def project_preview(identifier: str, path: str = Query(), query: PreviewQuery = Depends(), service=Depends(get_file_preview_service)):
    return Response.success(data=await service.preview(query, identifier=identifier, path=path, project_level=True))


@router.get('/sessions/{identifier}/project/preview')
async def session_project_preview(identifier: str, path: str = Query(), query: PreviewQuery = Depends(), service=Depends(get_file_preview_service)):
    return Response.success(data=await service.preview(query, identifier=identifier, path=path))


async def inline_content(request, service, revision=None, **source):
    # Keep the context open until the streaming response finishes, including cancellation.
    context = service.source(**source)
    handle, filename, size, current = await context.__aenter__()
    try:
        if revision and revision != current:
            from app.application.errors.exceptions import ConflictError
            raise ConflictError('文件已更新，请刷新')
        if preview_kind(filename) not in ('image', 'pdf'):
            raise BadRequestError('此格式不支持内联查看')
        start, end, status = 0, size-1, 200
        range_header = request.headers.get('range')
        if range_header:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
            if not match or not any(match.groups()):
                raise AppException(416, 416, '读取范围无效')
            left, right = match.groups()
            if left:
                start = int(left); end = min(int(right), end) if right else end
            else:
                start = max(0, size-int(right))
            if start > end or start >= size:
                raise AppException(416, 416, '读取范围无效')
            status = 206
        handle.seek(start)
        headers = {'Content-Disposition': "inline; filename*=utf-8''"+quote(filename, safe=''),
            'Content-Length':str(max(0,end-start+1)), 'Accept-Ranges':'bytes', 'Cache-Control':'no-store',
            'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox; default-src 'none'"}
        if status == 206:
            headers['Content-Range'] = f'bytes {start}-{end}/{size}'
        async def body():
            import asyncio
            remaining = end-start+1
            try:
                while remaining>0:
                    chunk, cancelled = await run_file_io(handle.read, min(remaining,256*1024))
                    if cancelled:
                        raise asyncio.CancelledError
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                await context.__aexit__(None,None,None)
        return StreamingResponse(body(), status_code=status,
            media_type=mimetypes.guess_type(filename)[0] or 'application/octet-stream', headers=headers)
    except BaseException:
        await context.__aexit__(None,None,None)
        raise


@router.get('/files/{file_id}/preview/content')
async def attachment_content(file_id: str, request: Request, revision: str | None = None, service=Depends(get_file_preview_service)):
    return await inline_content(request, service, revision, file_id=file_id)


@router.get('/projects/{identifier}/preview/content')
async def project_content(identifier: str, request: Request, path: str = Query(), revision: str | None = None, service=Depends(get_file_preview_service)):
    return await inline_content(request, service, revision, identifier=identifier, path=path, project_level=True)


@router.get('/sessions/{identifier}/project/preview/content')
async def session_project_content(identifier: str, request: Request, path: str = Query(), revision: str | None = None, service=Depends(get_file_preview_service)):
    return await inline_content(request, service, revision, identifier=identifier, path=path)
