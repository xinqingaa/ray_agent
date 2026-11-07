"""POSIX 限根文件 IO：用目录描述符逐级打开，不跟随任何符号链接。

每次操作先按登记的 (st_dev, st_ino) 核对根身份，再从根的描述符起用 O_NOFOLLOW | O_DIRECTORY 逐段 openat；
链接只报告 kind=symlink 与 readlink 文本，设备、管道与 socket 是 OTHER，拒绝读写；`.rayagent` 段一律拒绝。
写入是同目录临时文件加 fsync，发布前再次核对目标；跨进程没有原子的比较交换，两次核对之间的窗口只能缩小，不能消除。
"""
import asyncio
import errno
import hashlib
import os
import stat
import uuid
from collections import deque
from typing import BinaryIO, Awaitable, Callable

from app.domain.external.workspace_files import (
    DirectoryListing, FileEntry, FileKind, FileLimits, FileVersion, FolderSnapshot, RootBinding, ScanSummary,
    WorkspaceFileError,
)
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath, relative_parts
from app.domain.services.file_io import run_file_io
from app.domain.services.file_rules import DELETE_TEMP_PREFIX, WRITE_TEMP_PREFIX, is_excluded, is_internal_temp, is_reserved

RootResolver = Callable[[str], Awaitable[RootBinding]]

_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_CHUNK = 1024 * 1024
TEMP_PREFIX = WRITE_TEMP_PREFIX


def _fail(code: ErrorCode, message: str, current: FileVersion | None = None) -> WorkspaceFileError:
    version = f"{current.size}:{current.modified_ns}" if current is not None else None
    return WorkspaceFileError(code, message, resource_version=version, current=current)


def kind_of(mode: int) -> FileKind:
    if stat.S_ISREG(mode):
        return FileKind.FILE
    if stat.S_ISDIR(mode):
        return FileKind.DIRECTORY
    if stat.S_ISLNK(mode):
        return FileKind.SYMLINK
    return FileKind.OTHER


def version_of(info: os.stat_result) -> FileVersion:
    return FileVersion(size=info.st_size, modified_ns=info.st_mtime_ns)


def _same_version(info: os.stat_result, expected: FileVersion) -> bool:
    return info.st_size == expected.size and info.st_mtime_ns == expected.modified_ns


def _os_error(error: OSError, what: str) -> WorkspaceFileError:
    if isinstance(error, FileNotFoundError):
        return _fail(ErrorCode.NOT_FOUND, f"{what}不存在")
    if isinstance(error, PermissionError):
        return _fail(ErrorCode.FORBIDDEN, f"没有权限访问{what}")
    if error.errno == errno.ENAMETOOLONG:
        return _fail(ErrorCode.INVALID_REQUEST, f"{what}的名称过长")
    if error.errno in (errno.ENOSPC, errno.EDQUOT):
        return _fail(ErrorCode.UNAVAILABLE, "磁盘空间不足")
    if error.errno == errno.EROFS:
        return _fail(ErrorCode.FORBIDDEN, "文件夹是只读的")
    return _fail(ErrorCode.INTERNAL_ERROR, f"访问{what}失败：{error.strerror or error}")


def open_root(binding: RootBinding) -> int:
    """打开根目录并核对登记的文件系统身份；根失联或被替换时为 unavailable。"""
    try:
        fd = os.open(binding.path, os.O_RDONLY | os.O_DIRECTORY)
    except (FileNotFoundError, NotADirectoryError):
        raise _fail(ErrorCode.UNAVAILABLE, "文件夹不存在或已移动")
    except OSError as error:
        raise _os_error(error, "文件夹")
    info = os.fstat(fd)
    if binding.dev is not None and (info.st_dev, info.st_ino) != (binding.dev, binding.ino):
        os.close(fd)
        raise _fail(ErrorCode.UNAVAILABLE, "文件夹已被替换，与登记的身份不符")
    return fd


def _parts(relative: str) -> tuple[str, ...]:
    parts = relative_parts(relative)
    _check_parts(parts)
    return parts


