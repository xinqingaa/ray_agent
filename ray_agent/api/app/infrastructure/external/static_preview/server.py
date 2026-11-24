"""独立回环只读静态预览服务器：按高熵挂载令牌隔离服务单文件与多文件静态站点。"""
import asyncio
import json
import logging
import re
import socket
from typing import Callable, Optional
from urllib.parse import quote, unquote

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse, RedirectResponse, Response as StarletteResponse, StreamingResponse
from starlette.routing import Route

from app.application.errors.exceptions import AppException
from app.application.services.static_preview_service import StaticAsset, StaticPreviewService
from app.domain.models.error import ErrorCode
from app.domain.services.file_io import run_file_io
from app.interfaces.errors.exception_handlers import HTTP_STATUS

logger = logging.getLogger(__name__)

_DOCTYPE = re.compile(rb"^(\xef\xbb\xbf)?\s*<!doctype[^>]*>", re.IGNORECASE)
_READ_METHODS = frozenset({"GET", "HEAD"})
_STREAM_CHUNK = 256 * 1024
_BRIDGE_MAX_BYTES = 50 * 1024 * 1024
_SHUTDOWN_TIMEOUT_SECONDS = 5.0


def inject_download_bridge(
    page: bytes,
    mount_token: str,
    parent_origin: str | None,
    max_bridge_bytes: int = _BRIDGE_MAX_BYTES,
) -> bytes:
    """在 iframe 预览页注入轻量 blob:/data: 导出桥；独立标签外开时自动空操作。"""
    token_json = json.dumps(mount_token)
    target_json = json.dumps(parent_origin or "*")
    max_json = json.dumps(max_bridge_bytes)
    script = (
        "<script>(()=>{"
        "if(window.parent===window)return;"
        f"const TOKEN={token_json},TARGET={target_json},MAX={max_json};"
        "const blobs=new Map(),U=window.URL||window.webkitURL;"
        "if(U&&typeof U.createObjectURL==='function'){"
        "const origCreate=U.createObjectURL.bind(U);"
        "U.createObjectURL=function(obj){"
        "const url=origCreate(obj);"
        "if(obj instanceof Blob){"
        "if(blobs.size>=64){const first=blobs.keys().next().value;if(first!==undefined)blobs.delete(first);}"
        "blobs.set(url,obj);"
        "}"
        "return url;"
        "};"
        "if(typeof U.revokeObjectURL==='function'){"
        "const origRevoke=U.revokeObjectURL.bind(U);"
        "U.revokeObjectURL=function(url){origRevoke(url);setTimeout(()=>{blobs.delete(url);},5000);};"
        "}"
        "}"
        "const guessExt=(m)=>{const t=(m||'').split(';')[0].trim().toLowerCase();"
        "if(t==='text/calendar')return '.ics';if(t==='text/csv')return '.csv';"
        "if(t==='application/json')return '.json';if(t==='text/html')return '.html';"
        "if(t==='text/plain')return '.txt';if(t==='image/svg+xml')return '.svg';"
        "if(t==='image/png')return '.png';return '';};"
        "const decodeData=(href)=>{const i=href.indexOf(',');if(i<0)return null;"
        "const meta=href.slice(5,i),body=href.slice(i+1),mime=(meta.split(';')[0]||'application/octet-stream').trim();"
        "if(/;base64/i.test(meta)){const bin=atob(body),out=new Uint8Array(bin.length);"
        "for(let k=0;k<bin.length;k++)out[k]=bin.charCodeAt(k);return new Blob([out],{type:mime});}"
        "return new Blob([decodeURIComponent(body)],{type:mime});};"
        "const relay=(a)=>{const href=a.getAttribute('href')||a.href||'';"
        "if(!href||(!href.startsWith('blob:')&&!href.startsWith('data:')))return false;"
        "if(!a.hasAttribute('download'))return false;"
        "const rawName=(a.getAttribute('download')||'').trim();"
        "const cached=href.startsWith('blob:')?blobs.get(href):decodeData(href);"
        "Promise.resolve(cached||fetch(href).then(r=>r.blob())).then(async(blob)=>{"
        "const buf=await blob.arrayBuffer();"
        "if(buf.byteLength>MAX){"
        "window.parent.postMessage({type:'rayagent:preview-download-error',mountToken:TOKEN,message:'导出文件超过 50 MiB 限制'},TARGET);"
        "return;"
        "}"
        "const mime=blob.type||'application/octet-stream';"
        "const filename=rawName||('download'+guessExt(mime));"
        "window.parent.postMessage({type:'rayagent:preview-download',mountToken:TOKEN,filename,mimeType:mime,bytes:buf},TARGET,[buf]);"
        "}).catch(()=>{"
        "window.parent.postMessage({type:'rayagent:preview-download-error',mountToken:TOKEN,message:'导出文件读取失败'},TARGET);"
        "});return true;};"
        "document.addEventListener('click',(e)=>{"
        "const t=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
        "if(t&&relay(t)){e.preventDefault();e.stopImmediatePropagation();}"
        "},true);"
        "const origClick=HTMLAnchorElement.prototype.click;"
        "HTMLAnchorElement.prototype.click=function(){if(relay(this))return;return origClick.apply(this,arguments);};"
        "})()</script>"
    ).encode("utf-8")
    match = _DOCTYPE.match(page)
    cut = match.end() if match else 0
    return page[:cut] + script + page[cut:]


