"""附件与项目当前文件的预览协调，不调用模型、不准备沙箱。"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.models.project import ProjectPathError
from app.infrastructure.external.file_preview.parser import parse_preview
from app.infrastructure.external.project.file_io import ProjectFileIO


class FilePreviewService:
    def __init__(self, files, projects):
        self.files, self.projects = files, projects

    @asynccontextmanager
    async def source(self, *, file_id=None, identifier=None, path=None, project_level=False):
        if file_id:
            handle, file = await self.files.download_file(file_id)
            try:
                yield handle, file.filename, file.size, 'file:'+file.id
            finally:
                handle.close()
        else:
            root = await self.projects.require_file_root(identifier, project_level=project_level)
            try:
                with ProjectFileIO(root).open_regular(path) as handle:
                    stat = os.fstat(handle.fileno())
                    revision = f'project:{identifier}:{path}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'
                    yield handle, Path(path).name, stat.st_size, revision
                    if os.fstat(handle.fileno()).st_mtime_ns != stat.st_mtime_ns:
                        raise ConflictError('文件已更新，请刷新')
            except FileNotFoundError as exc:
                raise NotFoundError('文件不存在') from exc
            except ProjectPathError as exc:
                raise BadRequestError(exc.check.message or '路径不可用') from exc
            except (OSError, ValueError) as exc:
                raise BadRequestError('文件不可读取') from exc

    async def preview(self, query, **source):
        async with self.source(**source) as (handle, filename, size, revision):
            if query.revision and query.revision != revision:
                raise ConflictError('文件已更新，请刷新')
            result = await parse_preview(handle, filename, revision, query)
            return {**result, 'size':size}
