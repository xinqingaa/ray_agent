"""只读静态预览挂载管理、安全资源读取与静态目录 ZIP 导出。"""
import mimetypes
import os
import re
import secrets
import stat
import tempfile
import time
import zipfile
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Optional
from urllib.parse import quote

from app.application.errors.exceptions import AppException, BadRequestError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.domain.external.workspace_files import (
    FileKind, FileLimits, RootBinding, WorkspaceFileError, WorkspaceFiles,
)
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath, relative_parts, validate_relative_path
from app.domain.services.file_io import run_file_io
from app.domain.services.file_rules import denied_reason, is_internal_temp, safe_filename
from app.infrastructure.external.workspace_files.posix import _Walk, _open_file, open_root, walk_dirs
from app.interfaces.schemas.static_preview import StaticPreviewKind, StaticPreviewMount, StaticPreviewMountRequest
from core.config import Settings, get_settings

HTML_EXTENSIONS = frozenset({".html", ".htm"})
_INDEX_CANDIDATES = ("index.html", "index.htm")
_ZIP_CHUNK_BYTES = 256 * 1024

_PARENT_ORIGIN_RE = re.compile(
    r"^(?:tauri://localhost|https?://tauri\.localhost|https?://(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?)$"
)

# 显式 MIME 映射，确保 X-Content-Type-Options: nosniff 下 ES Module / CSS / WASM / SVG 正常加载
_STATIC_MIME_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".ics": "text/calendar; charset=utf-8",
    ".pdf": "application/pdf",
}


def validate_parent_origin(origin: str | None) -> str | None:
    """只放行桌面 WebView 与本机开发源，用于 frame-ancestors 与 postMessage 目标源收窄。"""
    if not origin:
        return None
    candidate = origin.strip()
    if not _PARENT_ORIGIN_RE.fullmatch(candidate):
        return None
    if ":" in candidate.rsplit("/", 1)[-1]:
        host_port = candidate.rsplit("/", 1)[-1]
        _, _, port_str = host_port.partition(":")
        if port_str:
            port = int(port_str)
            if port < 1 or port > 65535:
                return None
    return candidate


