"""写入保护：工作区文件夹的写入租约、文件变更记录与工作区归属的备份对象。

三张表都按工作区归属，不设外键：删除工作区时由清理流程显式回收，备份对象的字节同样由清理任务按位置删除。
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime
from ...domain.models.clock import utc_now
from ...domain.models.file_change import ChangeOperation, ChangeSource, FileChange, VersionStamp, WorkspaceObject
from ...domain.models.write_lease import LeaseState, WriteLease, WriterKind


class WriteLeaseModel(Base):
    __tablename__ = "write_leases"
    __table_args__ = (
        Index("uq_write_leases_workspace", "workspace_id", unique=True),
        Index("ix_write_leases_run", "owner_run_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_session_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    owner_run_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    operation: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    writer_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="core_tool")
    instance_id: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    holds: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    acquired_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, lease: WriteLease) -> "WriteLeaseModel":
        return cls(id=lease.id, workspace_id=lease.workspace_id, owner_session_id=lease.owner_session_id,
                   owner_run_id=lease.owner_run_id, operation=lease.operation, writer_kind=lease.writer_kind.value,
                   instance_id=lease.instance_id, state=lease.state.value, reason=lease.reason, holds=lease.holds,
                   acquired_at=lease.acquired_at, updated_at=lease.updated_at)

    def to_domain(self) -> WriteLease:
        return WriteLease(id=self.id, workspace_id=self.workspace_id, owner_session_id=self.owner_session_id,
                          owner_run_id=self.owner_run_id, operation=self.operation,
                          writer_kind=WriterKind(self.writer_kind), instance_id=self.instance_id,
                          state=LeaseState(self.state), reason=self.reason, holds=self.holds,
                          acquired_at=self.acquired_at, updated_at=self.updated_at)


class WorkspaceObjectModel(Base):
    __tablename__ = "workspace_objects"
    __table_args__ = (
        Index("uq_workspace_objects_hash", "workspace_id", "sha256", unique=True),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    def to_domain(self) -> WorkspaceObject:
        return WorkspaceObject(id=self.id, workspace_id=self.workspace_id, sha256=self.sha256, size=self.size,
                               key=self.key, created_at=self.created_at)


class FileChangeModel(Base):
    __tablename__ = "file_changes"
    __table_args__ = (
        Index("ix_file_changes_run", "workspace_id", "run_id"),
        Index("ix_file_changes_path", "workspace_id", "root_id", "relative_path"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    run_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    tool_call_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    root_id: Mapped[str] = mapped_column(String(128), nullable=False)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="tool")
    undo_of_run_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    before_object_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    after_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    after_mtime_ns: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    after_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=utc_now)

    @classmethod
    def from_domain(cls, change: FileChange) -> "FileChangeModel":
        after = change.after
        return cls(workspace_id=change.workspace_id, session_id=change.session_id, run_id=change.run_id,
                   tool_call_id=change.tool_call_id, root_id=change.root_id, relative_path=change.relative_path,
                   operation=change.operation.value, source=change.source.value, undo_of_run_id=change.undo_of_run_id,
                   before_object_id=change.before_object_id,
                   after_size=after.size if after else None, after_mtime_ns=after.modified_ns if after else None,
                   after_sha256=after.sha256 if after else None, created_at=change.created_at)

    def to_domain(self) -> FileChange:
        after = VersionStamp(size=self.after_size, modified_ns=self.after_mtime_ns, sha256=self.after_sha256) \
            if self.after_size is not None else None
        return FileChange(id=self.id, workspace_id=self.workspace_id, session_id=self.session_id, run_id=self.run_id,
                          tool_call_id=self.tool_call_id, root_id=self.root_id, relative_path=self.relative_path,
                          operation=ChangeOperation(self.operation), source=ChangeSource(self.source),
                          undo_of_run_id=self.undo_of_run_id, before_object_id=self.before_object_id, after=after,
                          created_at=self.created_at)
