"""写入保护：工作区写入租约、文件变更记录与工作区归属的备份对象。

Revision ID: 0003_write_protection
Revises: 0002_workspaces
Create Date: 2026-11-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.infrastructure.models.base import UTCDateTime

revision: str = "0003_write_protection"
down_revision: Union[str, Sequence[str], None] = "0002_workspaces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "write_leases",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("owner_session_id", sa.String(128), nullable=False),
        sa.Column("owner_run_id", sa.String(128), nullable=True),
        sa.Column("operation", sa.String(128), nullable=True),
        sa.Column("writer_kind", sa.String(16), nullable=False),
        sa.Column("instance_id", sa.String(128), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("holds", sa.Integer(), nullable=False),
        sa.Column("acquired_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("uq_write_leases_workspace", "write_leases", ["workspace_id"], unique=True)
    op.create_index("ix_write_leases_run", "write_leases", ["owner_run_id"])

    op.create_table(
        "workspace_objects",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("uq_workspace_objects_hash", "workspace_objects", ["workspace_id", "sha256"], unique=True)

    op.create_table(
        "file_changes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("run_id", sa.String(128), nullable=True),
        sa.Column("tool_call_id", sa.String(128), nullable=True),
        sa.Column("root_id", sa.String(128), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("undo_of_run_id", sa.String(128), nullable=True),
        sa.Column("before_object_id", sa.String(64), nullable=True),
        sa.Column("after_size", sa.BigInteger(), nullable=True),
        sa.Column("after_mtime_ns", sa.BigInteger(), nullable=True),
        sa.Column("after_sha256", sa.String(64), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_file_changes_run", "file_changes", ["workspace_id", "run_id"])
    op.create_index("ix_file_changes_path", "file_changes", ["workspace_id", "root_id", "relative_path"])


def downgrade() -> None:
    op.drop_index("ix_file_changes_path", "file_changes")
    op.drop_index("ix_file_changes_run", "file_changes")
    op.drop_table("file_changes")
    op.drop_index("uq_workspace_objects_hash", "workspace_objects")
    op.drop_table("workspace_objects")
    op.drop_index("ix_write_leases_run", "write_leases")
    op.drop_index("uq_write_leases_workspace", "write_leases")
    op.drop_table("write_leases")
