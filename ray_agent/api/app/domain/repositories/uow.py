#!/usr/bin/env python
# -*- coding: utf-8 -*-
from abc import ABC, abstractmethod
from typing import TypeVar

from .event_repository import EventRepository
from .file_repository import FileRepository
from .input_repository import AcceptedRequestRepository, RunInputRepository
from .job_repository import BackgroundJobRepository
from .root_repository import RootRepository
from .run_repository import RunRepository
from .session_repository import SessionRepository
from .skills import SkillTransaction

T = TypeVar("T", bound="IUnitOfWork")


class IUnitOfWork(ABC):
    """一个业务事务。写事务按进入顺序串行提交；只读事务读取一致快照，不能写入。"""
    skills: SkillTransaction
    file: FileRepository
    session: SessionRepository
    run: RunRepository
    event: EventRepository
    run_input: RunInputRepository
    request: AcceptedRequestRepository
    job: BackgroundJobRepository
    root: RootRepository

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
