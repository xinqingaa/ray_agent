#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""业务库工作单元：写事务经写协调器串行进入，只读事务使用读连接池。提交成功后才发布目录通知。"""
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.repositories.uow import IUnitOfWork
from app.infrastructure.repositories.catalog_hints import take
from .db_event_repository import DBEventRepository
from .db_file_repository import DBFileRepository
from .db_input_repository import DBAcceptedRequestRepository, DBRunInputRepository
from .db_job_repository import DBBackgroundJobRepository
from .db_root_repository import DBRootRepository
from .db_run_repository import DBRunRepository
from .db_session_repository import DBSessionRepository
from .db_skill_repository import DBSkillTransaction

logger = logging.getLogger(__name__)


class DBUnitOfWork(IUnitOfWork):

    def __init__(self, database, *, readonly: bool = False):
        self.database = database
        self.readonly = readonly
        self.db_session: Optional[AsyncSession] = None

    async def commit(self):
        if self.readonly:
            return
        await self.db_session.commit()
        self._publish_catalog(take(self.db_session))

    @staticmethod
    def _publish_catalog(hints) -> None:
        if hints:
            from app.infrastructure.external.notification.local_notifier import catalog_notifier
            catalog_notifier().publish(hints)

    async def rollback(self):
        await self.db_session.rollback()
        take(self.db_session)

    async def __aenter__(self) -> "DBUnitOfWork":
        session = await (self.database.open_read() if self.readonly else self.database.open_write())
        self.db_session = session
        self.skills = DBSkillTransaction(session)
        self.file = DBFileRepository(db_session=session)
        self.session = DBSessionRepository(db_session=session)
        self.run = DBRunRepository(db_session=session)
        self.event = DBEventRepository(db_session=session)
        self.run_input = DBRunInputRepository(db_session=session)
        self.request = DBAcceptedRequestRepository(db_session=session)
        self.job = DBBackgroundJobRepository(db_session=session)
        self.root = DBRootRepository(db_session=session)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        session, self.db_session = self.db_session, None
        if session is None:
            return False
        if self.readonly:
            await self.database.close_read(session)
            return False
        hints = take(session) if exc_type is None else set()
        await self.database.close_write(session, commit=exc_type is None)
        self._publish_catalog(hints)
        return False
