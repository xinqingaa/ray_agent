#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Tuple, BinaryIO, Callable

from fastapi import UploadFile

from app.application.errors.exceptions import GoneError, NotFoundError
from app.domain.external.file_storage import FileStorage
from app.domain.models.file import File
from app.domain.repositories.uow import IUnitOfWork


class FileService:
    """附件与交付文件服务"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            file_storage: FileStorage,
    ) -> None:
        self.file_storage = file_storage
        self._uow_factory = uow_factory
        self._uow = uow_factory()

    async def upload_file(self, upload_file: UploadFile) -> File:
        """把上传的文件保存为内容对象并登记；随消息发送时归属该会话"""
        return await self.file_storage.upload_file(upload_file=upload_file)

    async def get_file_info(self, file_id: str) -> File:
        """根据传递的文件id获取文件信息"""
        async with self._uow:
            file = await self._uow.file.get_by_id(file_id)
        if not file:
            raise NotFoundError(f"该文件[{file_id}]不存在")
        return file

    async def download_file(self, file_id: str) -> Tuple[BinaryIO, File]:
        """根据传递的文件id下载文件"""
        file = await self.get_file_info(file_id)
        if file.visual and file.visual.get('deleted_at'):
            raise GoneError('临时图片已过期')
        return await self.file_storage.download_file(file_id)

    async def download_zip(self, file_ids: list[str]):
        import os
        import tempfile
        import zipfile
        from app.application.errors.exceptions import BadRequestError
        from app.domain.services.file_io import run_file_io
        ids = list(dict.fromkeys(file_ids))
        if not ids or len(ids) > 100:
            raise BadRequestError('每次打包 1–100 个文件')
        limit, total = 512 * 1024 * 1024, 0
        output = tempfile.TemporaryFile()
        names = set()
        try:
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for file_id in ids:
                    handle, file = await self.download_file(file_id)
                    try:
                        name = file.filename.replace('\\', '/').rsplit('/', 1)[-1]
                        name = ''.join(c for c in name if ord(c) >= 32).strip() or 'file'
                        if name in ('.', '..'):
                            name = 'file'
                        stem, extension = os.path.splitext(name)
                        candidate, suffix = name, 2
                        while candidate in names:
                            candidate = f'{stem} ({suffix}){extension}'; suffix += 1
                        names.add(candidate)
                        def write():
                            nonlocal total
                            with archive.open(candidate, 'w', force_zip64=True) as member:
                                while chunk := handle.read(256*1024):
                                    total += len(chunk)
                                    if total > limit:
                                        raise BadRequestError('打包文件总量过大')
                                    member.write(chunk)
                        _, cancelled = await run_file_io(write)
                        if cancelled:
                            import asyncio
                            raise asyncio.CancelledError()
                    finally:
                        handle.close()
            output.seek(0)
            return output
        except BaseException:
            output.close()
            raise
