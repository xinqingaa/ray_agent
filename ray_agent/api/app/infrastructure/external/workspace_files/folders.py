"""文件夹级访问与 `.rayagent/workspace.json` 标记的 POSIX 实现。

标记只记录「本机安装身份 → 工作区身份」；写入与移除只触及本机条目，其他条目原样保留。
"""
import asyncio
import json
import os
import stat
import time
import uuid

from pydantic import ValidationError

from app.domain.external.workspace_files import FileLimits, RootBinding, ScanSummary, WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootKind
from app.domain.models.workspace import (
    MARKER_DIRECTORY, MARKER_FILE, MARKER_FORMAT, FolderInspection, MarkerEntry, MarkerFile,
)
from app.domain.services.file_io import run_file_io
from app.infrastructure.external.workspace_files.posix import (
    _DIR_FLAGS, open_root, scan_binding, sweep_temp_files,
)

MARKER_MAX_BYTES = 64 * 1024
FOLDER_NAME_ATTEMPTS = 1000


def _fail(code: ErrorCode, message: str) -> WorkspaceFileError:
    return WorkspaceFileError(code, message)


def _binding(path: str, dev: int | None = None, ino: int | None = None) -> RootBinding:
    return RootBinding(root_id="folder", kind=RootKind.WORKSPACE_FOLDER, path=path, dev=dev, ino=ino)


def _marker_dir(root_fd: int, *, create: bool) -> int | None:
    """打开 `.rayagent`；不存在为 None，是链接或普通文件时拒绝。"""
    try:
        return os.open(MARKER_DIRECTORY, _DIR_FLAGS, dir_fd=root_fd)
    except FileNotFoundError:
        if not create:
            return None
    except OSError as error:
        raise _fail(ErrorCode.FORBIDDEN, f".rayagent 不是普通目录：{error.strerror}")
    try:
        os.mkdir(MARKER_DIRECTORY, 0o777, dir_fd=root_fd)
        return os.open(MARKER_DIRECTORY, _DIR_FLAGS, dir_fd=root_fd)
    except FileExistsError:
        return os.open(MARKER_DIRECTORY, _DIR_FLAGS, dir_fd=root_fd)
    except OSError as error:
        raise _fail(ErrorCode.FORBIDDEN, f"无法创建 .rayagent：{error.strerror}")


def _read_marker(marker_fd: int) -> tuple[MarkerFile | None, bool]:
    """返回 (标记, 是否不可读)；文件不存在为 (None, False)。"""
    try:
        fd = os.open(MARKER_FILE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=marker_fd)
    except FileNotFoundError:
        return None, False
    except OSError:
        return None, True
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None, True
        raw = os.read(fd, MARKER_MAX_BYTES + 1)
    finally:
        os.close(fd)
    if len(raw) > MARKER_MAX_BYTES:
        return None, True
    try:
        marker = MarkerFile.model_validate(json.loads(raw.decode("utf-8")))
    except (ValueError, ValidationError):
        return None, True
    return (marker, False) if marker.format == MARKER_FORMAT else (None, True)


def _write_marker_file(marker_fd: int, marker: MarkerFile) -> None:
    data = json.dumps(marker.model_dump(), ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    temp = f".workspace-{uuid.uuid4().hex}.tmp"
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666, dir_fd=marker_fd)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rename(temp, MARKER_FILE, src_dir_fd=marker_fd, dst_dir_fd=marker_fd)
    except OSError as error:
        try:
            os.unlink(temp, dir_fd=marker_fd)
        except OSError:
            pass
        raise _fail(ErrorCode.FORBIDDEN, f"无法写入身份标记：{error.strerror}")


