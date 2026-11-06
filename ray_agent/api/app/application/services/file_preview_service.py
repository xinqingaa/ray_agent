"""附件预览协调，不调用模型、不准备执行环境。"""
from contextlib import asynccontextmanager

from app.application.errors.exceptions import ConflictError
from app.infrastructure.external.file_preview.parser import parse_preview


class FilePreviewService:
    def __init__(self, files):
        self.files = files

    @asynccontextmanager
    async def source(self, *, file_id):
        handle, file = await self.files.download_file(file_id)
        try:
            yield handle, file.filename, file.size, 'file:'+file.id
        finally:
            handle.close()

    async def preview(self, query, **source):
        async with self.source(**source) as (handle, filename, size, revision):
            if query.revision and query.revision != revision:
                raise ConflictError('文件已更新，请刷新')
            result = await parse_preview(handle, filename, revision, query)
            return {**result, 'size':size}
