#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""项目目录的只读浏览：读的是 API 容器内对宿主机目录的只读挂载，不访问沙箱。"""
import asyncio
import errno
import os
import posixpath
import stat
from typing import AbstractSet, List, Optional, Sequence

from app.domain.external.project import ProjectFiles
from app.domain.models.project import (
    BINARY_SNIFF_BYTES,
    DEFAULT_IGNORED_NAMES,
    FILE_READ_MAX_BYTES,
    PATH_CHECK_MESSAGES,
    TREE_ENTRY_LIMIT,
    BrowseEntry,
    BrowseListing,
    PathCheck,
    PathCheckReason,
    ProjectEntry,
    ProjectFile,
    ProjectListing,
    ProjectPathError,
)
from app.domain.services.project_paths import (
    check_project_path,
    is_within,
    real_roots,
    resolve_in_project,
)


def _mtime_ms(st: os.stat_result) -> int:
    return st.st_mtime_ns // 1_000_000


def _entry_type(mode: int) -> str:
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISREG(mode):
        return "file"
    return "other"


def _is_dir_nofollow(entry: os.DirEntry) -> bool:
    try:
        return entry.is_dir(follow_symlinks=False)
    except OSError:
        return False


def _sort_key(entry: os.DirEntry):
    return not _is_dir_nofollow(entry), entry.name.casefold(), entry.name


