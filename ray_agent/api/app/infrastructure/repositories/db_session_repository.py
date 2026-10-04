#!/usr/bin/env python
# -*- coding: utf-8 -*-
from datetime import datetime
from typing import List, Optional

from sqlalchemy import select, delete, update, func, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models.file import File
from app.domain.models.memory import Memory
from app.domain.models.session import Session, SessionStatus
from app.domain.repositories.session_repository import SessionRepository
from app.infrastructure.models import SessionModel


class DBSessionRepository(SessionRepository):
    """基于Postgres数据库的会话仓库"""

    def __init__(self, db_session: AsyncSession) -> None:
        """构造函数，完成数据仓库的初始化"""
        self.db_session = db_session

    async def save(self, session: Session) -> None:
        """根据传递的领域模型更新或者新增会话"""
        # 1.根据id查询会话是否存在
        stmt = select(SessionModel).where(SessionModel.id == session.id)
        result = await self.db_session.execute(stmt)
        record = result.scalar_one_or_none()

        # 2.如果会话不存在则新建会话
        if not record:
            record = SessionModel.from_domain(session)
            self.db_session.add(record)
            await self.db_session.flush()
            return

        # 3.会话存在则更新会话
        record.update_from_domain(session)

    async def get_all(self) -> List[Session]:
        """获取所有会话列表"""
        # 1.构建sql查询所有记录
        stmt = select(SessionModel).order_by(SessionModel.latest_message_at.desc())
        result = await self.db_session.execute(stmt)
        records = result.scalars().all()

        # 2.将数据循环遍历成Session
        return [record.to_domain() for record in records]

    async def get_by_id(self, session_id: str) -> Optional[Session]:
        """根据id查询会话"""
        # 1.根据id查询会话是否存在
        stmt = select(SessionModel).where(SessionModel.id == session_id)
        result = await self.db_session.execute(stmt)
        record = result.scalar_one_or_none()

        # 2.判断会话记录是否存在并返回
        return record.to_domain() if record is not None else None

    async def delete_by_id(self, session_id: str) -> None:
        """根据传递的id删除会话"""
        # 1.构建删除语句
        stmt = delete(SessionModel).where(SessionModel.id == session_id)

        # 2.执行sql无需检查是否删除
        await self.db_session.execute(stmt)

    async def update_title(self, session_id: str, title: str) -> None:
        """更新会话标题"""
        # 1.构建更新语句并执行
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(title=title)
        )
        result = await self.db_session.execute(stmt)

        # 2.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def set_title(self, session_id: str, title: str, source: str, expected_source: Optional[str] = None) -> bool:
        stmt = update(SessionModel).where(SessionModel.id == session_id)
        if expected_source is not None:
            stmt = stmt.where(SessionModel.title_source == expected_source)
        result = await self.db_session.execute(stmt.values(title=title, title_source=source))
        return result.rowcount > 0

    async def update_sandbox_id(self, session_id: str, sandbox_id: str) -> None:
        await self.db_session.execute(update(SessionModel).where(SessionModel.id == session_id).values(sandbox_id=sandbox_id))

    async def lock(self, session_id: str) -> Optional[Session]:
        stmt = select(SessionModel).where(SessionModel.id == session_id).with_for_update(of=SessionModel).execution_options(populate_existing=True)
        record = (await self.db_session.execute(stmt)).scalar_one_or_none()
        return record.to_domain() if record else None

    async def set_project_id(self, session_id: str, project_id: Optional[str]) -> None:
        result = await self.db_session.execute(update(SessionModel).where(SessionModel.id == session_id).values(project_id=project_id))
        if result.rowcount == 0:
            raise ValueError("会话不存在")

    async def save_project_snapshot(self, session_id: str, snapshot: dict) -> None:
        await self.db_session.execute(update(SessionModel).where(SessionModel.id == session_id).values(project_snapshot=snapshot))

    async def page(self, *, project_id: Optional[str] = None, independent: bool = False, offset: int = 0, limit: int = 50) -> tuple[List[Session], int]:
        filters = []
        if project_id is not None:
            filters.append(SessionModel.project_id == project_id)
        elif independent:
            filters.append(SessionModel.project_id.is_(None))
        total = (await self.db_session.execute(select(func.count()).select_from(SessionModel).where(*filters))).scalar_one()
        stmt = select(SessionModel).where(*filters).order_by(SessionModel.latest_message_at.desc().nullslast(), SessionModel.created_at.desc(), SessionModel.id).offset(offset).limit(limit)
        records = (await self.db_session.execute(stmt)).scalars().all()
        return [record.to_domain() for record in records], total

    async def project_counts(self, project_ids: List[str]) -> dict[str, int]:
        if not project_ids:
            return {}
        stmt = select(SessionModel.project_id, func.count()).where(SessionModel.project_id.in_(project_ids)).group_by(SessionModel.project_id)
        return dict((await self.db_session.execute(stmt)).all())

    async def update_task_id(self, session_id: str, task_id: str) -> None:
        await self.db_session.execute(update(SessionModel).where(SessionModel.id == session_id).values(task_id=task_id))

    async def update_latest_message(self, session_id: str, message: str, timestamp: datetime) -> None:
        """更新会话最新消息"""
        # 1.构建更新语句并执行
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(
                latest_message=message,
                latest_message_at=timestamp,
            )
        )
        result = await self.db_session.execute(stmt)

        # 2.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def add_file(self, session_id: str, file: File) -> None:
        """往会话中新增文件"""
        # 1.将file序列化为json
        file_data = file.model_dump(mode="json")

        # 2.构建原子更新语句并执行
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(
                files=func.coalesce(SessionModel.files, cast([], JSONB)) + cast([file_data], JSONB),
            )
        )
        result = await self.db_session.execute(stmt)

        # 3.检查是否新增成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def remove_file(self, session_id: str, file_id: str) -> None:
        """移除会话中的指定文件"""
        # 1.查询会话记录并加锁
        stmt = select(SessionModel).where(SessionModel.id == session_id).with_for_update(of=SessionModel)
        result = await self.db_session.execute(stmt)
        record = result.scalar_one_or_none()

        # 2.检查会话记录是否存在
        if not record:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

        # 3.会话记录存在在，则在内存中过滤files
        if not record.files:
            return
        original_length = len(record.files)
        new_files = [file for file in record.files if file.get("id") != file_id]

        # 4.判断文件长度是否有变化
        if len(new_files) == original_length:
            return

        # 5.更新数据
        record.files = new_files
        # 会话工厂关闭了 autoflush；先刷新 ORM 修改，供同一事务后续 add_file 使用。
        await self.db_session.flush()

    async def get_file_by_path(self, session_id: str, filepath: str) -> Optional[File]:
        """根据文件路径获取文件信息"""
        # 1.构建语句查询文件列表
        stmt = select(SessionModel.files).where(SessionModel.id == session_id)
        result = await self.db_session.execute(stmt)
        files = result.scalar_one_or_none()

        # 2.判断是否为空，如果不存在则返回None
        if not files:
            return None

        # 3.遍历查找数据，如果最后没找到则返回空
        for file in files:
            if file.get("filepath", "") == filepath:
                return File(**file)

        return None

    async def update_status(self, session_id: str, status: SessionStatus) -> None:
        """更新会话状态"""
        # 1.构建更新语句并执行
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(status=status.value)
        )
        result = await self.db_session.execute(stmt)

        # 2.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def update_unread_message_count(self, session_id: str, count: int) -> None:
        """更新会话的未读消息数"""
        # 1.构建更新语句并执行
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(unread_message_count=count)
        )
        result = await self.db_session.execute(stmt)

        # 2.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def increment_unread_message_count(self, session_id: str) -> None:
        """新增会话的未读消息数"""
        # 1.构建新增未读消息数语句并更新
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(
                unread_message_count=func.coalesce(SessionModel.unread_message_count, 0) + 1,
            )
        )
        result = await self.db_session.execute(stmt)

        # 2.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def decrement_unread_message_count(self, session_id: str) -> None:
        """将会话中的未读消息数-1"""
        # 1.构建新增未读消息数语句并更新
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(
                # 2.核心逻辑：GREATEST((当前值-1), 0)避免出现负数
                unread_message_count=func.greatest(
                    func.coalesce(SessionModel.unread_message_count, 0) - 1,
                    0
                )
            )
        )
        result = await self.db_session.execute(stmt)

        # 3.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def save_memory(self, session_id: str, agent_name: str, memory: Memory) -> None:
        """存储或者更新会话中的记忆(字典直接覆盖)"""
        # 1.将memory转换成为json结构
        memory_data = memory.model_dump(mode="json")

        # 2.构建要打补丁的字典
        patch_data = {agent_name: memory_data}

        # 3.执行合并更新
        stmt = (
            update(SessionModel)
            .where(SessionModel.id == session_id)
            .values(
                memories=func.coalesce(SessionModel.memories, cast({}, JSONB)) + cast(patch_data, JSONB),
            )
        )
        result = await self.db_session.execute(stmt)

        # 4.检查是否更新成功
        if result.rowcount == 0:
            raise ValueError(f"会话[{session_id}]不存在，请核实后重试")

    async def get_memory(self, session_id: str, agent_name: str) -> Memory:
        """获取指定会话的agent记忆信息"""
        # 1.查询会话记忆信息
        stmt = (
            select(SessionModel.memories[agent_name])
            .where(SessionModel.id == session_id)
        )
        result = await self.db_session.execute(stmt)
        memory_data = result.scalar_one_or_none()

        # 2.如果存在记忆则直接返回
        if memory_data:
            return Memory(**memory_data)

        # 3.如果记忆不存在，则构建一个空记忆后返回
        return Memory(messages=[])


    async def recent_summaries(self, project_id, exclude_session_id):
        from app.infrastructure.models.event import EventModel
        latest = select(func.max(EventModel.seq)).where(EventModel.session_id == SessionModel.id,
            EventModel.type.in_(['message', 'run'])).correlate(SessionModel).scalar_subquery()
        stmt = select(SessionModel, latest.label('latest_seq')).where(SessionModel.project_id == project_id,
            SessionModel.id != exclude_session_id, SessionModel.summary.is_not(None), SessionModel.summary != '').order_by(
                SessionModel.latest_message_at.desc().nullslast(), SessionModel.updated_at.desc(), SessionModel.id).limit(10)
        return [{'session_id':s.id,'title':s.title,'summary':s.summary,'source':s.summary_source,
            'source_seq':s.summary_source_seq,'generation':s.summary_generation,'state':s.summary_state,
            'error':s.summary_error,'latest_seq':seq or 0,'stale':(seq or 0) > s.summary_source_seq,
            'latest_message_at':s.latest_message_at.isoformat() if s.latest_message_at else None}
            for s, seq in (await self.db_session.execute(stmt)).all()]

    async def summary_material(self, session_id):
        from app.infrastructure.models.event import EventModel
        from app.infrastructure.models.run import RunModel
        from app.domain.services.summary_material import bound_material
        users = select(EventModel).where(EventModel.session_id == session_id,
            EventModel.type == 'message', EventModel.payload['role'].astext == 'user')
        first = (await self.db_session.execute(users.order_by(EventModel.seq).limit(1))).scalar_one_or_none()
        recent = (await self.db_session.execute(users.order_by(EventModel.seq.desc()).limit(12))).scalars().all()
        finals_query = select(EventModel).join(RunModel, RunModel.id == EventModel.run_id).where(
            EventModel.session_id == session_id, EventModel.type == 'message',
            EventModel.payload['role'].astext == 'assistant', RunModel.status == 'completed').distinct(
            EventModel.run_id).order_by(EventModel.run_id, EventModel.seq.desc()).subquery()
        from sqlalchemy.orm import aliased
        final = aliased(EventModel, finals_query)
        finals = (await self.db_session.execute(select(final).order_by(final.seq.desc()).limit(12))).scalars().all()
        runs = (await self.db_session.execute(select(RunModel).where(RunModel.session_id == session_id,
            RunModel.status.in_(['completed', 'failed', 'cancelled', 'interrupted'])).order_by(
            RunModel.started_at.desc()).limit(12))).scalars().all()
        material = bound_material(first, recent, finals, runs)
        cutoff = (await self.db_session.execute(select(func.max(EventModel.seq)).where(EventModel.session_id == session_id, EventModel.type.in_(['message', 'run'])))).scalar()
        material['source_seq'] = max(material['source_seq'], cutoff or 0)
        return material

    async def set_summary_fields(self, session_id, **values):
        await self.db_session.execute(update(SessionModel).where(SessionModel.id == session_id).values(**values))


    async def interrupt_summaries(self, project_id):
        await self.db_session.execute(update(SessionModel).where(SessionModel.project_id == project_id,
            SessionModel.summary_state == 'generating').values(summary_state='failed',
                summary_error='服务重启中断了摘要请求，请重新生成',
                summary_generation=SessionModel.summary_generation + 1))

    async def lock_creation(self, key):
        from sqlalchemy import text
        await self.db_session.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': key})
