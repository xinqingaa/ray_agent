"""应用内受管轻量服务与项目预览运行时：持久声明、Supervisor 托管启停、健康检查、日志与安全回收。"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, BinaryIO, Callable, Optional

import httpx

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.application.errors.workspace_files import app_error
from app.application.services.static_preview_service import (
    HTML_EXTENSIONS,
    _INDEX_CANDIDATES,
    _build_directory_zip,
    _check_safe_parts,
    _safe_zip_name,
)
from app.domain.external.process_executor import ProcessOwner, ProcessSpec, ProcessState
from app.domain.external.workspace_files import FileKind, FileLimits, RootBinding, WorkspaceFileError, WorkspaceFiles
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorCode
from app.domain.models.execution_settings import workspace_execution_enabled
from app.domain.models.identity import RootedPath, relative_parts, validate_relative_path
from app.domain.models.workspace import WorkspaceStatus
from app.domain.models.workspace_preview import (
    PREVIEW_COMMAND_MAX_CHARS,
    PREVIEW_HEALTH_PATH_MAX_CHARS,
    PREVIEW_NAME_MAX_CHARS,
    PreviewKind,
    PreviewRuntimeState,
    WorkspacePreview,
)
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.file_io import run_file_io
from app.domain.services.workspace_shell_guard import (
    has_project_manifest,
    inspect_external_write_shell,
    inspect_workspace_shell,
)
from app.infrastructure.external.execution.env import detect_posix_shell
from app.interfaces.schemas.managed_preview import ManagedPreviewLogsResponse, ManagedPreviewView
from core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
_NON_LOOPBACK_PATTERNS = (
    re.compile(r"(?<![\w.])0\.0\.0\.0(?![\w.])"),
    re.compile(r"\[\s*::\s*\]"),
    re.compile(r"(?i)(?:--host(?:=|\s+)|--bind(?:=|\s+)|(?:^|[\s;])HOST=|\s-h\s+|\s-b\s+)::(?=$|[\s:'\";&|])"),
)
_README_START_NAME = "RAYAGENT_START.txt"


def _epoch_ms(value) -> int:
    return int(value.timestamp() * 1000)


def validate_preview_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise BadRequestError("预览名称不能为空")
    if len(cleaned) > PREVIEW_NAME_MAX_CHARS:
        raise BadRequestError(f"预览名称最多 {PREVIEW_NAME_MAX_CHARS} 个字符")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in cleaned):
        raise BadRequestError("预览名称不能包含控制字符")
    return cleaned


def validate_health_path(path: Optional[str]) -> str:
    candidate = (path or "/").strip() or "/"
    if len(candidate) > PREVIEW_HEALTH_PATH_MAX_CHARS:
        raise BadRequestError(f"健康检查路径过长（最多 {PREVIEW_HEALTH_PATH_MAX_CHARS} 个字符）")
    if not candidate.startswith("/"):
        raise BadRequestError("健康检查路径必须以 / 开头")
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in candidate):
        raise BadRequestError("健康检查路径不能包含空白或控制字符")
    if ".." in candidate.split("/"):
        raise BadRequestError("健康检查路径不能包含 ..")
    return candidate


def validate_start_command(
    command: Optional[str],
    *,
    cwd_abs: str,
    workspace_path: Optional[str],
    scratch_path: Optional[str],
    allowed_roots: list[str],
) -> str:
    raw = (command or "").strip()
    if not raw:
        raise BadRequestError("轻量服务预览必须提供启动命令")
    if len(raw) > PREVIEW_COMMAND_MAX_CHARS:
        raise BadRequestError(f"启动命令过长（最多 {PREVIEW_COMMAND_MAX_CHARS} 个字符）")
    if any(ch in raw for ch in ("\n", "\r", "\x00")):
        raise BadRequestError("启动命令只允许单行轻量启动命令")
    for pattern in _NON_LOOPBACK_PATTERNS:
        if pattern.search(raw):
            raise BadRequestError(
                "轻量预览服务仅允许绑定本机回环地址 127.0.0.1（禁止监听 0.0.0.0 或 ::），"
                "请优先读取环境变量 HOST 与 PORT"
            )
    if workspace_path:
        effective_scratch = scratch_path or workspace_path
        risk = inspect_workspace_shell(raw, cwd_abs, workspace_path, effective_scratch)
        if risk is not None and not has_project_manifest(workspace_path):
            raise BadRequestError(
                f"拒绝在非代码工作区内将{risk.label}（{risk.summary}）作为预览启动命令；"
                "请复用已有工具运行时或将临时环境留在会话工作目录"
            )
    default_cwd = scratch_path or cwd_abs
    ext_risk = inspect_external_write_shell(raw, cwd_abs, allowed_roots, default_cwd)
    if ext_risk is not None:
        raise BadRequestError(f"预览启动命令不允许向允许目录外写入（{ext_risk.summary}）")
    return raw


def allocate_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _clean_logs(text: str, limit_chars: Optional[int] = None) -> str:
    cleaned = _ANSI_RE.sub("", text or "")
    if limit_chars is not None and len(cleaned) > limit_chars:
        return cleaned[-limit_chars:]
    return cleaned


def _start_guide_bytes(preview: WorkspacePreview) -> bytes:
    lines = [
        f"项目名称: {preview.name}",
        f"工作子目录: {preview.relative_path or '(项目根目录)'}",
        f"启动命令: {preview.start_command or ''}",
        f"默认监听: HOST=127.0.0.1 PORT=8000",
        "",
        "说明: 可在本目录执行上述启动命令，随后在浏览器访问 http://127.0.0.1:${PORT:-8000}。",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


@dataclass
class RunningPreview:
    preview_id: str
    workspace_id: Optional[str]
    session_id: str
    process_id: Optional[str]
    port: Optional[int]
    state: PreviewRuntimeState
    started_at_ms: int
    exit_code: Optional[int] = None
    error: Optional[str] = None


class PreviewRuntimeService:
    """管理应用内持久化项目预览的声明、受管服务启停、健康检查、日志与生命周期回收。"""

    def __init__(
        self,
        uow_factory: Callable[[], IUnitOfWork],
        read_uow_factory: Callable[[], IUnitOfWork],
        root_files,
        root_bindings: Callable[[str], Awaitable[RootBinding]],
        executor_provider: Callable[[], Awaitable[object]],
        command_available_probe: Callable[[], Awaitable[tuple[bool, str]]],
        app_config_loader: Callable[[], Awaitable[object]],
        settings_provider: Callable[[], Settings] = get_settings,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory
        self._root_files = root_files
        self._root_bindings = root_bindings
        self._executor_provider = executor_provider
        self._command_available_probe = command_available_probe
        self._app_config_loader = app_config_loader
        self._settings_provider = settings_provider
        self._runtime: dict[str, RunningPreview] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._state_lock = asyncio.Lock()

    def _roots(self) -> WorkspaceFiles:
        return self._root_files() if callable(self._root_files) else self._root_files

    def _lock_for(self, preview_id: str) -> asyncio.Lock:
        lock = self._locks.get(preview_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[preview_id] = lock
        return lock

    async def _stat(self, target: RootedPath):
        try:
            return await self._roots().stat(target)
        except WorkspaceFileError as error:
            raise app_error(error)

    async def _resolve_binding(self, root_id: str) -> RootBinding:
        try:
            return await self._root_bindings(root_id)
        except WorkspaceFileError as error:
            raise app_error(error)

    async def _resolve_static_entry(
        self, root_id: str, relative_path: str, entry_path: str
    ) -> tuple[str, str]:
        """校验 static 目标（单 HTML 文件或含入口 HTML 的目录），返回规范化的 (relative_path, entry_path)。"""
        rel_clean = validate_relative_path(relative_path or "")
        parts = relative_parts(rel_clean)
        _check_safe_parts(parts)
        target = RootedPath(root_id=root_id, relative_path=rel_clean)
        entry = await self._stat(target)
        if entry.kind is FileKind.FILE:
            if Path(entry.name).suffix.lower() not in HTML_EXTENSIONS:
                raise BadRequestError("静态单文件预览仅支持 .html / .htm 文件")
            if entry_path:
                cleaned_entry = validate_relative_path(entry_path)
                if cleaned_entry != entry.name:
                    raise BadRequestError("单文件 HTML 预览无需指定不同的 entry_path")
            return rel_clean, ""
        if entry.kind is not FileKind.DIRECTORY:
            raise BadRequestError("预览目标不是普通文件或目录")

        if entry_path:
            entry_clean = validate_relative_path(entry_path)
            entry_parts = relative_parts(entry_clean)
            full_parts = (*parts, *entry_parts)
            _check_safe_parts(entry_parts)
            _check_safe_parts(full_parts)
            if Path(entry_parts[-1]).suffix.lower() not in HTML_EXTENSIONS:
                raise BadRequestError("静态预览入口必须是 HTML 文件")
            found = await self._stat(RootedPath(root_id=root_id, relative_path="/".join(full_parts)))
            if found.kind is not FileKind.FILE:
                raise BadRequestError("静态预览入口不是普通文件")
            return rel_clean, entry_clean

        for candidate in _INDEX_CANDIDATES:
            full_parts = (*parts, candidate)
            _check_safe_parts(full_parts)
            try:
                found = await self._stat(RootedPath(root_id=root_id, relative_path="/".join(full_parts)))
            except AppException as error:
                if error.info.code in (ErrorCode.NOT_FOUND, ErrorCode.INVALID_REQUEST):
                    continue
                raise
            if found.kind is FileKind.FILE:
                return rel_clean, candidate
        raise BadRequestError("该目录中没有找到入口文件 index.html")

    async def _context_paths(
        self, workspace_id: Optional[str], session_id: str, target_root_id: str
    ) -> tuple[Optional[str], Optional[str], list[str], RootBinding]:
        binding = await self._resolve_binding(target_root_id)
        async with self._read_uow_factory() as uow:
            folder_record = await uow.root.workspace_folder(workspace_id) if workspace_id else None
            workdir_pair = await uow.root.session_workdir(session_id)

        workspace_path: Optional[str] = None
        if folder_record is not None:
            workspace_path = os.path.realpath(folder_record.location)

        scratch_path: Optional[str] = None
        if workdir_pair is not None:
            try:
                scratch_binding = await self._resolve_binding(workdir_pair[0].root_id)
                scratch_path = os.path.realpath(scratch_binding.path)
            except AppException:
                scratch_path = None

        allowed_roots = [os.path.realpath(binding.path)]
        for candidate in (workspace_path, scratch_path):
            if candidate and candidate not in allowed_roots:
                allowed_roots.append(candidate)
        return workspace_path, scratch_path, allowed_roots, binding

    async def _check_execution_allowed(self, workspace_id: Optional[str]) -> None:
        if workspace_id:
            async with self._read_uow_factory() as uow:
                workspace = await uow.workspace.get(workspace_id)
            if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                raise NotFoundError("工作区不存在")
            if workspace.status is WorkspaceStatus.ARCHIVED:
                raise ConflictError("工作区已归档，不能启动预览服务")
            if not workspace_execution_enabled(workspace.settings):
                raise ConflictError("当前工作区未开启本机执行，请先在工作区设置中启用后再启动轻量服务预览")
        else:
            config = await self._app_config_loader()
            if not bool(getattr(getattr(config, "agent_config", None), "standalone_execution_enabled", False)):
                raise ConflictError("独立对话未开启本机执行，请先在应用设置中开启后再启动轻量服务预览")
        ok, detail = await self._command_available_probe()
        if not ok:
            raise AppException(ErrorCode.UNAVAILABLE, detail)

    async def _reconcile_running(self, record: Optional[RunningPreview]) -> Optional[RunningPreview]:
        if record is None or record.state != "running" or not record.process_id:
            return record
        try:
            executor = await self._executor_provider()
            proc = await executor.status(record.process_id)
        except Exception as error:
            record.state = "failed"
            record.port = None
            record.error = f"预览服务进程状态不可用：{error}"
            return record
        if proc.state is not ProcessState.RUNNING:
            record.state = "failed"
            record.port = None
            record.exit_code = proc.exit_code
            record.error = f"预览服务已退出（退出码 {proc.exit_code}）"
        return record

    async def _reconcile_all_active(self) -> None:
        candidates = [item for item in self._runtime.values() if item.state == "running"]
        for item in candidates:
            await self._reconcile_running(item)

    def _to_view(self, preview: WorkspacePreview, runtime: Optional[RunningPreview]) -> ManagedPreviewView:
        if preview.kind == "static":
            state: PreviewRuntimeState = "ready"
            port = None
            preview_url = None
            error = None
            exit_code = None
            started_at = None
        else:
            state = runtime.state if runtime is not None else "stopped"
            port = runtime.port if runtime is not None and runtime.state == "running" else None
            preview_url = f"http://127.0.0.1:{port}/" if port is not None else None
            error = runtime.error if runtime is not None else None
            exit_code = runtime.exit_code if runtime is not None else None
            started_at = runtime.started_at_ms if runtime is not None else None

        return ManagedPreviewView(
            id=preview.id,
            workspace_id=preview.workspace_id,
            session_id=preview.session_id,
            run_id=preview.run_id,
            name=preview.name,
            kind=preview.kind,
            root_id=preview.root_id,
            relative_path=preview.relative_path,
            entry_path=preview.entry_path,
            start_command=preview.start_command,
            health_path=preview.health_path,
            state=state,
            port=port,
            preview_url=preview_url,
            error=error,
            exit_code=exit_code,
            started_at=started_at,
            created_at=_epoch_ms(preview.created_at),
            updated_at=_epoch_ms(preview.updated_at),
        )

    async def list_previews(
        self,
        *,
        workspace_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> list[ManagedPreviewView]:
        async with self._read_uow_factory() as uow:
            if session_id:
                rows = await uow.preview.list_by_session(session_id)
            elif workspace_id:
                rows = await uow.preview.list_by_workspace(workspace_id)
            else:
                rows = await uow.preview.list_all()
        if workspace_id and session_id:
            rows = [row for row in rows if row.workspace_id == workspace_id]
        views: list[ManagedPreviewView] = []
        for row in rows:
            runtime = await self._reconcile_running(self._runtime.get(row.id)) if row.kind == "service" else None
            views.append(self._to_view(row, runtime))
        return views

    async def get_preview(self, preview_id: str) -> ManagedPreviewView:
        async with self._read_uow_factory() as uow:
            row = await uow.preview.get(preview_id)
        if row is None:
            raise NotFoundError("项目预览不存在")
        runtime = await self._reconcile_running(self._runtime.get(row.id)) if row.kind == "service" else None
        return self._to_view(row, runtime)

    async def register(
        self,
        *,
        workspace_id: Optional[str],
        session_id: str,
        run_id: Optional[str],
        name: str,
        kind: PreviewKind,
        root_id: str,
        relative_path: str = "",
        entry_path: str = "",
        start_command: Optional[str] = None,
        health_path: Optional[str] = None,
    ) -> tuple[ManagedPreviewView, str, Optional[str]]:
        """登记可重开项目预览（`service` 登记后自动启动并做回环健康检查，返回视图、尾部日志与启动错误）。"""
        clean_name = validate_preview_name(name)
        rel_clean = validate_relative_path(relative_path or "")
        parts = relative_parts(rel_clean)
        _check_safe_parts(parts)

        if kind == "static":
            if start_command and start_command.strip():
                raise BadRequestError("static 预览不需要 start_command；若需启动本地脚本请设 kind=\"service\"")
            rel_clean, clean_entry = await self._resolve_static_entry(root_id, rel_clean, entry_path or "")
            clean_command = None
            clean_health = "/"
        else:
            await self._check_execution_allowed(workspace_id)
            target_entry = await self._stat(RootedPath(root_id=root_id, relative_path=rel_clean))
            if target_entry.kind is not FileKind.DIRECTORY:
                raise BadRequestError("service 预览的 path 必须是项目目录（可将单脚本放在目录中）")
            if entry_path:
                clean_entry = validate_relative_path(entry_path)
                _check_safe_parts(relative_parts(clean_entry))
            else:
                clean_entry = ""
            clean_health = validate_health_path(health_path)
            workspace_path, scratch_path, allowed_roots, binding = await self._context_paths(
                workspace_id, session_id, root_id
            )
            cwd_abs = os.path.realpath(os.path.join(binding.path, *parts))
            clean_command = validate_start_command(
                start_command,
                cwd_abs=cwd_abs,
                workspace_path=workspace_path,
                scratch_path=scratch_path,
                allowed_roots=allowed_roots,
            )

        now = utc_now()
        async with self._uow_factory() as uow:
            existing = await uow.preview.find_matching(
                session_id=session_id, kind=kind, root_id=root_id, relative_path=rel_clean
            )
            if existing is not None:
                preview = existing.model_copy(
                    update={
                        "workspace_id": workspace_id,
                        "run_id": run_id,
                        "name": clean_name,
                        "entry_path": clean_entry,
                        "start_command": clean_command,
                        "health_path": clean_health,
                        "updated_at": now,
                    }
                )
            else:
                preview = WorkspacePreview(
                    workspace_id=workspace_id,
                    session_id=session_id,
                    run_id=run_id,
                    name=clean_name,
                    kind=kind,
                    root_id=root_id,
                    relative_path=rel_clean,
                    entry_path=clean_entry,
                    start_command=clean_command,
                    health_path=clean_health,
                    created_at=now,
                    updated_at=now,
                )
            saved = await uow.preview.save(preview)

        if kind == "static":
            return self._to_view(saved, None), "", None

        # 服务已登记过且正在运行：停止旧进程后按新声明启动
        await self.stop(saved.id)
        try:
            view = await self.start(saved.id)
            logs = await self.read_logs(saved.id)
            tail = _clean_logs(logs.text, self._settings_provider().managed_preview_log_tail_chars)
            return view, tail, None
        except Exception as exc:
            logs = await self.read_logs(saved.id)
            tail = _clean_logs(logs.text, self._settings_provider().managed_preview_log_tail_chars)
            failed_view = await self.get_preview(saved.id)
            return failed_view, tail, str(exc) or "启动预览服务失败"

    async def start(self, preview_id: str) -> ManagedPreviewView:
        async with self._lock_for(preview_id):
            async with self._read_uow_factory() as uow:
                preview = await uow.preview.get(preview_id)
            if preview is None:
                raise NotFoundError("项目预览不存在")
            if preview.kind != "service":
                raise BadRequestError("静态预览无需启动服务进程")

            existing = await self._reconcile_running(self._runtime.get(preview_id))
            if existing is not None and existing.state == "running":
                return self._to_view(preview, existing)

            await self._check_execution_allowed(preview.workspace_id)
            workspace_path, scratch_path, allowed_roots, binding = await self._context_paths(
                preview.workspace_id, preview.session_id, preview.root_id
            )
            dir_parts = relative_parts(preview.relative_path)
            _check_safe_parts(dir_parts)
            dir_entry = await self._stat(RootedPath(root_id=preview.root_id, relative_path=preview.relative_path))
            if dir_entry.kind is not FileKind.DIRECTORY:
                raise BadRequestError("预览项目目录不存在或不是目录")
            cwd_abs = os.path.realpath(os.path.join(binding.path, *dir_parts))
            command = validate_start_command(
                preview.start_command,
                cwd_abs=cwd_abs,
                workspace_path=workspace_path,
                scratch_path=scratch_path,
                allowed_roots=allowed_roots,
            )
            health_path = validate_health_path(preview.health_path)
            settings = self._settings_provider()

            # 在状态锁内清理失联进程并校验轻量并发配额，然后放入 starting 占位
            started_ms = int(time.time() * 1000)
            running = RunningPreview(
                preview_id=preview.id,
                workspace_id=preview.workspace_id,
                session_id=preview.session_id,
                process_id=None,
                port=None,
                state="starting",
                started_at_ms=started_ms,
            )
            async with self._state_lock:
                await self._reconcile_all_active()
                active = [item for item in self._runtime.values() if item.state in ("starting", "running")]
                if len(active) >= settings.managed_preview_max_global:
                    raise ConflictError(
                        f"同时运行的轻量预览服务已达上限（全局最多 {settings.managed_preview_max_global} 个），"
                        "请先停止不再使用的预览后再试"
                    )
                bucket_count = sum(1 for item in active if item.workspace_id == preview.workspace_id)
                if bucket_count >= settings.managed_preview_max_per_workspace:
                    scope_label = "当前工作区" if preview.workspace_id else "独立对话"
                    raise ConflictError(
                        f"{scope_label}同时运行的轻量预览服务已达上限（最多 {settings.managed_preview_max_per_workspace} 个），"
                        "请先停止一个运行中的预览后再试"
                    )
                self._runtime[preview.id] = running

            executor = await self._executor_provider()
            executor.register_root(binding.root_id, binding.path)
            port = allocate_loopback_port()
            env = self._build_service_env(port, scratch_path)
            spec = ProcessSpec(
                shell_command=command,
                cwd=RootedPath(root_id=preview.root_id, relative_path=preview.relative_path),
                env=env,
                owner=ProcessOwner(kind="preview", session_id=preview.session_id, preview_id=preview.id),
                interactive=False,
            )
            try:
                proc_status = await executor.start(spec)
                running.process_id = proc_status.process_id
                running.port = port
            except Exception as exc:
                running.state = "failed"
                running.port = None
                running.error = f"启动预览进程失败：{exc}"
                raise AppException(ErrorCode.UNAVAILABLE, running.error) from exc

            try:
                await self._wait_for_health(
                    executor,
                    running,
                    health_path=health_path,
                    timeout_seconds=settings.managed_preview_start_timeout_seconds,
                    interval_seconds=settings.managed_preview_health_interval_seconds,
                    log_tail_chars=settings.managed_preview_log_tail_chars,
                )
            except Exception as exc:
                running.state = "failed"
                running.port = None
                running.error = str(exc) or "预览服务启动健康检查未通过"
                raise AppException(ErrorCode.UNAVAILABLE, running.error) from exc

            running.state = "running"
            running.error = None
            return self._to_view(preview, running)

    def _build_service_env(self, port: int, scratch_path: Optional[str]) -> dict[str, str]:
        env: dict[str, str] = {
            "HOST": "127.0.0.1",
            "BIND_HOST": "127.0.0.1",
            "PORT": str(port),
            "PYTHONUNBUFFERED": "1",
            "SHELL": detect_posix_shell(),
        }
        if scratch_path:
            tmp_dir = os.path.join(scratch_path, "tmp")
            cache_dir = os.path.join(scratch_path, ".cache")
            try:
                os.makedirs(tmp_dir, exist_ok=True)
                os.makedirs(cache_dir, exist_ok=True)
                env.update({
                    "TMPDIR": tmp_dir,
                    "TMP": tmp_dir,
                    "TEMP": tmp_dir,
                    "XDG_CACHE_HOME": cache_dir,
                    "PIP_CACHE_DIR": os.path.join(cache_dir, "pip"),
                    "UV_CACHE_DIR": os.path.join(cache_dir, "uv"),
                    "npm_config_cache": os.path.join(cache_dir, "npm"),
                })
            except OSError:
                pass
        return env

    async def _read_tail(self, executor, process_id: str, limit_chars: int) -> str:
        try:
            output = await executor.read_output(process_id, 0)
        except Exception:
            return ""
        return _clean_logs(output.text, limit_chars).strip()

    async def _wait_for_health(
        self,
        executor,
        running: RunningPreview,
        *,
        health_path: str,
        timeout_seconds: float,
        interval_seconds: float,
        log_tail_chars: int,
    ) -> None:
        assert running.process_id is not None and running.port is not None
        url = f"http://127.0.0.1:{running.port}{health_path}"
        deadline = time.monotonic() + timeout_seconds
        last_probe_error = "服务尚未监听回环端口"

        async with httpx.AsyncClient(trust_env=False, follow_redirects=False) as client:
            while True:
                proc_status = await executor.status(running.process_id)
                if proc_status.state is not ProcessState.RUNNING:
                    running.exit_code = proc_status.exit_code
                    tail = await self._read_tail(executor, running.process_id, log_tail_chars)
                    if not proc_status.tree_gone:
                        await self._terminate_tree(executor, running.process_id)
                    detail = f"预览服务进程提前退出（退出码 {proc_status.exit_code}）"
                    if tail:
                        detail += f"；日志尾部：\n{tail}"
                    raise RuntimeError(detail)

                try:
                    resp = await client.get(url, timeout=1.0)
                    if 200 <= resp.status_code < 400:
                        return
                    last_probe_error = f"HTTP {resp.status_code}"
                except httpx.RequestError as exc:
                    last_probe_error = str(exc) or type(exc).__name__

                if time.monotonic() >= deadline:
                    break
                await asyncio.sleep(min(interval_seconds, max(0.05, deadline - time.monotonic())))

        await self._terminate_tree(executor, running.process_id)
        tail = await self._read_tail(executor, running.process_id, log_tail_chars)
        detail = f"预览服务在 {timeout_seconds:.1f} 秒内未通过回环健康检查（{url}，最后检查：{last_probe_error}）"
        if tail:
            detail += f"；日志尾部：\n{tail}"
        raise RuntimeError(detail)

    async def _terminate_tree(self, executor, process_id: str) -> Optional[int]:
        grace = self._settings_provider().managed_preview_stop_grace_seconds
        status = await executor.stop_tree(process_id, grace)
        if status.state is ProcessState.RUNNING or not status.tree_gone:
            status = await executor.kill_tree(process_id)
        return status.exit_code

    async def _stop_unlocked(self, preview_id: str, *, forget: bool = False) -> None:
        running = self._runtime.get(preview_id)
        if running is None:
            return
        process_id = running.process_id
        if process_id:
            try:
                executor = await self._executor_provider()
                running.exit_code = await self._terminate_tree(executor, process_id)
            except Exception as exc:
                logger.warning("停止预览进程 %s 失败: %s", preview_id, exc)
        if forget:
            self._runtime.pop(preview_id, None)
        else:
            running.state = "stopped"
            running.port = None
            running.error = None

    async def stop(self, preview_id: str) -> ManagedPreviewView:
        async with self._lock_for(preview_id):
            async with self._read_uow_factory() as uow:
                preview = await uow.preview.get(preview_id)
            if preview is None:
                self._runtime.pop(preview_id, None)
                raise NotFoundError("项目预览不存在")
            if preview.kind == "service":
                await self._stop_unlocked(preview_id, forget=False)
            return self._to_view(preview, self._runtime.get(preview_id))

    async def restart(self, preview_id: str) -> ManagedPreviewView:
        await self.stop(preview_id)
        return await self.start(preview_id)

    async def read_logs(self, preview_id: str, offset: int = 0) -> ManagedPreviewLogsResponse:
        async with self._read_uow_factory() as uow:
            preview = await uow.preview.get(preview_id)
        if preview is None:
            raise NotFoundError("项目预览不存在")
        running = await self._reconcile_running(self._runtime.get(preview_id)) if preview.kind == "service" else None
        state: PreviewRuntimeState = "ready" if preview.kind == "static" else (running.state if running else "stopped")
        if running is None or not running.process_id:
            return ManagedPreviewLogsResponse(preview_id=preview_id, state=state, text="", next_offset=0, truncated=False)
        try:
            executor = await self._executor_provider()
            output = await executor.read_output(running.process_id, max(0, offset))
            return ManagedPreviewLogsResponse(
                preview_id=preview_id,
                state=state,
                text=_clean_logs(output.text),
                next_offset=output.next_offset,
                truncated=output.truncated,
            )
        except Exception:
            return ManagedPreviewLogsResponse(preview_id=preview_id, state=state, text="", next_offset=0, truncated=False)

    async def _zip_dir_parts(self, preview: WorkspacePreview) -> tuple[RootBinding, tuple[str, ...]]:
        rel_parts = relative_parts(preview.relative_path)
        _check_safe_parts(rel_parts)
        target = RootedPath(root_id=preview.root_id, relative_path=preview.relative_path)
        entry = await self._stat(target)
        dir_parts = rel_parts[:-1] if entry.kind is FileKind.FILE and rel_parts else rel_parts
        binding = await self._resolve_binding(preview.root_id)
        return binding, dir_parts

    async def check_export_zip(self, preview_id: str) -> tuple[WorkspacePreview, str]:
        async with self._read_uow_factory() as uow:
            preview = await uow.preview.get(preview_id)
        if preview is None:
            raise NotFoundError("项目预览不存在")
        await self._zip_dir_parts(preview)
        return preview, _safe_zip_name(preview.name)

    async def export_zip(self, preview_id: str) -> tuple[BinaryIO, str]:
        preview, filename = await self.check_export_zip(preview_id)
        binding, dir_parts = await self._zip_dir_parts(preview)
        settings = self._settings_provider()
        limits = getattr(self._roots(), "limits", None) or FileLimits()
        extra_files = {_README_START_NAME: _start_guide_bytes(preview)} if preview.kind == "service" else None
        archive, cancelled = await run_file_io(
            _build_directory_zip,
            binding,
            dir_parts,
            limits,
            settings.static_preview_zip_max_files,
            settings.static_preview_zip_max_bytes,
            extra_files,
        )
        if cancelled:
            archive.close()
            raise asyncio.CancelledError()
        return archive, filename

    async def delete(self, preview_id: str) -> bool:
        async with self._lock_for(preview_id):
            await self._stop_unlocked(preview_id, forget=True)
            async with self._uow_factory() as uow:
                removed = await uow.preview.delete(preview_id)
            self._locks.pop(preview_id, None)
            if not removed:
                raise NotFoundError("项目预览不存在")
            return True

    async def stop_by_session(self, session_id: str) -> None:
        ids = [pid for pid, item in list(self._runtime.items()) if item.session_id == session_id]
        for pid in ids:
            try:
                async with self._lock_for(pid):
                    await self._stop_unlocked(pid, forget=True)
                self._locks.pop(pid, None)
            except Exception:
                logger.exception("回收会话 %s 的预览 %s 失败", session_id, pid)

    async def stop_by_workspace(self, workspace_id: str) -> None:
        ids = [pid for pid, item in list(self._runtime.items()) if item.workspace_id == workspace_id]
        for pid in ids:
            try:
                async with self._lock_for(pid):
                    await self._stop_unlocked(pid, forget=True)
                self._locks.pop(pid, None)
            except Exception:
                logger.exception("回收工作区 %s 的预览 %s 失败", workspace_id, pid)

    async def stop_all(self) -> None:
        ids = list(self._runtime.keys())
        for pid in ids:
            try:
                async with self._lock_for(pid):
                    await self._stop_unlocked(pid, forget=True)
                self._locks.pop(pid, None)
            except Exception:
                logger.exception("回收全部预览时停止 %s 失败", pid)