def _read_up_to(fd: int, size: int) -> bytes:
    chunks: List[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = os.read(fd, min(remaining, 64 * 1024))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _raise(path: str, reason: PathCheckReason, relative: Optional[str] = None) -> None:
    raise ProjectPathError(PathCheck(
        ok=False, path=path, relative=relative, reason=reason, message=PATH_CHECK_MESSAGES[reason],
    ))


def _fd_path(fd: int) -> Optional[str]:
    """打开后的文件实际路径（仅 Linux 的 /proc 可用），用于排除校验与打开之间路径被换成符号链接。"""
    try:
        return os.readlink(f"/proc/self/fd/{fd}")
    except OSError:
        return None


class LocalProjectFiles(ProjectFiles):
    """按层列出目录、读取文件、浏览根目录。每次调用都重新做路径校验。"""

    def __init__(
            self,
            roots: Sequence[str],
            ignored_names: AbstractSet[str] = DEFAULT_IGNORED_NAMES,
            entry_limit: int = TREE_ENTRY_LIMIT,
            max_file_bytes: int = FILE_READ_MAX_BYTES,
            sniff_bytes: int = BINARY_SNIFF_BYTES,
    ) -> None:
        self._roots = list(roots)
        self._ignored = frozenset(ignored_names)
        self._entry_limit = entry_limit
        self._max_file_bytes = max_file_bytes
        self._sniff_bytes = sniff_bytes

    async def list_directory(self, project_path: str, relative: str = "") -> ProjectListing:
        return await asyncio.to_thread(self.list_directory_sync, project_path, relative)

    async def read_file(self, project_path: str, relative: str) -> ProjectFile:
        return await asyncio.to_thread(self.read_file_sync, project_path, relative)

    async def browse(self, path: str) -> BrowseListing:
        return await asyncio.to_thread(self.browse_sync, path)

    def list_directory_sync(self, project_path: str, relative: str = "") -> ProjectListing:
        check = resolve_in_project(project_path, relative, self._roots, expect="directory")
        if not check.ok:
            raise ProjectPathError(check)
        project_real = os.path.realpath(project_path)
        dir_real = check.real_path
        dir_rel = check.relative or ""

        with os.scandir(dir_real) as it:
            items = [entry for entry in it if entry.name not in self._ignored]
        items.sort(key=_sort_key)
        entries = [self._entry(entry, dir_real, dir_rel, project_real) for entry in items[:self._entry_limit]]
        return ProjectListing(
            path=dir_rel,
            entries=entries,
            total=len(items),
            truncated=len(items) > self._entry_limit,
            limit=self._entry_limit,
        )

    @staticmethod
    def _entry(entry: os.DirEntry, dir_real: str, dir_rel: str, project_real: str) -> ProjectEntry:
        rel = posixpath.join(dir_rel, entry.name) if dir_rel else entry.name
        try:
            lst = entry.stat(follow_symlinks=False)
        except OSError:
            return ProjectEntry(name=entry.name, path=rel, type="other")

        if not stat.S_ISLNK(lst.st_mode):
            return ProjectEntry(
                name=entry.name,
                path=rel,
                type=_entry_type(lst.st_mode),
                size=lst.st_size if stat.S_ISREG(lst.st_mode) else None,
                modified_at=_mtime_ms(lst),
            )

        # 符号链接：指向项目外的只显示链接本身，不 stat 目标
        link_only = ProjectEntry(
            name=entry.name, path=rel, type="symlink", modified_at=_mtime_ms(lst), is_symlink=True,
        )
        target = os.path.realpath(os.path.join(dir_real, entry.name))
        if not is_within(target, project_real):
            return link_only.model_copy(update={"link": "outside"})
        try:
            st = os.stat(target)
        except OSError:
            return link_only.model_copy(update={"link": "broken"})
        return ProjectEntry(
            name=entry.name,
            path=rel,
            type=_entry_type(st.st_mode),
            size=st.st_size if stat.S_ISREG(st.st_mode) else None,
            modified_at=_mtime_ms(st),
            is_symlink=True,
            link="inside",
        )

    def read_file_sync(self, project_path: str, relative: str) -> ProjectFile:
        check = resolve_in_project(project_path, relative, self._roots, expect="file")
        if not check.ok:
            raise ProjectPathError(check)
        project_real = os.path.realpath(project_path)
        rel = check.relative or ""

        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            fd = os.open(check.real_path, flags)
        except FileNotFoundError:
            _raise(relative, PathCheckReason.NOT_FOUND, rel)
        except OSError as e:
            if e.errno == errno.ELOOP:
                # 校验之后最后一段被换成了符号链接
                _raise(relative, PathCheckReason.ESCAPES_PROJECT, rel)
            raise
        try:
            opened = _fd_path(fd)
            if opened is not None and not is_within(opened, project_real):
                _raise(relative, PathCheckReason.ESCAPES_PROJECT, rel)
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                _raise(relative, PathCheckReason.NOT_FILE, rel)

            meta = dict(path=rel, name=posixpath.basename(rel), size=st.st_size, modified_at=_mtime_ms(st),
                        max_bytes=self._max_file_bytes)
            if st.st_size > self._max_file_bytes:
                return ProjectFile(kind="too_large", **meta)
            head = _read_up_to(fd, min(self._sniff_bytes, self._max_file_bytes + 1))
            if b"\x00" in head:
                return ProjectFile(kind="binary", **meta)
            data = head + _read_up_to(fd, self._max_file_bytes + 1 - len(head))
            if len(data) > self._max_file_bytes:
                # 读取期间文件变大
                return ProjectFile(kind="too_large", **meta)
            return ProjectFile(kind="text", content=data.decode("utf-8", errors="replace"), **meta)
        finally:
            os.close(fd)

    def browse_sync(self, path: str) -> BrowseListing:
        """列出根目录内某一层的子目录（只列目录）。指向允许根目录之外的目录链接不列出。"""
        check = check_project_path(path, self._roots)
        if not check.ok:
            raise ProjectPathError(check)
        dir_real = check.real_path
        allowed = real_roots(self._roots)

        candidates: List[BrowseEntry] = []
        with os.scandir(dir_real) as it:
            for entry in it:
                if entry.name in self._ignored:
                    continue
                try:
                    is_link = entry.is_symlink()
                    if is_link:
                        target = os.path.realpath(os.path.join(dir_real, entry.name))
                        if not any(is_within(target, root) for root in allowed) or not os.path.isdir(target):
                            continue
                    elif not entry.is_dir(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                child = os.path.join(dir_real, entry.name)
                candidates.append(BrowseEntry(
                    name=entry.name,
                    path=child,
                    is_symlink=is_link,
                ))
        candidates.sort(key=lambda item: (item.name.casefold(), item.name))
        return BrowseListing(
            path=dir_real,
            root=check.root,
            parent=None if dir_real == check.root else os.path.dirname(dir_real),
            entries=candidates[:self._entry_limit],
            total=len(candidates),
            truncated=len(candidates) > self._entry_limit,
            limit=self._entry_limit,
        )
