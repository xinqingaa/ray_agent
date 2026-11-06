#!/usr/bin/env python
# -*- coding: utf-8 -*-
from typing import Optional

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.file import File
from app.domain.repositories.file_repository import FileRepository
from app.infrastructure.models import FileModel, RunModel


class DBFileRepository(FileRepository):
    """文件元数据仓库；字节由内容对象存储管理"""

    def __init__(self, db_session: AsyncSession) -> None:
        self.db_session = db_session

    async def save(self, file: File) -> None:
        record = await self.db_session.get(FileModel, file.id)
        if record is None:
            self.db_session.add(FileModel.from_domain(file))
        else:
            record.update_from_domain(file)
        await self.db_session.flush()

    async def get_by_id(self, file_id: str) -> Optional[File]:
        record = await self.db_session.get(FileModel, file_id, populate_existing=True)
        return record.to_domain() if record is not None else None

    async def expired_visual_files(self, now: float, limit: int = 100) -> list[File]:
        visual = FileModel.visual
        active_run = exists().where(RunModel.id == func.json_extract(visual, "$.run_id"),
                                    RunModel.status.in_(["running", "waiting"]))
        stmt = select(FileModel).where(
            func.json_extract(visual, "$.temporary") == 1,
            func.json_extract(visual, "$.expires_at") <= now,
            func.json_extract(visual, "$.deleted_at").is_(None),
            ~active_run,
        ).order_by(FileModel.created_at, FileModel.id).limit(limit)
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars()]

    async def bind_session(self, file_ids: list[str], session_id: str) -> None:
        if file_ids:
            await self.db_session.execute(
                update(FileModel).where(FileModel.id.in_(file_ids), FileModel.session_id.is_(None))
                .values(session_id=session_id).execution_options(synchronize_session=False))

    async def list_by_session(self, session_id: str) -> list[File]:
        stmt = select(FileModel).where(FileModel.session_id == session_id).order_by(FileModel.created_at)
        return [record.to_domain() for record in (await self.db_session.execute(stmt)).scalars()]

    async def list_all(self) -> list[File]:
        return [record.to_domain() for record in (await self.db_session.execute(select(FileModel))).scalars()]

    async def delete_all(self) -> None:
        await self.db_session.execute(delete(FileModel))
