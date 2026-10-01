"""托管文件只读浏览；不跟随任何层级的符号链接。"""
import asyncio
import os
from app.domain.models.project import (ProjectEntry, ProjectListing, ProjectFile,
    TREE_ENTRY_LIMIT, FILE_READ_MAX_BYTES, PathCheckReason)
from app.infrastructure.external.project.file_io import ProjectFileIO
from app.domain.services.project_paths import normalize_relative, path_error


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
            store = ProjectFileIO(project_path)
            path = normalize_relative(relative)
            if path is None:
                raise path_error(relative)
            result = [ProjectEntry(name=entry.path.rsplit('/', 1)[-1], path=entry.path,
                type=entry.type, size=entry.size if entry.type == 'file' else None,
                modified_at=entry.mtime_ns // 1000000, is_symlink=entry.type == 'symlink')
                for entry in store.children(path)]
            result.sort(key=lambda e: (e.type != 'directory', e.name.casefold(), e.name))
            return ProjectListing(path=path, entries=result[:self._entry_limit], total=len(result),
                truncated=len(result) > self._entry_limit, limit=self._entry_limit)
        except OSError as exc:
            raise path_error(relative, PathCheckReason.ESCAPES_PROJECT if isinstance(exc, NotADirectoryError)
                else PathCheckReason.NOT_FOUND) from exc

    def read_file_sync(self, project_path, relative):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        try:
            store = ProjectFileIO(project_path)
            entry = store.inspect(path)
            base = dict(path=path, name=path.rsplit('/', 1)[-1], size=entry.size,
                modified_at=entry.mtime_ns // 1000000, max_bytes=self._max_file_bytes)
            if entry.type == 'symlink':
                return ProjectFile(kind='symlink', content=entry.target, **base)
            if entry.type != 'file':
                return ProjectFile(kind='other', **base)
            with store.open_regular(path) as handle:
                actual = os.fstat(handle.fileno())
                base['size'] = actual.st_size
                base['modified_at'] = actual.st_mtime_ns // 1000000
                if actual.st_size > self._max_file_bytes:
                    return ProjectFile(kind='too_large', **base)
                data = handle.read(self._max_file_bytes + 1)
            if len(data) > self._max_file_bytes:
                return ProjectFile(kind='too_large', **base)
            if b'\x00' in data:
                return ProjectFile(kind='binary', **base)
            return ProjectFile(kind='text', content=data.decode('utf-8', errors='replace'), **base)
        except OSError as exc:
            raise path_error(path, PathCheckReason.NOT_FOUND) from exc
