#!/usr/bin/env python
# -*- coding: utf-8 -*-
import hashlib
from typing import Tuple, BinaryIO, Callable

from fastapi import UploadFile

from app.application.errors.exceptions import AppException, NotFoundError
from app.domain.external.file_storage import FileStorage
from app.domain.models.file import File
from app.domain.repositories.uow import IUnitOfWork


class FileService:
    """MoocManus文件系统服务"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            file_storage: FileStorage,
            project_files=None,
    ) -> None:
        """构造函数，完成文件服务的初始化"""
        self.file_storage = file_storage
        self.project_files = project_files
        self._uow_factory = uow_factory
        self._uow = uow_factory()

    async def upload_file(self, upload_file: UploadFile, *, project_id=None, rule_version=None, include_optional=False) -> File:
        """将传递的文件上传到文件存储并记录上传数据"""
        if not project_id:
            return await self.file_storage.upload_file(upload_file=upload_file)
        from app.application.errors.exceptions import BadRequestError
        from app.domain.services.project_upload_rules import classify
        from app.domain.services.project_paths import normalize_relative
        from app.domain.services.project_file_coordinator import run_file_io
        await self.project_files.get(project_id)
        rule = self.project_files.upload_rules()
        name = normalize_relative(upload_file.filename)
        if not name or '/' in name:
            raise BadRequestError('附件名称必须是单一文件名')
        decision = classify(name, {name}, rule)
        if rule_version != rule['version']:
            raise BadRequestError('上传规则已变化，请重新确认')
        if decision['policy'] == 'always' or (decision['policy'] == 'optional' and not include_optional):
            raise BadRequestError('附件属于排除项；可选项须明确确认')
        def inspect():
            digest, size = hashlib.sha256(), 0
            upload_file.file.seek(0)
            try:
                while chunk := upload_file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > rule['max_file_bytes']:
                        raise BadRequestError('附件超过单文件上限')
                    digest.update(chunk)
                return digest.hexdigest(), size
            finally:
                upload_file.file.seek(0)
        (digest, size), cancelled = await run_file_io(inspect)
        if cancelled:
            import asyncio
            raise asyncio.CancelledError()
        upload_file.size = size
        file = await self.file_storage.upload_file(upload_file=upload_file)
        file.sha256, file.size = digest, size
        file.project_upload = {'project_id': project_id, 'rule_version': rule_version, 'include_optional': include_optional}
        async with self._uow_factory() as uow:
            await uow.file.save(file)
        return file

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
            raise AppException(code=410, status_code=410, msg='临时图片已过期')
        return await self.file_storage.download_file(file_id)
