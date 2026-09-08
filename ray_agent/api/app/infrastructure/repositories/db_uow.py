#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/06 15:44
@Author  : thezehui@gmail.com
@File    : db_uow.py
"""
import asyncio
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.domain.repositories.uow import IUnitOfWork
from .db_file_repository import DBFileRepository
from .db_session_repository import DBSessionRepository

logger = logging.getLogger(__name__)


class DBUnitOfWork(IUnitOfWork):
    """基于Postgres数据库的UoW实例"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        """构造函数，完成UoW类初始化"""
        self.session_factory = session_factory
        self.db_session: Optional[AsyncSession] = None

    async def commit(self):
        """提交数据库持久化"""
        await self.db_session.commit()

    async def rollback(self):
        """数据库回退操作"""
        await self.db_session.rollback()

    async def __aenter__(self) -> "DBUnitOfWork":
        """进入UoW操作上下文管理器的逻辑"""
        # 1.为每个上下文开启一个新的会话
        self.db_session = self.session_factory()

        # 2.初始化所有数据库仓库
        self.file = DBFileRepository(db_session=self.db_session)
        self.session = DBSessionRepository(db_session=self.db_session)

        return self

    def _schedule_close(self, session: AsyncSession) -> None:
        """在新的 asyncio Task 中归还连接。

        sse_starlette 的 anyio cancel scope 会取消当前 Task 里尚未结束的 await，
        asyncio.shield 挡不住。连接必须在另一个 Task 里 close，否则会留在
        checked-out 状态，随后被 GC terminate 并打出 CancelledError。
        """
        self.db_session = None
        try:
            asyncio.get_running_loop().create_task(self._aclose_session(session))
        except RuntimeError:
            self._release_session_sync(session)

    @staticmethod
    async def _aclose_session(session: AsyncSession) -> None:
        """后台回滚并关闭会话，把连接还回池子。"""
        try:
            if session.in_transaction():
                await session.rollback()
        except Exception as e:
            logger.warning(f"UoW后台回滚失败: {e}")
        try:
            await session.close()
        except Exception as e:
            logger.warning(f"UoW后台关闭数据库会话失败: {e}")

    @staticmethod
    def _release_session_sync(session: AsyncSession) -> None:
        """事件循环已关闭时，同步归还连接，避免 GC 再 terminate。"""
        sync_session = session.sync_session
        try:
            if sync_session.in_transaction():
                sync_session.rollback()
        except Exception:
            pass
        try:
            sync_session.close()
        except Exception as e:
            logger.warning(f"UoW同步释放数据库会话失败: {e}")

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """退出上下文：正常则提交并关闭；取消则转到后台归还连接。

        前端收到 done 后会立刻中止 SSE，sse_starlette 随之取消当前请求 Task。
        此处若直接 await close，会被一并取消，连接无法 check-in。
        """
        session = self.db_session
        if session is None:
            return False
        try:
            if exc_type:
                await session.rollback()
            else:
                await session.commit()
            await session.close()
            self.db_session = None
        except asyncio.CancelledError:
            logger.warning("UoW提交/关闭被取消，已转到后台归还连接")
            self._schedule_close(session)
            raise
        except Exception as e:
            logger.warning(f"UoW提交/回滚/关闭失败: {e}")
            self._schedule_close(session)
        return False