def guess_static_mime(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in _STATIC_MIME_TYPES:
        return _STATIC_MIME_TYPES[ext]
    guessed = mimetypes.guess_type(filename)[0]
    return guessed or "application/octet-stream"


def _check_safe_parts(parts: tuple[str, ...]) -> None:
    """拒绝保留目录、版本控制内部、凭据/数据库路径及内部临时文件。"""
    for i in range(len(parts)):
        if is_internal_temp(parts[i]):
            raise AppException(ErrorCode.FORBIDDEN, "临时文件不可用于预览")
        if reason := denied_reason(parts[: i + 1]):
            raise AppException(ErrorCode.FORBIDDEN, reason)


def _encode_url_path(relative: str) -> str:
    return "/".join(quote(part, safe="") for part in relative.split("/") if part)


def _safe_zip_name(title: str) -> str:
    cleaned = "".join(ch for ch in (title or "") if ord(ch) >= 32 and ord(ch) != 127 and ch not in '/\\').strip()
    if not cleaned or cleaned in (".", ".."):
        cleaned = "site"
    return f"{cleaned[:120]}.zip"


@dataclass(frozen=True)
class StaticMountRecord:
    mount_token: str
    kind: StaticPreviewKind
    title: str
    entry_path: str
    file_id: Optional[str]
    root_id: Optional[str]
    relative_path: str
    parent_origin: Optional[str]
    expires_mono: float
    expires_at_ms: int


@dataclass
class StaticAsset:
    handle: BinaryIO
    filename: str
    size: int
    media_type: str
    is_html: bool
    mount: StaticMountRecord


def _build_directory_zip(
    binding: RootBinding,
    dir_parts: tuple[str, ...],
    limits: FileLimits,
    max_files: int,
    max_bytes: int,
    extra_files: Optional[dict[str, bytes]] = None,
) -> BinaryIO:
    """在线程内从已核对身份的根目录流式打包普通文件到临时 ZIP；不跟随符号链接并过滤敏感/排除项。"""
    output = tempfile.TemporaryFile()
    root_fd: int | None = None
    try:
        root_fd = open_root(binding)
        if dir_parts:
            target_fd = walk_dirs(root_fd, dir_parts)
            os.close(target_fd)
        walk = _Walk(binding, dir_parts, limits)
        file_count = 0
        total_bytes = 0
        written_names: set[str] = set()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for yield_dir_parts, name, info, is_directory in walk:
                if is_directory or not stat.S_ISREG(info.st_mode):
                    continue
                full_parts = (*yield_dir_parts, name)
                if any(is_internal_temp(p) for p in full_parts) or denied_reason(full_parts):
                    continue
                rel_parts = full_parts[len(dir_parts):]
                if not rel_parts:
                    continue
                file_count += 1
                if file_count > max_files:
                    raise BadRequestError(f"目录文件数超过导出上限（最多 {max_files} 个文件）")
                if total_bytes + info.st_size > max_bytes:
                    raise BadRequestError("目录体积过大，超过导出上限")
                parent_fd = walk_dirs(root_fd, yield_dir_parts)
                try:
                    fd, opened = _open_file(parent_fd, name, None)
                finally:
                    os.close(parent_fd)
                try:
                    if total_bytes + opened.st_size > max_bytes:
                        raise BadRequestError("目录体积过大，超过导出上限")
                    archive_name = "/".join(rel_parts)
                    with os.fdopen(fd, "rb") as source_handle:
                        fd = -1  # fdopen 接管描述符所有权
                        with archive.open(archive_name, "w", force_zip64=True) as member:
                            while chunk := source_handle.read(_ZIP_CHUNK_BYTES):
                                total_bytes += len(chunk)
                                if total_bytes > max_bytes:
                                    raise BadRequestError("目录体积过大，超过导出上限")
                                member.write(chunk)
                    written_names.add(archive_name)
                finally:
                    if fd >= 0:
                        os.close(fd)
            if extra_files:
                for rel_name, raw_bytes in extra_files.items():
                    if rel_name in written_names:
                        continue
                    file_count += 1
                    total_bytes += len(raw_bytes)
                    if file_count > max_files:
                        raise BadRequestError(f"目录文件数超过导出上限（最多 {max_files} 个文件）")
                    if total_bytes > max_bytes:
                        raise BadRequestError("目录体积过大，超过导出上限")
                    archive.writestr(rel_name, raw_bytes)
        if walk.truncated:
            raise BadRequestError("目录结构过深或条目过多，无法完整打包")
        output.seek(0)
        return output
    except BaseException:
        output.close()
        raise
    finally:
        if root_fd is not None:
            os.close(root_fd)


class StaticPreviewService:
    """管理只读静态预览挂载并按限根规则读取资源与导出 ZIP。"""

    def __init__(
        self,
        file_service,
        root_files: WorkspaceFiles,
        root_bindings: Callable[[str], object],
        port_provider: Callable[[], Optional[int]],
        settings_provider: Callable[[], Settings] = get_settings,
    ) -> None:
        self._file_service = file_service
        self._root_files = root_files
        self._root_bindings = root_bindings
        self._port_provider = port_provider
        self._settings_provider = settings_provider
        self._mounts: OrderedDict[str, StaticMountRecord] = OrderedDict()

    def _files(self):
        return self._file_service() if callable(self._file_service) else self._file_service

    def _roots(self) -> WorkspaceFiles:
        return self._root_files() if callable(self._root_files) else self._root_files

    def _evict_expired(self, now_mono: float | None = None) -> None:
        current = time.monotonic() if now_mono is None else now_mono
        for token, mount in list(self._mounts.items()):
            if mount.expires_mono <= current:
                del self._mounts[token]

    def clear(self) -> None:
        self._mounts.clear()

    def get_mount(self, mount_token: str) -> Optional[StaticMountRecord]:
        self._evict_expired()
        return self._mounts.get(mount_token)

    def delete_mount(self, mount_token: str) -> None:
        self._mounts.pop(mount_token, None)

    async def _stat(self, path: RootedPath):
        try:
            return await self._roots().stat(path)
        except WorkspaceFileError as error:
            raise app_error(error)

    async def _resolve_root_dir_entry(self, root_id: str, dir_parts: tuple[str, ...], entry_path: str) -> str:
        if entry_path:
            entry_parts = relative_parts(entry_path)
            full_parts = (*dir_parts, *entry_parts)
            _check_safe_parts(entry_parts)
            _check_safe_parts(full_parts)
            if Path(entry_parts[-1]).suffix.lower() not in HTML_EXTENSIONS:
                raise BadRequestError("静态预览入口必须是 HTML 文件")
            entry = await self._stat(RootedPath(root_id=root_id, relative_path="/".join(full_parts)))
            if entry.kind is not FileKind.FILE:
                raise BadRequestError("静态预览入口不是普通文件")
            return "/".join(entry_parts)

        for candidate in _INDEX_CANDIDATES:
            full_parts = (*dir_parts, candidate)
            _check_safe_parts(full_parts)
            try:
                entry = await self._stat(RootedPath(root_id=root_id, relative_path="/".join(full_parts)))
            except AppException as error:
                if error.info.code in (ErrorCode.NOT_FOUND, ErrorCode.INVALID_REQUEST):
                    continue
                raise
            if entry.kind is FileKind.FILE:
                return candidate
        raise BadRequestError("该目录中没有找到入口文件 index.html")

    async def create_mount(
        self,
        request: StaticPreviewMountRequest,
        *,
        parent_origin: str | None = None,
    ) -> StaticPreviewMount:
        port = self._port_provider()
        if port is None:
            raise AppException(ErrorCode.UNAVAILABLE, "静态预览服务尚未就绪")

        validated_origin = validate_parent_origin(parent_origin)
        export_zip_path: Optional[str] = None
        if request.kind == "attachment":
            handle, file = await self._files().download_file(request.file_id)
            try:
                if Path(file.filename).suffix.lower() not in HTML_EXTENSIONS:
                    raise BadRequestError("静态预览仅支持 HTML 文件")
            finally:
                handle.close()
            try:
                entry_path = safe_filename(file.filename)
            except ValueError:
                entry_path = "index.html"
            title = file.filename
            root_id = None
            relative_path = ""
            file_id = request.file_id
        elif request.kind == "root_file":
            parts = relative_parts(request.relative_path)
            _check_safe_parts(parts)
            entry = await self._stat(RootedPath(root_id=request.root_id, relative_path="/".join(parts)))
            if entry.kind is not FileKind.FILE:
                raise BadRequestError("目标不是普通文件")
            if Path(entry.name).suffix.lower() not in HTML_EXTENSIONS:
                raise BadRequestError("静态预览仅支持 HTML 文件")
            entry_path = parts[-1]
            title = entry.name
            root_id = request.root_id
            relative_path = "/".join(parts)
            file_id = None
        else:
            dir_parts = relative_parts(request.relative_path)
            _check_safe_parts(dir_parts)
            dir_rel = "/".join(dir_parts)
            dir_entry = await self._stat(RootedPath(root_id=request.root_id, relative_path=dir_rel))
            if dir_entry.kind is not FileKind.DIRECTORY:
                raise BadRequestError("目标不是文件夹")
            entry_path = await self._resolve_root_dir_entry(request.root_id, dir_parts, request.entry_path)
            if dir_parts:
                title = dir_parts[-1]
            else:
                try:
                    binding = await self._root_bindings(request.root_id)
                    title = Path(binding.path).name or "静态站点"
                except WorkspaceFileError:
                    title = "静态站点"
            root_id = request.root_id
            relative_path = dir_rel
            file_id = None

        settings = self._settings_provider()
        now_mono = time.monotonic()
        self._evict_expired(now_mono)
        while len(self._mounts) >= settings.static_preview_mount_capacity:
            self._mounts.popitem(last=False)

        token = secrets.token_urlsafe(24)
        expires_mono = now_mono + settings.static_preview_mount_seconds
        expires_at_ms = int((time.time() + settings.static_preview_mount_seconds) * 1000)
        if request.kind == "root_dir":
            export_zip_path = f"/previews/static/mounts/{token}/export.zip"

        record = StaticMountRecord(
            mount_token=token,
            kind=request.kind,
            title=title,
            entry_path=entry_path,
            file_id=file_id,
            root_id=root_id,
            relative_path=relative_path,
            parent_origin=validated_origin,
            expires_mono=expires_mono,
            expires_at_ms=expires_at_ms,
        )
        self._mounts[token] = record
        origin = f"http://127.0.0.1:{port}"
        preview_url = f"{origin}/s/{token}/{_encode_url_path(entry_path)}"
        return StaticPreviewMount(
            mount_token=token,
            kind=record.kind,
            title=record.title,
            entry_path=record.entry_path,
            preview_url=preview_url,
            origin=origin,
            expires_at=record.expires_at_ms,
            export_zip_path=export_zip_path,
        )

    async def open_asset(self, mount_token: str, subpath: str) -> StaticAsset:
        mount = self.get_mount(mount_token)
        if mount is None:
            raise NotFoundError("静态预览已过期，请刷新后重试")

        trailing_slash = subpath.endswith("/")
        normalized = subpath[:-1] if trailing_slash else subpath
        if normalized:
            try:
                validate_relative_path(normalized)
            except ValueError as error:
                raise AppException(ErrorCode.FORBIDDEN, f"路径无效：{error}")
        elif trailing_slash:
            raise AppException(ErrorCode.FORBIDDEN, "路径无效")

        if mount.kind == "attachment":
            if normalized not in ("", mount.entry_path) or trailing_slash:
                raise NotFoundError("静态资源不存在")
            handle, file = await self._files().download_file(mount.file_id)
            ext = Path(file.filename).suffix.lower()
            return StaticAsset(
                handle=handle,
                filename=file.filename,
                size=file.size,
                media_type=guess_static_mime(file.filename),
                is_html=ext in HTML_EXTENSIONS,
                mount=mount,
            )

        if mount.kind == "root_file":
            if normalized not in ("", mount.entry_path) or trailing_slash:
                raise NotFoundError("静态资源不存在")
            parts = relative_parts(mount.relative_path)
            _check_safe_parts(parts)
            target = RootedPath(root_id=mount.root_id, relative_path="/".join(parts))
            return await self._open_root_file_asset(target, mount)

        # root_dir
        dir_parts = relative_parts(mount.relative_path)
        if not normalized:
            sub_parts = relative_parts(mount.entry_path)
        else:
            sub_parts = relative_parts(normalized)
        full_parts = (*dir_parts, *sub_parts)
        _check_safe_parts(sub_parts)
        _check_safe_parts(full_parts)

        target = RootedPath(root_id=mount.root_id, relative_path="/".join(full_parts))
        entry = await self._stat(target)
        if entry.kind is FileKind.DIRECTORY:
            for candidate in _INDEX_CANDIDATES:
                index_parts = (*full_parts, candidate)
                _check_safe_parts(index_parts)
                index_target = RootedPath(root_id=mount.root_id, relative_path="/".join(index_parts))
                try:
                    index_entry = await self._stat(index_target)
                except AppException as error:
                    if error.info.code is ErrorCode.NOT_FOUND:
                        continue
                    raise
                if index_entry.kind is FileKind.FILE:
                    return await self._open_root_file_asset(index_target, mount, entry=index_entry)
            raise NotFoundError("目录中没有默认入口文件")
        if trailing_slash:
            raise NotFoundError("目标不是目录")
        if entry.kind is not FileKind.FILE:
            raise AppException(ErrorCode.FORBIDDEN, "符号链接或特殊文件不可预览")
        return await self._open_root_file_asset(target, mount, entry=entry)

    async def _open_root_file_asset(self, target: RootedPath, mount: StaticMountRecord, entry=None) -> StaticAsset:
        roots = self._roots()
        try:
            if entry is None:
                entry = await roots.stat(target)
                if entry.kind is not FileKind.FILE:
                    raise AppException(ErrorCode.FORBIDDEN, "目标不是普通文件")
            handle = await roots.open_reader(target, entry.version)
        except WorkspaceFileError as error:
            raise app_error(error)
        ext = Path(entry.name).suffix.lower()
        return StaticAsset(
            handle=handle,
            filename=entry.name,
            size=entry.version.size,
            media_type=guess_static_mime(entry.name),
            is_html=ext in HTML_EXTENSIONS,
            mount=mount,
        )

    def check_export_zip(self, mount_token: str) -> tuple[StaticMountRecord, str]:
        mount = self.get_mount(mount_token)
        if mount is None:
            raise NotFoundError("静态预览已过期，请刷新后重试")
        if mount.kind != "root_dir" or not mount.root_id:
            raise BadRequestError("仅静态目录预览支持打包导出 ZIP")
        return mount, _safe_zip_name(mount.title)

    async def export_zip(self, mount_token: str) -> tuple[BinaryIO, str]:
        mount, filename = self.check_export_zip(mount_token)
        dir_parts = relative_parts(mount.relative_path)
        _check_safe_parts(dir_parts)
        try:
            binding = await self._root_bindings(mount.root_id)
        except WorkspaceFileError as error:
            raise app_error(error)
        settings = self._settings_provider()
        limits = getattr(self._roots(), "limits", None) or FileLimits()
        archive, cancelled = await run_file_io(
            _build_directory_zip,
            binding,
            dir_parts,
            limits,
            settings.static_preview_zip_max_files,
            settings.static_preview_zip_max_bytes,
        )
        if cancelled:
            archive.close()
            import asyncio
            raise asyncio.CancelledError()
        return archive, filename