def _check_parts(parts: tuple[str, ...]) -> None:
    for part in parts:
        if is_reserved(part):
            raise _fail(ErrorCode.FORBIDDEN, "该路径属于应用保留目录，不可访问")


def _open_dir(parent_fd: int, name: str) -> int:
    try:
        return os.open(name, _DIR_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError:
        raise _fail(ErrorCode.NOT_FOUND, f"目录 {name} 不存在")
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR, errno.EMLINK):
            try:
                mode = os.stat(name, dir_fd=parent_fd, follow_symlinks=False).st_mode
            except OSError:
                raise _fail(ErrorCode.NOT_FOUND, f"目录 {name} 不存在")
            if stat.S_ISLNK(mode):
                raise _fail(ErrorCode.FORBIDDEN, f"{name} 是符号链接，路径不跟随链接")
            raise _fail(ErrorCode.INVALID_REQUEST, f"{name} 不是目录")
        raise _os_error(error, f"目录 {name}")


def walk_dirs(root_fd: int, parts: tuple[str, ...], *, create: bool = False) -> int:
    """从根描述符逐级打开目录，返回最后一级的新描述符；调用方负责关闭。"""
    _check_parts(parts)
    fd = os.dup(root_fd)
    try:
        for name in parts:
            try:
                nxt = _open_dir(fd, name)
            except WorkspaceFileError as error:
                if not create or error.code is not ErrorCode.NOT_FOUND:
                    raise
                try:
                    os.mkdir(name, 0o777, dir_fd=fd)
                except FileExistsError:
                    pass
                except OSError as os_error:
                    raise _os_error(os_error, f"目录 {name}")
                nxt = _open_dir(fd, name)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def _lstat(dir_fd: int, name: str) -> os.stat_result:
    try:
        return os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except OSError as error:
        raise _os_error(error, name)


def _actual_name(dir_fd: int, name: str) -> str:
    """目录中与 name 同名（含大小写不同）的条目的实际名称。"""
    folded = name.casefold()
    with os.scandir(dir_fd) as entries:
        names = [entry.name for entry in entries]
    if name in names:
        return name
    return next((candidate for candidate in names if candidate.casefold() == folded), name)


def _entry(root_id: str, parts: tuple[str, ...], name: str, info: os.stat_result, dir_fd: int | None) -> FileEntry:
    kind = kind_of(info.st_mode)
    target = None
    if kind is FileKind.SYMLINK and dir_fd is not None:
        try:
            target = os.readlink(name, dir_fd=dir_fd)
        except OSError:
            target = None
    return FileEntry(path=RootedPath(root_id=root_id, relative_path="/".join(parts)), name=name, kind=kind,
                     version=version_of(info) if kind is FileKind.FILE else None, link_target=target,
                     inode=info.st_ino)


def _refuse_non_file(kind: FileKind, name: str) -> WorkspaceFileError:
    if kind is FileKind.DIRECTORY:
        return _fail(ErrorCode.INVALID_REQUEST, f"{name} 是目录")
    if kind is FileKind.SYMLINK:
        return _fail(ErrorCode.FORBIDDEN, f"{name} 是符号链接，不跟随也不读写链接")
    return _fail(ErrorCode.FORBIDDEN, f"{name} 是设备、管道或 socket 等特殊文件，拒绝读写")


def _open_file(parent_fd: int, name: str, expected: FileVersion | None) -> tuple[int, os.stat_result]:
    info = _lstat(parent_fd, name)
    kind = kind_of(info.st_mode)
    if kind is not FileKind.FILE:
        raise _refuse_non_file(kind, name)
    try:
        # O_NONBLOCK 防止在检查与打开之间被换成管道时阻塞
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENXIO):
            raise _fail(ErrorCode.CONFLICT, f"{name} 在读取前被替换")
        raise _os_error(error, name)
    opened = os.fstat(fd)
    if not stat.S_ISREG(opened.st_mode):
        os.close(fd)
        raise _fail(ErrorCode.CONFLICT, f"{name} 在读取前被替换")
    if expected is not None and not _same_version(opened, expected):
        os.close(fd)
        raise _fail(ErrorCode.CONFLICT, f"{name} 已被修改", version_of(opened))
    return fd, opened


