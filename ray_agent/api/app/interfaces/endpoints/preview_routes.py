"""来源独立，预览协议共用；原始内容按范围读取，仅允许图片/PDF/HTML 内联。"""
import mimetypes
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import Response as StarletteResponse, StreamingResponse

from app.application.errors.exceptions import BadRequestError, AppException
from app.domain.models.file_preview import PreviewQuery, preview_kind
from app.domain.services.project_file_coordinator import run_file_io
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_file_preview_service

router = APIRouter(tags=['文件预览'])

INLINE_CSP = "sandbox; default-src 'none'"
HTML_EXTENSIONS = {'.html', '.htm'}
# 交付的网页在新标签页直接打开：sandbox 让页面成为不透明来源，读不到本站 Cookie 与存储；
# connect-src/form-action 为 none，脚本只能操作自身页面，不能请求本站接口或提交表单。
HTML_CSP = ("sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox; "
            "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:; "
            "style-src 'unsafe-inline' https: data:; img-src data: blob: https:; font-src data: https:; "
            "media-src data: blob: https:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'")
# 不透明来源访问 localStorage/sessionStorage 会抛错，生成的网页常在首行读写存储，整段脚本随之中断；
# 换成只在本页内存里的替身，刷新即清空。
STORAGE_SHIM = (b"<script>(()=>{for(const n of['localStorage','sessionStorage']){try{window[n].length}catch(e){"
    b"const m=new Map(),s={getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>{m.set(String(k),String(v))},"
    b"removeItem:k=>{m.delete(String(k))},clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}};"
    b"try{Object.defineProperty(window,n,{value:s,configurable:true})}catch(e){}}}})()</script>")
_DOCTYPE = re.compile(rb'^(\xef\xbb\xbf)?\s*<!doctype[^>]*>', re.IGNORECASE)


def with_storage_shim(page: bytes) -> bytes:
    """替身放在 doctype 之后、其余内容之前，不改变页面的标准模式。"""
    match = _DOCTYPE.match(page)
    cut = match.end() if match else 0
    return page[:cut] + STORAGE_SHIM + page[cut:]


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
        html = Path(filename).suffix.lower() in HTML_EXTENSIONS
        if not html and preview_kind(filename) not in ('image', 'pdf'):
            raise BadRequestError('此格式不支持内联查看')
        if html:
            data, cancelled = await run_file_io(handle.read)
            if cancelled:
                import asyncio
                raise asyncio.CancelledError
            opened, context = context, None
            await opened.__aexit__(None, None, None)
            return StarletteResponse(with_storage_shim(data), media_type='text/html; charset=utf-8', headers={
                'Content-Disposition': "inline; filename*=utf-8''"+quote(filename, safe=''),
                'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': HTML_CSP})
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
            'X-Content-Type-Options':'nosniff', 'Content-Security-Policy': INLINE_CSP}
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
        if context is not None:
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
