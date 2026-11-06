#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""数据根中的内容对象。

字节先写入临时文件并计算摘要，改名发布后再由短事务登记元数据；登记失败只留下可辨认的孤立对象，不会出现有记录
却没有字节的文件。对象按文件身份存放，删除会话或清空数据时由清理任务按登记清单回收。
"""
import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import BinaryIO, Callable, Tuple

from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

from app.domain.external.file_storage import FileStorage
from app.domain.models.file import File
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)


class LocalFileStorage(FileStorage):

    def __init__(self, objects_dir: Path, tmp_dir: Path, uow_factory: Callable[[], IUnitOfWork]) -> None:
        self._root = Path(objects_dir)
        self._tmp = Path(tmp_dir)
        self._uow_factory = uow_factory

    def object_path(self, key: str) -> Path:
        root = self._root.resolve()
        path = (root / key).resolve()
        if not path.is_relative_to(root) or path == root:
            raise ValueError(f"非法的内容对象位置: {key}")
        return path

    def _publish(self, source: BinaryIO, key: str) -> Tuple[int, str]:
        self._tmp.mkdir(parents=True, exist_ok=True)
        target = self.object_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = self._tmp / f"{uuid.uuid4().hex}.part"
        digest, size = hashlib.sha256(), 0
        try:
            with partial.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(partial, target)
        finally:
            partial.unlink(missing_ok=True)
        return size, digest.hexdigest()

    async def upload_file(self, upload_file: UploadFile, *, visual: dict | None = None,
                          session_id: str | None = None) -> File:
        file_id = str(uuid.uuid4())
        filename = upload_file.filename or file_id
        _, extension = os.path.splitext(filename)
        key = f"{file_id[:2]}/{file_id}"
        owner = session_id or (visual or {}).get("session_id")
        file = File(id=file_id, filename=filename, key=key, extension=extension or "",
                    mime_type=upload_file.content_type or "", size=upload_file.size or 0,
                    sha256=(visual or {}).get("sha256"), visual=visual, session_id=owner)
        if visual:
            # 先登记归属，写入失败或被取消时到期回收仍能找到它。
            async with self._uow_factory() as uow:
                await uow.file.save(file)
        size, digest = await run_in_threadpool(self._publish, upload_file.file, key)
        file.size, file.sha256 = size, digest
        async with self._uow_factory() as uow:
            await uow.file.save(file)
        logger.info(f"文件已保存为内容对象: {filename} (ID: {file_id})")
        return file

    async def download_file(self, file_id: str) -> Tuple[BinaryIO, File]:
        async with self._uow_factory() as uow:
            file = await uow.file.get_by_id(file_id)
        if not file:
            raise ValueError(f"该文件不存在, 文件id: {file_id}")
        path = self.object_path(file.key)
        if not path.is_file():
            raise ValueError(f"内容对象不存在, 文件id: {file_id}")
        return path.open("rb"), file

    def get_file_url(self, file: File) -> str:
        return f"/api/files/{file.id}/download"

    async def delete_visual_file(self, file: File) -> None:
        if not file.visual or not file.visual.get('temporary'):
            raise ValueError('只能回收登记的临时视觉文件')
        await self.delete_file(file)

    async def delete_file(self, file: File) -> None:
        if not file.key:
            raise ValueError('缺少内容对象位置')
        await run_in_threadpool(self.remove_key, file.key)

    def remove_key(self, key: str) -> None:
        self.object_path(key).unlink(missing_ok=True)