def _hash_fd(fd: int) -> str:
    digest, offset = hashlib.sha256(), 0
    while chunk := os.pread(fd, _CHUNK, offset):
        digest.update(chunk)
        offset += len(chunk)
    return digest.hexdigest()


def _target_state(parent_fd: int, name: str, expected: FileVersion | None) -> os.stat_result | None:
    """写入或发布前核对目标：expected 为空必须不存在，否则必须是版本相同的普通文件。"""
    try:
        info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        info = None
    except OSError as error:
        raise _os_error(error, name)
    if info is None:
        if expected is not None:
            raise _fail(ErrorCode.CONFLICT, f"{name} 已被删除")
        return None
    actual = _actual_name(parent_fd, name)
    if actual != name:
        raise _fail(ErrorCode.CONFLICT, f"已存在大小写不同的同名文件 {actual}，不覆盖", version_of(info))
    kind = kind_of(info.st_mode)
    if kind is not FileKind.FILE:
        raise _refuse_non_file(kind, name)
    if expected is None:
        raise _fail(ErrorCode.CONFLICT, f"{name} 已存在，不覆盖", version_of(info))
    if not _same_version(info, expected):
        raise _fail(ErrorCode.CONFLICT, f"{name} 已被修改", version_of(info))
    if expected.content_hash is not None:
        fd, _ = _open_file(parent_fd, name, expected)
        try:
            if _hash_fd(fd) != expected.content_hash:
                raise _fail(ErrorCode.CONFLICT, f"{name} 的内容已被修改", version_of(info))
        finally:
            os.close(fd)
    return info