def build_static_preview_csp(
    port: int,
    mount_token: str,
    *,
    kind: str,
    parent_origin: str | None,
) -> str:
    """按挂载前缀隔离 CSP：禁止跨挂载互访或请求 Core API，允许同挂载静态资源与外部 HTTPS 静态资产。"""
    prefix = f"http://127.0.0.1:{port}/s/{mount_token}/"
    ancestors = (
        f"'self' {parent_origin}"
        if parent_origin
        else "'self' tauri://localhost http://tauri.localhost https://tauri.localhost http://localhost:* http://127.0.0.1:*"
    )
    form_action = prefix if kind == "root_dir" else "'none'"
    connect_src = f"{prefix} blob: data:" if kind == "root_dir" else "blob: data:"
    return (
        "default-src 'none'; "
        f"script-src {prefix} 'unsafe-inline' 'unsafe-eval' https: data: blob:; "
        f"style-src {prefix} 'unsafe-inline' https: data: blob:; "
        f"img-src {prefix} https: data: blob:; "
        f"font-src {prefix} https: data: blob:; "
        f"media-src {prefix} https: data: blob:; "
        f"worker-src {prefix} blob:; "
        f"connect-src {connect_src}; "
        f"form-action {form_action}; "
        "frame-src 'none'; "
        "object-src 'none'; "
        f"base-uri {prefix}; "
        f"frame-ancestors {ancestors}"
    )


def _security_headers(port: int, asset: StaticAsset) -> dict[str, str]:
    mount = asset.mount
    return {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": build_static_preview_csp(
            port,
            mount.mount_token,
            kind=mount.kind,
            parent_origin=mount.parent_origin,
        ),
    }


def _raw_path_forbidden(raw_path: str) -> bool:
    """在框架路径规范化前拦截编码斜杠、反斜杠、空字节、空段与点路径段。"""
    if "//" in raw_path or "\\" in raw_path or "\x00" in raw_path:
        return True
    for segment in raw_path.split("/"):
        lowered = segment.lower()
        if "%2f" in lowered or "%5c" in lowered or "%00" in lowered:
            return True
        decoded = unquote(segment)
        if decoded in (".", "..") or "\x00" in decoded or "\\" in decoded:
            return True
    return False


class _RawRequestGuardMiddleware:
    """在 Starlette 路由前强制只放行 GET/HEAD，并校验原始请求路径未含越界绕过写法。"""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        method = scope.get("method", "GET")
        if method not in _READ_METHODS:
            response = PlainTextResponse("Method Not Allowed", status_code=405, headers={"Allow": "GET, HEAD"})
            return await response(scope, receive, send)
        raw = (scope.get("raw_path") or scope["path"].encode("latin-1")).decode("latin-1")
        if _raw_path_forbidden(raw):
            response = PlainTextResponse("Forbidden", status_code=403)
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)


