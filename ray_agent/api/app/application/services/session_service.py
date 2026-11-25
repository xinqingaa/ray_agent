#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging
from dataclasses import dataclass, field
from typing import List, Callable, Optional, Type

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.builtin_skills.registry import BUILTIN_SKILLS
from app.domain.external.task import Task
from app.domain.models.event import Event
from app.domain.models.file import File
from app.domain.models.run import ACTIVE_RUN_STATUSES, Run
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
            previews=None,
            skills=None,
    ) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory
        self._task_cls = task_cls
        self._workdirs = workdirs
        self._jobs = jobs
        self._previews = previews
        self._skills = skills

    async def _validate_preset(self, preset_id: Optional[str]) -> Optional[bool]:
        """校验内置预设是否存在且启用；返回该预设默认的 participate_in_memory。"""
        if not preset_id:
            return None
        spec = BUILTIN_SKILLS.get(preset_id)
        if spec is None or spec.category != "preset" or spec.preset is None:
            raise BadRequestError(f"不支持的场景预设：{preset_id}")
        if self._skills is not None:
            state = await self._skills.session_preset_state(preset_id)
            if state is not None and not state["active"]:
                raise ConflictError(state.get("inactive_reason") or "该场景预设已停用，请在 Skill 设置中启用后再试")
        return spec.preset.default_participate_in_memory

    async def create_session(
            self,
            creation_id: str | None = None,
            workspace_id: str | None = None,
            active_preset_id: str | None = None,
    ) -> Session:
        """创建一个空白会话；带创建标识时重复请求返回同一会话。会话所属的工作区创建后不再改变，独立对话没有工作区。"""
        normalized_preset = (active_preset_id or "").strip() or None
        default_participate = await self._validate_preset(normalized_preset)
        # 独立对话不写入记忆；工作区会话默认按预设偏好决定是否参与（如情绪疏导默认不参与）
        participate = bool(workspace_id) and (True if default_participate is None else default_participate)
        session = Session(title=DEFAULT_SESSION_TITLE, workspace_id=workspace_id,
                          participate_in_memory=participate, active_preset_id=normalized_preset)
        if creation_id:
            session.id = creation_id
        async with self._uow_factory() as uow:
            if creation_id:
                existing = await uow.session.get_by_id(creation_id)
                if existing:
                    if existing.workspace_id != workspace_id:
                        raise ConflictError("该创建标识已用于另一个工作区的会话")
                    if normalized_preset is not None and existing.active_preset_id != normalized_preset:
                        raise ConflictError("该创建标识已用于另一个场景预设的会话")
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

    async def preset_state(self, preset_id: Optional[str]) -> Optional[dict]:
        """读取会话锁定场景预设的当前状态（是否有效及停用原因）。"""
        if not preset_id:
            return None
        if self._skills is not None:
            return await self._skills.session_preset_state(preset_id)
        spec = BUILTIN_SKILLS.get(preset_id)
        if spec is None or spec.category != "preset" or spec.preset is None:
            return {"id": preset_id, "title": preset_id, "icon": "sparkles", "active": False,
                    "inactive_reason": "该场景预设已不存在"}
        return {"id": spec.preset.id, "title": spec.preset.title, "icon": spec.preset.icon, "active": True,
                "inactive_reason": None}

    async def set_active_preset(self, session_id: str, preset_id: Optional[str]) -> Optional[dict]:
        """更新或退出会话当前锁定的场景预设。"""
        normalized = (preset_id or "").strip() or None
        await self._validate_preset(normalized)
        async with self._uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
            if not session:
                raise NotFoundError(f"当前会话不存在[{session_id}], 请核实后重试")
            await uow.session.update_active_preset(session_id, normalized)
        return await self.preset_state(normalized)

    async def page(self, *, offset: int = 0, limit: int = 50, workspace_id: str | None = None,
                   independent: bool = False):
        if workspace_id and independent:
            raise BadRequestError("workspace_id 与 independent 不能同时指定")
        async with self._read_uow_factory() as uow:
            return await uow.session.page(offset=offset, limit=limit, workspace_id=workspace_id,
                                          independent=independent)

    async def active_run_count(self) -> int:
        """活动运行数：库中 running／waiting 的运行，加上已受理但尚未登记为执行的启动。只读，供宿主退出前确认。"""
        from app.application.services.agent_service import pending_starts
        async with self._read_uow_factory() as uow:
            runs = [run for status in ACTIVE_RUN_STATUSES for run in await uow.run.list_by_status(status)]
        return len({run.id for run in runs} | set(pending_starts()))

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
        if getattr(self, "_previews", None) is not None:
            await self._previews.stop_by_session(session_id)
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
            await uow.preview.delete_by_session(session_id)
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