class PosixWorkspaceFiles:
    """实现 WorkspaceFiles。resolve 把 root_id 解析为登记的位置与身份；before_publish 是发布窗口的测试观察点。"""

    def __init__(self, resolve: RootResolver, limits: FileLimits | None = None) -> None:
        self._resolve = resolve
        self.limits = limits or FileLimits()
        self.before_publish: Callable[[], None] | None = None

    async def _run(self, function, *args):
        result, cancelled = await run_file_io(function, *args)
        if cancelled:
            raise asyncio.CancelledError()
        return result

    async def _binding(self, path: RootedPath) -> RootBinding:
        return await self._resolve(path.root_id)

    async def stat(self, path: RootedPath, *, with_hash: bool = False) -> FileEntry:
        binding = await self._binding(path)
        return await self._run(self._stat, binding, path, with_hash)

    def _stat(self, binding: RootBinding, path: RootedPath, with_hash: bool) -> FileEntry:
        parts = _parts(path.relative_path)
        root_fd = open_root(binding)
        try:
            if not parts:
                return _entry(binding.root_id, (), "", os.fstat(root_fd), None)
            parent_fd = walk_dirs(root_fd, parts[:-1])
            try:
                info = _lstat(parent_fd, parts[-1])
                entry = _entry(binding.root_id, parts, parts[-1], info, parent_fd)
                if with_hash and entry.kind is FileKind.FILE:
                    fd, opened = _open_file(parent_fd, parts[-1], None)
                    try:
                        digest = _hash_fd(fd)
                    finally:
                        os.close(fd)
                    entry.version = FileVersion(size=opened.st_size, modified_ns=opened.st_mtime_ns,
                                                content_hash=digest)
                return entry
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    async def list_dir(self, path: RootedPath, limit: int | None = None) -> DirectoryListing:
        binding = await self._binding(path)
        cap = min(limit, self.limits.list_entries) if limit else self.limits.list_entries
        return await self._run(self._list_dir, binding, path, cap)

    def _list_dir(self, binding: RootBinding, path: RootedPath, cap: int) -> DirectoryListing:
        parts = _parts(path.relative_path)
        root_fd = open_root(binding)
        try:
            dir_fd = walk_dirs(root_fd, parts)
            try:
                entries, truncated = [], False
                with os.scandir(dir_fd) as scanner:
                    names = sorted(scanner, key=lambda item: item.name.casefold())
                for item in names:
                    try:
                        info = item.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    kind = kind_of(info.st_mode)
                    if is_excluded(item.name, kind is FileKind.DIRECTORY):
                        continue
                    if len(entries) >= cap:
                        truncated = True
                        break
                    entries.append(_entry(binding.root_id, (*parts, item.name), item.name, info, dir_fd))
                return DirectoryListing(path=path, entries=entries, truncated=truncated)
            finally:
                os.close(dir_fd)
        finally:
            os.close(root_fd)

    async def read_bytes(self, path: RootedPath, offset: int = 0, length: int | None = None,
                         expected: FileVersion | None = None) -> bytes:
        binding = await self._binding(path)
        if length is not None and length > self.limits.read_bytes:
            raise _fail(ErrorCode.PAYLOAD_TOO_LARGE, f"单次最多读取 {self.limits.read_bytes} 字节，请分段读取")
        want = self.limits.read_bytes if length is None else length
        return await self._run(self._read, binding, path, offset, want, expected)

    def _read(self, binding: RootBinding, path: RootedPath, offset: int, length: int,
              expected: FileVersion | None) -> bytes:
        parts = _parts(path.relative_path)
        if not parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "根目录不是文件")
        root_fd = open_root(binding)
        try:
            parent_fd = walk_dirs(root_fd, parts[:-1])
            try:
                fd, info = _open_file(parent_fd, parts[-1], expected)
                try:
                    chunks, position, remaining = [], offset, length
                    while remaining > 0:
                        chunk = os.pread(fd, min(remaining, _CHUNK), position)
                        if not chunk:
                            break
                        chunks.append(chunk)
                        position += len(chunk)
                        remaining -= len(chunk)
                    if expected is not None and not _same_version(os.fstat(fd), expected):
                        raise _fail(ErrorCode.CONFLICT, f"{parts[-1]} 在读取期间被修改", version_of(os.fstat(fd)))
                    return b"".join(chunks)
                finally:
                    os.close(fd)
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    async def open_reader(self, path: RootedPath, expected: FileVersion | None = None) -> BinaryIO:
        binding = await self._binding(path)
        return await self._run(self._open_reader, binding, path, expected)

    def _open_reader(self, binding: RootBinding, path: RootedPath, expected: FileVersion | None) -> BinaryIO:
        parts = _parts(path.relative_path)
        if not parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "根目录不是文件")
        root_fd = open_root(binding)
        try:
            parent_fd = walk_dirs(root_fd, parts[:-1])
            try:
                fd, _ = _open_file(parent_fd, parts[-1], expected)
                return os.fdopen(fd, "rb")
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    async def write_bytes(self, path: RootedPath, data: bytes, expected: FileVersion | None) -> FileVersion:
        import io
        return await self.write_stream(path, io.BytesIO(data), expected)

    async def write_stream(self, path: RootedPath, source: BinaryIO, expected: FileVersion | None) -> FileVersion:
        binding = await self._binding(path)
        return await self._run(self._write, binding, path, source, expected)

    def _write(self, binding: RootBinding, path: RootedPath, source: BinaryIO,
               expected: FileVersion | None) -> FileVersion:
        parts = _parts(path.relative_path)
        if not parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "根目录不是文件")
        name = parts[-1]
        root_fd = open_root(binding)
        try:
            parent_fd = walk_dirs(root_fd, parts[:-1])
            try:
                existing = _target_state(parent_fd, name, expected)
                return self._publish(parent_fd, name, source, expected, existing)
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    def _publish(self, parent_fd: int, name: str, source: BinaryIO, expected: FileVersion | None,
                 existing: os.stat_result | None) -> FileVersion:
        temp = f"{TEMP_PREFIX}{uuid.uuid4().hex}.tmp"
        try:
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666, dir_fd=parent_fd)
        except OSError as error:
            raise _os_error(error, "临时文件")
        try:
            try:
                written = 0
                while chunk := source.read(_CHUNK):
                    written += len(chunk)
                    if written > self.limits.write_bytes:
                        raise _fail(ErrorCode.PAYLOAD_TOO_LARGE, f"写入内容超过上限 {self.limits.write_bytes} 字节")
                    view = memoryview(chunk)
                    while view:
                        view = view[os.write(fd, view):]
                if existing is not None:
                    os.fchmod(fd, stat.S_IMODE(existing.st_mode))
                os.fsync(fd)
                created = os.fstat(fd)
            finally:
                os.close(fd)
            if self.before_publish is not None:
                self.before_publish()
            if expected is None:
                try:
                    os.link(temp, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
                except FileExistsError:
                    current = None
                    try:
                        current = version_of(os.stat(name, dir_fd=parent_fd, follow_symlinks=False))
                    except OSError:
                        pass
                    raise _fail(ErrorCode.CONFLICT, f"{name} 在写入期间被创建，不覆盖", current)
                except OSError as error:
                    raise _os_error(error, name)
            else:
                _target_state(parent_fd, name, expected)
                try:
                    os.rename(temp, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                except OSError as error:
                    raise _os_error(error, name)
        except BaseException:
            self._discard(parent_fd, temp)
            raise
        if expected is None:
            self._discard(parent_fd, temp)
        try:
            os.fsync(parent_fd)
        except OSError:
            pass
        return version_of(created)

    @staticmethod
    def _discard(parent_fd: int, temp: str) -> None:
        try:
            os.unlink(temp, dir_fd=parent_fd)
        except OSError:
            pass

    async def mkdir(self, path: RootedPath, parents: bool = True) -> FileEntry:
        binding = await self._binding(path)
        return await self._run(self._mkdir, binding, path, parents)

    def _mkdir(self, binding: RootBinding, path: RootedPath, parents: bool) -> FileEntry:
        parts = _parts(path.relative_path)
        if not parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "根目录已存在")
        root_fd = open_root(binding)
        try:
            parent_fd = walk_dirs(root_fd, parts[:-1], create=parents)
            try:
                try:
                    os.mkdir(parts[-1], 0o777, dir_fd=parent_fd)
                except FileExistsError:
                    pass
                except OSError as error:
                    raise _os_error(error, parts[-1])
                info = _lstat(parent_fd, parts[-1])
                if not stat.S_ISDIR(info.st_mode):
                    raise _fail(ErrorCode.CONFLICT, f"{parts[-1]} 已存在且不是目录")
                return _entry(binding.root_id, parts, parts[-1], info, parent_fd)
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    async def move(self, source: RootedPath, target: RootedPath, expected: FileVersion | None = None) -> FileEntry:
        if source.root_id != target.root_id:
            raise _fail(ErrorCode.INVALID_REQUEST, "不能跨根移动")
        binding = await self._binding(source)
        return await self._run(self._move, binding, source, target, expected)

    def _move(self, binding: RootBinding, source: RootedPath, target: RootedPath,
              expected: FileVersion | None) -> FileEntry:
        src_parts, dst_parts = _parts(source.relative_path), _parts(target.relative_path)
        if not src_parts or not dst_parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "不能移动根目录")
        root_fd = open_root(binding)
        try:
            src_fd = walk_dirs(root_fd, src_parts[:-1])
            try:
                dst_fd = walk_dirs(root_fd, dst_parts[:-1])
                try:
                    src_name, dst_name = src_parts[-1], dst_parts[-1]
                    info = _lstat(src_fd, src_name)
                    kind = kind_of(info.st_mode)
                    if kind is FileKind.FILE and expected is not None and not _same_version(info, expected):
                        raise _fail(ErrorCode.CONFLICT, f"{src_name} 已被修改", version_of(info))
                    if self._exists(dst_fd, dst_name):
                        raise _fail(ErrorCode.CONFLICT, f"{dst_name} 已存在，不覆盖")
                    try:
                        if kind is FileKind.FILE:
                            os.link(src_name, dst_name, src_dir_fd=src_fd, dst_dir_fd=dst_fd, follow_symlinks=False)
                            os.unlink(src_name, dir_fd=src_fd)
                        else:
                            os.rename(src_name, dst_name, src_dir_fd=src_fd, dst_dir_fd=dst_fd)
                    except FileExistsError:
                        raise _fail(ErrorCode.CONFLICT, f"{dst_name} 已存在，不覆盖")
                    except OSError as error:
                        raise _os_error(error, dst_name)
                    return _entry(binding.root_id, dst_parts, dst_name, _lstat(dst_fd, dst_name), dst_fd)
                finally:
                    os.close(dst_fd)
            finally:
                os.close(src_fd)
        finally:
            os.close(root_fd)

    @staticmethod
    def _exists(dir_fd: int, name: str) -> bool:
        try:
            os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    async def delete(self, path: RootedPath, expected: FileVersion) -> None:
        binding = await self._binding(path)
        await self._run(self._delete, binding, path, expected)

    def _delete(self, binding: RootBinding, path: RootedPath, expected: FileVersion) -> None:
        """先把目标改名为临时名取得它，核对取到的仍是刚才核对过的那个文件再删除；核对与删除之间被外部换成别的文件时放回。"""
        parts = _parts(path.relative_path)
        if not parts:
            raise _fail(ErrorCode.INVALID_REQUEST, "不能删除根目录")
        root_fd = open_root(binding)
        try:
            parent_fd = walk_dirs(root_fd, parts[:-1])
            try:
                name = parts[-1]
                info = _lstat(parent_fd, name)
                kind = kind_of(info.st_mode)
                if kind is not FileKind.FILE:
                    raise _refuse_non_file(kind, name)
                if not _same_version(info, expected):
                    raise _fail(ErrorCode.CONFLICT, f"{name} 已被修改", version_of(info))
                grabbed = f"{DELETE_TEMP_PREFIX}{uuid.uuid4().hex}"
                try:
                    os.rename(name, grabbed, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                except OSError as error:
                    raise _os_error(error, name)
                taken = os.stat(grabbed, dir_fd=parent_fd, follow_symlinks=False)
                if (taken.st_dev, taken.st_ino) != (info.st_dev, info.st_ino) or not _same_version(taken, expected):
                    self._put_back(parent_fd, grabbed, name)
                    raise _fail(ErrorCode.CONFLICT, f"{name} 在删除前被替换或修改，未删除")
                os.unlink(grabbed, dir_fd=parent_fd)
            finally:
                os.close(parent_fd)
        finally:
            os.close(root_fd)

    @staticmethod
    def _put_back(parent_fd: int, grabbed: str, name: str) -> None:
        try:
            os.link(grabbed, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
            os.unlink(grabbed, dir_fd=parent_fd)
        except FileExistsError:
            raise _fail(ErrorCode.CONFLICT, f"{name} 在删除前被替换，同名位置已有新文件；被取下的文件保留为 {grabbed}")
        except OSError as error:
            raise _os_error(error, name)

    async def scan(self, path: RootedPath) -> ScanSummary:
        binding = await self._binding(path)
        return await self._run(scan_binding, binding, _parts(path.relative_path), self.limits)

    async def snapshot(self, path: RootedPath) -> FolderSnapshot:
        binding = await self._binding(path)
        return await self._run(snapshot_binding, binding, _parts(path.relative_path), self.limits)


class _Walk:
    """广度优先遍历目录树：遵守排除规则，不跟随链接；访问条数或深度超过上限时截断。

    待处理的目录只记相对路径，处理时才从根描述符逐级打开，同时打开的描述符数固定，与目录数量无关。
    目录在遍历中途消失算作已变化而跳过；无权进入标记为截断；其他失败（含描述符耗尽）向上抛出，不当作空目录。"""

    def __init__(self, binding: RootBinding, parts: tuple[str, ...], limits: FileLimits,
                 *, include_temp: bool = False) -> None:
        self.binding, self.parts, self.limits, self.include_temp = binding, parts, limits, include_temp
        self.truncated = False

    def _skip(self, name: str, is_directory: bool) -> bool:
        if self.include_temp and not is_directory and is_internal_temp(name):
            return False
        return is_excluded(name, is_directory)

    def _children(self, root_fd: int, dir_parts: tuple[str, ...]):
        """目录里的 (名称, stat)；目录不可进入时返回 None。stat 须在描述符关闭前取得。"""
        try:
            fd = walk_dirs(root_fd, dir_parts)
        except WorkspaceFileError as error:
            if dir_parts == self.parts:
                raise
            if error.code in (ErrorCode.NOT_FOUND, ErrorCode.INVALID_REQUEST):
                return None
            if error.code is ErrorCode.FORBIDDEN:
                self.truncated = True
                return None
            raise
        try:
            found = []
            with os.scandir(fd) as scanner:
                for item in scanner:
                    try:
                        found.append((item.name, item.stat(follow_symlinks=False)))
                    except OSError:
                        continue
            return found
        except FileNotFoundError:
            return None
        except PermissionError:
            self.truncated = True
            return None
        except OSError as error:
            raise _os_error(error, "目录")
        finally:
            os.close(fd)

    def __iter__(self):
        """产出 (所在目录的路径段, 名称, stat, 是否目录)。"""
        root_fd = open_root(self.binding)
        try:
            queue: deque[tuple[tuple[str, ...], int]] = deque([(self.parts, 0)])
            visited = 0
            while queue:
                dir_parts, depth = queue.popleft()
                items = self._children(root_fd, dir_parts)
                for name, info in items or ():
                    if visited >= self.limits.scan_entries:
                        self.truncated = True
                        return
                    is_directory = stat.S_ISDIR(info.st_mode)
                    if self._skip(name, is_directory):
                        continue
                    visited += 1
                    yield dir_parts, name, info, is_directory
                    if is_directory:
                        if depth + 1 > self.limits.scan_depth:
                            self.truncated = True
                        else:
                            queue.append(((*dir_parts, name), depth + 1))
        finally:
            os.close(root_fd)


def scan_binding(binding: RootBinding, parts: tuple[str, ...], limits: FileLimits) -> ScanSummary:
    summary = ScanSummary()
    walk = _Walk(binding, parts, limits)
    for _, _, info, is_directory in walk:
        if is_directory:
            summary.directories += 1
        elif stat.S_ISREG(info.st_mode):
            summary.files += 1
            summary.bytes += info.st_size
    summary.truncated = walk.truncated
    return summary


def snapshot_binding(binding: RootBinding, parts: tuple[str, ...], limits: FileLimits) -> FolderSnapshot:
    """与扫描相同的遍历与上限，记录每个普通文件的大小与修改时间。"""
    snapshot = FolderSnapshot(files={})
    walk = _Walk(binding, parts, limits)
    for dir_parts, name, info, is_directory in walk:
        if not is_directory and stat.S_ISREG(info.st_mode):
            snapshot.files["/".join((*dir_parts, name))] = (info.st_size, info.st_mtime_ns)
    snapshot.truncated = walk.truncated
    return snapshot


def sweep_temp_files(binding: RootBinding, limits: FileLimits, max_age_seconds: float, now: float) -> int:
    """清理崩溃残留的写入临时文件：只处理本应用命名规则（前缀与 .tmp 后缀）且超过期限的普通文件，返回清理数量。"""
    removed = 0
    root_fd = open_root(binding)
    try:
        for dir_parts, name, info, is_directory in _Walk(binding, (), limits, include_temp=True):
            if is_directory or not (name.startswith(WRITE_TEMP_PREFIX) and name.endswith(".tmp")):
                continue
            if not stat.S_ISREG(info.st_mode) or now - info.st_mtime < max_age_seconds:
                continue
            try:
                parent_fd = walk_dirs(root_fd, dir_parts)
            except WorkspaceFileError:
                continue
            try:
                os.unlink(name, dir_fd=parent_fd)
                removed += 1
            except OSError:
                pass
            finally:
                os.close(parent_fd)
    finally:
        os.close(root_fd)
    return removed