def create_static_preview_app(
    service: StaticPreviewService,
    port_provider: Callable[[], Optional[int]],
) -> Starlette:
    """构造只读静态预览 ASGI 应用。"""

    async def redirect_mount_root(request: Request):
        mount_token = request.path_params["mount_token"]
        mount = service.get_mount(mount_token)
        if mount is None:
            return PlainTextResponse("Not Found", status_code=404, headers={"Cache-Control": "no-store"})
        encoded_entry = "/".join(quote(part, safe="") for part in mount.entry_path.split("/") if part)
        return RedirectResponse(
            url=f"/s/{mount_token}/{encoded_entry}",
            status_code=307,
            headers={"Cache-Control": "no-store"},
        )

    async def serve_asset(request: Request):
        mount_token = request.path_params["mount_token"]
        subpath = request.path_params.get("subpath", "")
        try:
            asset = await service.open_asset(mount_token, subpath)
        except AppException as error:
            status = HTTP_STATUS.get(error.info.code, 400)
            return PlainTextResponse(error.info.message, status_code=status, headers={"Cache-Control": "no-store"})

        port = port_provider() or 0
        headers = _security_headers(port, asset)
        settings = service._settings_provider()

        try:
            if asset.is_html and asset.size <= settings.static_preview_html_inject_bytes:
                data, cancelled = await run_file_io(asset.handle.read)
                if cancelled:
                    raise asyncio.CancelledError()
                asset.handle.close()
                body = inject_download_bridge(
                    data,
                    asset.mount.mount_token,
                    asset.mount.parent_origin,
                )
                headers["Content-Length"] = str(len(body))
                return StarletteResponse(
                    b"" if request.method == "HEAD" else body,
                    status_code=200,
                    media_type=asset.media_type,
                    headers=headers,
                )

            size = asset.size
            start, end, status = 0, size - 1, 200
            range_header = request.headers.get("range")
            if range_header:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
                if not match or not any(match.groups()) or size == 0:
                    asset.handle.close()
                    return PlainTextResponse("Range Not Satisfiable", status_code=416, headers=headers)
                left, right = match.groups()
                if left:
                    start = int(left)
                    end = min(int(right), end) if right else end
                else:
                    start = max(0, size - int(right))
                if start > end or start >= size:
                    asset.handle.close()
                    return PlainTextResponse("Range Not Satisfiable", status_code=416, headers=headers)
                status = 206
                headers["Content-Range"] = f"bytes {start}-{end}/{size}"

            content_length = max(0, end - start + 1)
            headers["Accept-Ranges"] = "bytes"
            headers["Content-Length"] = str(content_length)

            if request.method == "HEAD":
                asset.handle.close()
                return StarletteResponse(b"", status_code=status, media_type=asset.media_type, headers=headers)

            if start > 0:
                asset.handle.seek(start)

            handle = asset.handle

            async def body_stream():
                remaining = content_length
                try:
                    while remaining > 0:
                        chunk, cancelled = await run_file_io(handle.read, min(remaining, _STREAM_CHUNK))
                        if cancelled:
                            raise asyncio.CancelledError()
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk
                finally:
                    handle.close()

            return StreamingResponse(
                body_stream(),
                status_code=status,
                media_type=asset.media_type,
                headers=headers,
            )
        except BaseException:
            if not asset.handle.closed:
                asset.handle.close()
            raise

    app = Starlette(
        routes=[
            Route("/s/{mount_token}", redirect_mount_root, methods=["GET", "HEAD"]),
            Route("/s/{mount_token}/{subpath:path}", serve_asset, methods=["GET", "HEAD"]),
        ]
    )
    app.add_middleware(_RawRequestGuardMiddleware)
    return app


class _QuietUvicornServer(uvicorn.Server):
    """在主事件循环内作为从属服务器运行，不接管进程信号处理器。"""

    def install_signal_handlers(self) -> None:
        return


class StaticPreviewServer:
    """绑定 127.0.0.1 随机空闲端口的独立只读静态预览服务器。"""

    def __init__(self, service: StaticPreviewService) -> None:
        self._service = service
        self._port: Optional[int] = None
        self._socket: Optional[socket.socket] = None
        self._server: Optional[_QuietUvicornServer] = None
        self._task: Optional[asyncio.Task] = None

    @property
    def port(self) -> Optional[int]:
        return self._port

    async def start(self) -> int:
        if self._port is not None and self._task is not None and not self._task.done():
            return self._port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", 0))
            port = int(sock.getsockname()[1])
            self._port = port
            self._socket = sock
            app = create_static_preview_app(self._service, lambda: self._port)
            config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=port,
                log_config=None,
                access_log=False,
                timeout_graceful_shutdown=2,
            )
            server = _QuietUvicornServer(config)
            self._server = server
            task = asyncio.create_task(server.serve(sockets=[sock]))
            self._task = task
            while not server.started and not task.done():
                await asyncio.sleep(0.02)
            if not server.started:
                await task
                raise RuntimeError("静态预览服务器未能启动")
            logger.info(f"静态预览服务器就绪 http://127.0.0.1:{port}")
            return port
        except BaseException:
            self._port = None
            if self._task is not None and not self._task.done():
                self._task.cancel()
            self._task = None
            self._server = None
            self._socket = None
            try:
                sock.close()
            except OSError:
                pass
            raise

    async def stop(self) -> None:
        server, task, sock = self._server, self._task, self._socket
        self._server = None
        self._task = None
        self._socket = None
        self._port = None
        self._service.clear()
        if server is not None:
            server.should_exit = True
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=_SHUTDOWN_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            except BaseException:
                pass
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        logger.info("静态预览服务器已关闭")
