#!/usr/bin/env python
# -*- coding: utf-8 -*-
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    String,
    Integer,
    DateTime,
    Text,
    text,
    PrimaryKeyConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .project import ProjectModel
from ...domain.models.session import Session


class SessionModel(Base):
    """会话ORM模型"""
    __tablename__ = "sessions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_sessions_id"),
    )

    id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )  # 会话id
    sandbox_id: Mapped[str] = mapped_column(String(255), nullable=True)  # 沙箱id
    project_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey("projects.id", ondelete="RESTRICT"), nullable=True, index=True)
    project: Mapped[Optional[ProjectModel]] = relationship(lazy="joined")
    project_snapshot: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    task_id: Mapped[str] = mapped_column(String(255), nullable=True)  # 任务id
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        server_default=text("''::character varying"),
    )  # 会话标题
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    summary_state: Mapped[str] = mapped_column(String(16), nullable=False, default='idle', server_default='idle')
    summary_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary_generation: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')
    summary_source_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default='0')
    title_source: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'placeholder'"))
    unread_message_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )  # 未读消息数
    latest_message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("''::text"),
    )  # 最后一条消息
    latest_message_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=True,
    )  # 最后一条消息时间
    files: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    memories: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )  # 会话 Agent 的记忆
    status: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        server_default=text("''::character varying"),
    )  # 会话状态
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        onupdate=datetime.now,
        server_default=text("CURRENT_TIMESTAMP(0)"),
    )  # 更新时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(0)"),
    )  # 创建时间

    @classmethod
    def from_domain(cls, session: Session) -> "SessionModel":
        """从会话领域模型构建ORM模型"""
        return cls(
            # 1.基础字段: 使用BaseModel提供的python字典转换格式
            **session.model_dump(
                mode="python",
                exclude={"project", "project_snapshot", "memories", "files", "updated_at", "created_at"},
            ),
            # 2.复杂字段: 使用BaseModel提供的json字典转换格式
            **session.model_dump(
                mode="json",
                include={"project_snapshot", "memories", "files"},
            )
        )

    def to_domain(self) -> Session:
        """将会话ORM模型转换成领域模型"""
        return Session.model_validate(self, from_attributes=True)

    def update_from_domain(self, session: Session) -> None:
        """从传递的领域模型更新ORM数据"""
        # 1.基础字段: Python模式
        base_data = session.model_dump(
            mode="python",
            exclude={"project", "project_snapshot", "memories", "files", "updated_at", "created_at", "summary", "summary_source", "summary_state", "summary_error", "summary_generation", "summary_source_seq"},
        )

        # 2.复杂字段: JSON模式
        json_data = session.model_dump(
            mode="json",
            include={"project_snapshot", "memories", "files"},
        )

        # 3.合并更新
        for field, value in {**base_data, **json_data}.items():
            setattr(self, field, value)
