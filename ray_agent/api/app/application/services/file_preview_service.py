"""附件与工作区文件的预览协调，不调用模型、不准备执行环境。"""
import hashlib
from contextlib import asynccontextmanager

from app.application.errors.exceptions import BadRequestError, ConflictError
from app.application.errors.workspace_files import app_error
from app.domain.external.workspace_files import FileKind, WorkspaceFileError
from app.domain.models.identity import RootedPath
from app.infrastructure.external.file_preview.parser import parse_preview


class FilePreviewService:
    def __init__(self, files, roots=None):
        self.files = files
        self.roots = roots  # WorkspaceFiles：按 root_id 加相对路径读取工作区文件

    @asynccontextmanager
    async def source(self, *, file_id=None, root_id=None, relative_path=None):
        if root_id is None:
            handle, file = await self.files.download_file(file_id)
            try:
                yield handle, file.filename, file.size, 'file:'+file.id
            finally:
                handle.close()
            return
        try:
            path = RootedPath(root_id=root_id, relative_path=relative_path or '')
            entry = await self.roots.stat(path)
            if entry.kind is not FileKind.FILE:
                raise BadRequestError('目标不是普通文件')
            handle = await self.roots.open_reader(path, entry.version)
        except ValueError as error:
            raise BadRequestError(f'路径无效：{error}')
        except WorkspaceFileError as error:
            raise app_error(error)
        try:
            version = entry.version
            # 版本标识含根、路径与 inode：不同工作区的同名同大小同修改时间文件、或被换成另一个文件，都不会共用缓存
            identity = f'{root_id}\0{entry.path.relative_path}\0{entry.inode}\0{version.size}\0{version.modified_ns}'
            yield handle, entry.name, version.size, 'root:' + hashlib.sha256(identity.encode()).hexdigest()[:32]
        finally:
            handle.close()

    async def preview(self, query, **source):
        async with self.source(**source) as (handle, filename, size, revision):
            if query.revision and query.revision != revision:
                raise ConflictError('文件已更新，请刷新')
            result = await parse_preview(handle, filename, revision, query)
            return {**result, 'size':size}
