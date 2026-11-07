#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging
from dataclasses import dataclass, field
from typing import List, Callable, Optional, Type

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.domain.external.task import Task
from app.domain.models.event import Event
from app.domain.models.file import File
from app.domain.models.run import Run
from app.domain.models.run_input import RunInput
from app.domain.models.session import DEFAULT_SESSION_TITLE, Session
from app.domain.models.retrieval import SearchSourceType
from app.domain.models.workspace import WorkspaceStatus
from app.domain.repositories.uow import IUnitOfWork

logger = logging.getLogger(__name__)


@dataclass
class SessionDetail:
    session: Session
    runs: List[Run]
    events: List[Event]
    last_seq: int  # 会话当前最大 seq；分页读取时用于判断是否还有后续
    unconsumed_inputs: List[RunInput] = field(default_factory=list)  # 所属运行已结束、尚未进入模型历史的消息


class SessionService:
    """会话服务：创建时同事务登记会话工作目录根，删除时同事务登记回收清单并交给后台清理。"""

    def __init__(
            self,
            uow_factory: Callable[[], IUnitOfWork],
            read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None,
            task_cls: Optional[Type[Task]] = None,
            workdirs=None,
            jobs=None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory
        self._task_cls = task_cls
        self._workdirs = workdirs
        self._jobs = jobs

    async def create_session(self, creation_id: str | None = None, workspace_id: str | None = None) -> Session:
        """创建一个空白会话；带创建标识时重复请求返回同一会话。会话所属的工作区创建后不再改变，独立对话没有工作区。"""
        # 独立对话不写入记忆；工作区会话默认参与，之后可由用户按会话关闭
        session = Session(title=DEFAULT_SESSION_TITLE, workspace_id=workspace_id,
                          participate_in_memory=bool(workspace_id))
        if creation_id:
            session.id = creation_id
        async with self._uow_factory() as uow:
            if creation_id:
                existing = await uow.session.get_by_id(creation_id)
                if existing:
                    if existing.workspace_id != workspace_id:
                        raise ConflictError("该创建标识已用于另一个工作区的会话")
                    return existing
            if workspace_id:
                workspace = await uow.workspace.get(workspace_id)
                if workspace is None or workspace.status is WorkspaceStatus.DELETING:
                    raise NotFoundError("工作区不存在")
                if workspace.status is WorkspaceStatus.ARCHIVED:
                    raise ConflictError("工作区已归档，不能新建会话；取消归档后再试")
                session.instruction_version = workspace.instruction_version  # 创建时的版本提示；运行以背景清单为准
            await uow.session.save(session)
            if self._workdirs is not None:
                root, location = self._workdirs.new_root(session.id)
                await uow.root.add(root, location)
        logger.info(f"成功创建一个新任务会话: {session.id}")
        return session

    async def page(self, *, offset: int = 0, limit: int = 50, workspace_id: str | None = None,
                   independent: bool = False):
        if workspace_id and independent:
            raise BadRequestError("workspace_id 与 independent 不能同时指定")
        async with self._read_uow_factory() as uow:
            return await uow.session.page(offset=offset, limit=limit, workspace_id=workspace_id,
                                          independent=independent)

    async def clear_unread_message_count(self, session_id: str) -> None:
        """用户已查看会话，清空未查看的完成运行数"""
        async with self._uow_factory() as uow:
            await uow.session.update_unread_message_count(session_id, 0)

    async def delete_session(self, session_id: str) -> None:
        """删除会话记录，并在同一事务登记回收会话工作目录与内容对象的清理任务。正在执行的运行先取消。"""
        from app.application.services.background_jobs import cleanup_job
        async with self._uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
            if not session:
                raise NotFoundError(f"会话[{session_id}]不存在, 删除失败")
            active = await uow.run.get_active(session_id)
        task = self._task_cls.get(active.id) if active is not None and self._task_cls is not None else None
        if task is not None and not task.done:
            task.cancel()
        async with self._uow_factory() as uow:
            files = await uow.file.list_by_session(session_id)
            registered = await uow.root.session_workdir(session_id)
            summary = await uow.summary.get(session_id)
            if summary is not None:
                # 会话删除后它的摘要不再可检索；已写入记忆条目的来源在读取时标为不可用
                if summary.workspace_id:
                    await uow.search.remove(workspace_id=summary.workspace_id, source_type=SearchSourceType.SESSION_SUMMARY,
                                            source_id=session_id)
                await uow.summary.delete(session_id)
            await uow.session.delete_by_id(session_id)
            job = None
            if self._jobs is not None:
                job = await self._jobs.submit(uow, cleanup_job(
                    objects=[file.key for file in files if file.key],
                    directories=[registered[1]] if registered else [], session_id=session_id))
        if job is not None:
            self._jobs.wake()
        logger.info(f"删除会话[{session_id}]成功")

    async def get_session(self, session_id: str) -> Optional[Session]:
        async with self._read_uow_factory() as uow:
            return await uow.session.get_by_id(session_id)

    async def get_session_detail(
            self,
            session_id: str,
            after_seq: int = 0,
            limit: Optional[int] = None,
    ) -> Optional[SessionDetail]:
        """会话详情：会话行、全部运行、after_seq 之后按 seq 升序的事件（limit 为空时读到最新）与未消费的输入。"""
        async with self._read_uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
            if not session:
                return None
            runs = await uow.run.list_by_session(session_id)
            events = await uow.event.list(session_id, after_seq=after_seq, limit=limit)
            last_seq = await uow.event.max_seq(session_id)
            unconsumed = await uow.run_input.unconsumed(session_id)
        return SessionDetail(session=session, runs=runs, events=events, last_seq=last_seq,
                             unconsumed_inputs=unconsumed)

    async def get_session_files(self, session_id: str) -> List[File]:
        async with self._read_uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
        if not session:
            raise NotFoundError(f"当前会话不存在[{session_id}], 请核实后重试")
        return session.files
