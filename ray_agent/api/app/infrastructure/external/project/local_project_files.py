"""托管文件只读浏览；不跟随任何层级的符号链接。"""
import asyncio
import os
import stat
from app.domain.models.project import (ProjectEntry, ProjectListing, ProjectFile,
    TREE_ENTRY_LIMIT, FILE_READ_MAX_BYTES, PathCheckReason)
from app.domain.services.project_paths import normalize_relative, project_directory, path_error


class LocalProjectFiles:
    def __init__(self, *, entry_limit=TREE_ENTRY_LIMIT, max_file_bytes=FILE_READ_MAX_BYTES):
        self._entry_limit = entry_limit
        self._max_file_bytes = max_file_bytes

    async def list_directory(self, project_path, relative=''):
        return await asyncio.to_thread(self.list_directory_sync, project_path, relative)

    async def read_file(self, project_path, relative):
        return await asyncio.to_thread(self.read_file_sync, project_path, relative)

    def list_directory_sync(self, project_path, relative=''):
        try:
            with project_directory(project_path, relative) as fd:
                with os.scandir(fd) as entries:
                    result = []
                    for item in entries:
                        meta = item.stat(follow_symlinks=False)
                        kind = ('symlink' if stat.S_ISLNK(meta.st_mode) else 'directory' if stat.S_ISDIR(meta.st_mode)
                            else 'file' if stat.S_ISREG(meta.st_mode) else 'other')
                        result.append(ProjectEntry(name=item.name, path=f'{relative}/{item.name}' if relative else item.name,
                            type=kind, size=meta.st_size if kind == 'file' else None,
                            modified_at=meta.st_mtime_ns // 1000000, is_symlink=kind == 'symlink'))
            result.sort(key=lambda e: (e.type != 'directory', e.name.casefold(), e.name))
            return ProjectListing(path=relative, entries=result[:self._entry_limit], total=len(result),
                truncated=len(result) > self._entry_limit, limit=self._entry_limit)
        except OSError as exc:
            raise path_error(relative, PathCheckReason.ESCAPES_PROJECT if isinstance(exc, NotADirectoryError)
                else PathCheckReason.NOT_FOUND) from exc

    def read_file_sync(self, project_path, relative):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        try:
            with project_directory(project_path, parent) as parent_fd:
                meta = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                base = dict(path=path, name=name, size=meta.st_size, modified_at=meta.st_mtime_ns // 1000000,
                    max_bytes=self._max_file_bytes)
                if stat.S_ISLNK(meta.st_mode):
                    return ProjectFile(kind='symlink', content=os.readlink(name, dir_fd=parent_fd), **base)
                if not stat.S_ISREG(meta.st_mode):
                    return ProjectFile(kind='other', **base)
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
                try:
                    actual = os.fstat(fd)
                    if not stat.S_ISREG(actual.st_mode):
                        raise path_error(path, PathCheckReason.NOT_FILE)
                    base['size'] = actual.st_size
                    if actual.st_size > self._max_file_bytes:
                        return ProjectFile(kind='too_large', **base)
                    with os.fdopen(os.dup(fd), 'rb') as handle:
                        data = handle.read(self._max_file_bytes + 1)
                    if len(data) > self._max_file_bytes:
                        return ProjectFile(kind='too_large', **base)
                    if b'\x00' in data:
                        return ProjectFile(kind='binary', **base)
                    return ProjectFile(kind='text', content=data.decode('utf-8', errors='replace'), **base)
                finally:
                    os.close(fd)
        except OSError as exc:
            raise path_error(path, PathCheckReason.NOT_FOUND) from exc
