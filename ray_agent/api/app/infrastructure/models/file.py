#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""文件元数据 ORM 模型。字节是数据根中的内容对象，key 为对象位置；session_id 是所属会话，删除会话时一并回收。"""
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, NullableJSON, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.file import File

_FIELDS = {"id", "filename", "filepath", "root_id", "relative_path", "key", "extension", "mime_type", "size", "sha256", "visual"}


class FileModel(Base):
    __tablename__ = "files"
    __table_args__ = (
        Index("ix_files_session", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(128), ForeignKey("sessions.id", ondelete="CASCADE"),
                                                      nullable=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False, default="")
    filepath: Mapped[str] = mapped_column(Text, nullable=False, default="")
    root_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    relative_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key: Mapped[str] = mapped_column(Text, nullable=False, default="")
    extension: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    visual: Mapped[Optional[dict]] = mapped_column(NullableJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now, onupdate=utc_now)

    @classmethod
    def from_domain(cls, file: File) -> "FileModel":
        return cls(**file.model_dump(mode="json", include=_FIELDS), session_id=file.session_id)

    def to_domain(self) -> File:
        return File.model_validate({field: getattr(self, field) for field in _FIELDS | {"session_id"}})

    def update_from_domain(self, file: File) -> None:
        for field, value in file.model_dump(mode="json", include=_FIELDS - {"id"}).items():
            setattr(self, field, value)
        if file.session_id is not None:
            self.session_id = file.session_id