class PosixFolderAccess:
    def __init__(self, limits: FileLimits | None = None) -> None:
        self._limits = limits or FileLimits()

    async def _join(self, function, *args):
        result, cancelled = await run_file_io(function, *args)
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def inspect(self, path: str) -> FolderInspection:
        return await self._join(self._inspect, path)

    @staticmethod
    def _inspect(path: str) -> FolderInspection:
        try:
            real = os.path.realpath(path, strict=True)
        except OSError:
            raise _fail(ErrorCode.NOT_FOUND, "文件夹不存在")
        root_fd = open_root(_binding(real))
        try:
            info = os.fstat(root_fd)
            marker, unreadable = None, False
            marker_fd = _marker_dir(root_fd, create=False)
            if marker_fd is not None:
                try:
                    marker, unreadable = _read_marker(marker_fd)
                finally:
                    os.close(marker_fd)
            return FolderInspection(path=real, dev=info.st_dev, ino=info.st_ino, marker=marker,
                                    marker_unreadable=unreadable)
        finally:
            os.close(root_fd)

    async def scan(self, path: str, dev: int, ino: int) -> ScanSummary:
        return await self._join(scan_binding, _binding(path, dev, ino), (), self._limits)

    async def matches(self, path: str, dev: int, ino: int) -> bool:
        """只有路径不存在、不是目录或身份不符才算失联；权限、描述符耗尽等无法判断的错误向上抛出。"""
        def check() -> bool:
            try:
                os.close(open_root(_binding(path, dev, ino)))
                return True
            except WorkspaceFileError as error:
                if error.code is ErrorCode.UNAVAILABLE:
                    return False
                raise
        return await asyncio.to_thread(check)

    async def sweep_temp(self, path: str, dev: int, ino: int, max_age_seconds: float) -> int:
        return await self._join(sweep_temp_files, _binding(path, dev, ino), self._limits, max_age_seconds, time.time())

    async def exists(self, path: str) -> bool:
        return await asyncio.to_thread(os.path.isdir, path)

    async def create_folder(self, parent: str, name: str) -> str:
        return await self._join(self._create_folder, parent, name)

    @staticmethod
    def _create_folder(parent: str, name: str) -> str:
        try:
            os.makedirs(parent, exist_ok=True)
            base = os.path.realpath(parent)
            for attempt in range(1, FOLDER_NAME_ATTEMPTS + 1):
                candidate = name if attempt == 1 else f"{name} ({attempt})"
                try:
                    os.mkdir(os.path.join(base, candidate), 0o777)
                except FileExistsError:
                    continue
                return os.path.realpath(os.path.join(base, candidate))
        except OSError as error:
            raise _fail(ErrorCode.FORBIDDEN, f"无法创建文件夹：{error.strerror}")
        raise _fail(ErrorCode.CONFLICT, "同名文件夹过多，请换一个名称")

    async def remove_empty_folder(self, path: str) -> None:
        def remove() -> None:
            try:
                os.rmdir(path)
            except OSError:
                pass
        await asyncio.to_thread(remove)

    async def write_marker(self, path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> None:
        await self._join(self._write_marker, path, dev, ino, install_id, workspace_id)

    @staticmethod
    def _write_marker(path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> None:
        root_fd = open_root(_binding(path, dev, ino))
        try:
            marker_fd = _marker_dir(root_fd, create=True)
            try:
                marker, unreadable = _read_marker(marker_fd)
                if unreadable:
                    raise _fail(ErrorCode.CONFLICT, "已有的身份标记无法解析，不改写")
                marker = marker or MarkerFile()
                entry = MarkerEntry(install_id=install_id, workspace_id=workspace_id)
                entries = [item for item in marker.entries if item.install_id != install_id]
                _write_marker_file(marker_fd, marker.model_copy(update={"entries": [*entries, entry]}))
            finally:
                os.close(marker_fd)
        finally:
            os.close(root_fd)

    async def remove_marker(self, path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> bool:
        return await self._join(self._remove_marker, path, dev, ino, install_id, workspace_id)

    @staticmethod
    def _remove_marker(path: str, dev: int, ino: int, install_id: str, workspace_id: str) -> bool:
        try:
            root_fd = open_root(_binding(path, dev, ino))
        except WorkspaceFileError:
            return False
        try:
            marker_fd = _marker_dir(root_fd, create=False)
            if marker_fd is None:
                return True
            try:
                marker, unreadable = _read_marker(marker_fd)
                if unreadable:
                    return False
                if marker is None:
                    return True
                mine = marker.entry_for(install_id)
                if mine is None or mine.workspace_id != workspace_id:
                    return True
                rest = [item for item in marker.entries if item.install_id != install_id]
                try:
                    if rest:
                        _write_marker_file(marker_fd, marker.model_copy(update={"entries": rest}))
                    else:
                        os.unlink(MARKER_FILE, dir_fd=marker_fd)
                except (OSError, WorkspaceFileError):
                    return False
            finally:
                os.close(marker_fd)
            if not rest:
                try:
                    os.rmdir(MARKER_DIRECTORY, dir_fd=root_fd)  # 目录非空（其他内容）时保留
                except OSError:
                    pass
            return True
        finally:
            os.close(root_fd)
