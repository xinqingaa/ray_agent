#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging
import os.path
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Callable, Tuple

from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

from app.domain.external.file_storage import FileStorage
from app.domain.models.file import File
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)


class LocalFileStorage(FileStorage):
    """基于本地磁盘的文件存储"""

    def __init__(
            self,
            root_dir: str,
            uow_factory: Callable[[], IUnitOfWork],
    ) -> None:
        """构造函数，完成本地目录与仓库初始化"""
        self._root = Path(root_dir)
        self._uow_factory = uow_factory
        self._uow = uow_factory()

    def _resolve_key_path(self, key: str) -> Path:
        """将存储key解析为根目录下的绝对路径，并拒绝目录穿越"""
        root = self._root.resolve()
        path = (root / key).resolve()
        if not path.is_relative_to(root):
            raise ValueError(f"非法的文件存储路径: {key}")
        return path

    async def upload_file(self, upload_file: UploadFile, *, visual: dict | None = None) -> File:
        """根据传递的文件源将文件写入本地磁盘"""
        try:
            file_id = str(uuid.uuid4())
            filename = upload_file.filename or file_id
            _, file_extension = os.path.splitext(filename)
            if not file_extension:
                file_extension = ""

            date_path = datetime.now().strftime("%Y/%m/%d")
            storage_key = f"{date_path}/{file_id}{file_extension}"
            dest = self._resolve_key_path(storage_key)
            dest.parent.mkdir(parents=True, exist_ok=True)

            if visual:
                # 先登记归属，上传取消或写入失败也能由到期回收处理。
                pending = File(id=file_id, filename=filename, key=storage_key, extension=file_extension,
                    mime_type=upload_file.content_type or '', size=upload_file.size or visual.get('size', 0),
                    sha256=visual.get('sha256'), visual=visual)
                async with self._uow_factory() as uow:
                    await uow.file.save(pending)

            def _write() -> int:
                with dest.open("wb") as output:
                    shutil.copyfileobj(upload_file.file, output)
                return dest.stat().st_size

            written_size = await run_in_threadpool(_write)
            logger.info(f"文件上传成功: {filename} (ID: {file_id})")

            file = File(
                visual=visual,
                sha256=visual.get("sha256") if visual else None,
                id=file_id,
                filename=filename,
                key=storage_key,
                extension=file_extension,
                mime_type=upload_file.content_type or "",
                size=upload_file.size or written_size,
            )
            async with self._uow:
                await self._uow.file.save(file)

            return file
        except Exception as e:
            logger.error(f"上传文件[{upload_file.filename}]失败: {str(e)}")
            raise

    async def download_file(self, file_id: str) -> Tuple[BinaryIO, File]:
        """根据文件id查询数据并打开本地文件"""
        try:
            async with self._uow:
                file = await self._uow.file.get_by_id(file_id)
            if not file:
                raise ValueError(f"该文件不存在, 文件id: {file_id}")

            path = self._resolve_key_path(file.key)
            if not path.is_file():
                raise ValueError(f"本地文件不存在, 文件id: {file_id}")

            return path.open("rb"), file
        except Exception as e:
            logger.error(f"下载文件[{file_id}]失败: {str(e)}")
            raise

    def get_file_url(self, file: File) -> str:
        """返回经 API 下载接口访问的相对地址"""
        return f"/api/files/{file.id}/download"

    async def delete_visual_file(self, file: File) -> None:
        if not file.visual or not file.visual.get('temporary'):
            raise ValueError('只能回收登记的临时视觉文件')
        await self.delete_file(file)

    async def delete_file(self, file: File) -> None:
        if not file.key:
            raise ValueError('缺少文件存储位置')
        await run_in_threadpool(self._resolve_key_path(file.key).unlink, missing_ok=True)
