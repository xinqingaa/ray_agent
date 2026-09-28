#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/06 15:41
@Author  : thezehui@gmail.com
@File    : uow.py
"""
from abc import ABC, abstractmethod
from typing import TypeVar

from .event_repository import EventRepository
from .file_repository import FileRepository
from .run_repository import RunRepository
from .session_repository import SessionRepository

T = TypeVar("T", bound="IUnitOfWork")


class IUnitOfWork(ABC):
    """Uow模式协议接口"""
    file: FileRepository
    session: SessionRepository
    run: RunRepository
    event: EventRepository

    @abstractmethod
    async def commit(self):
        """提交数据库数据持久化"""
        ...

    @abstractmethod
    async def rollback(self):
        """数据库回滚"""
        ...

    @abstractmethod
    async def __aenter__(self: T) -> T:
        """进入上下文管理器"""
        ...

    @abstractmethod
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """退出上下文管理器"""
        ...
