#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.file import File
from app.domain.repositories.file_repository import FileRepository
from app.infrastructure.models import FileModel
from app.infrastructure.models.run import RunModel
from app.infrastructure.models.data_cleanup import DataCleanupModel
from app.application.errors.exceptions import ConflictError


class DBFileRepository(FileRepository):
    """基于数据库的文件数据仓库"""

    def __init__(self, db_session: AsyncSession) -> None:
        """构造函数，完成数据仓库初始化"""
        self.db_session = db_session

    async def save(self, file: File) -> None:
        """根据传递的文件模型存储or更新数据"""
        # 清理清单也是删除标识，防止迟到的视觉到期回调重新插入已删除附件。
        removed = await self.db_session.scalar(select(DataCleanupModel.id).where(
            DataCleanupModel.manifest['file_ids'].contains([file.id])).limit(1))
        if removed:
            raise ConflictError('附件正在清理或已删除')
        # 1.根据id查询记录是否存在
        stmt = select(FileModel).where(FileModel.id == file.id)
        result = await self.db_session.execute(stmt)
        record = result.scalar_one_or_none()

        # 2.判断如果文件不存在则新建文件
        if not record:
            record = FileModel.from_domain(file)
            self.db_session.add(record)
            return

        # 3.文件存在则直接更新文件
        record.update_from_domain(file)

    async def get_by_id(self, file_id: str) -> Optional[File]:
        """根据传递的文件id获取文件信息"""
        # 1.根据id查询记录是否存在
        stmt = select(FileModel).where(FileModel.id == file_id)
        result = await self.db_session.execute(stmt)
        record = result.scalar_one_or_none()

        # 2.判断文件记录是否存在返回不同的值
        return record.to_domain() if record is not None else None

    async def expired_visual_files(self, now: float, limit: int = 100) -> list[File]:
        stmt = select(FileModel).where(
            FileModel.visual['temporary'].as_boolean() == True,
            FileModel.visual['expires_at'].as_float() <= now,
            FileModel.visual['deleted_at'].as_float().is_(None),
            ~select(RunModel.id).where(RunModel.id == FileModel.visual['run_id'].as_string(),
                                      RunModel.status.in_(['running', 'waiting'])).exists(),
        ).order_by(FileModel.created_at, FileModel.id).limit(limit)
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars()]
