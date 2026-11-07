"""文件夹工作区：工作区表、会话归属、工作区文件夹根的文件系统身份与可用状态、文件的来源位置。

Revision ID: 0002_workspaces
Revises: 0001_baseline
Create Date: 2026-11-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.infrastructure.models.base import UTCDateTime

revision: str = "0002_workspaces"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("folder_root_id", sa.String(128), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )

    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(128), nullable=True))
    op.create_index("ix_sessions_workspace", "sessions", ["workspace_id"])

    with op.batch_alter_table("roots") as batch:
        batch.add_column(sa.Column("fs_dev", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("fs_ino", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("folder_status", sa.String(16), nullable=False, server_default="available"))
        batch.add_column(sa.Column("marker_writable", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("checked_at", UTCDateTime(), nullable=True))
    op.create_index("uq_roots_workspace_folder", "roots", ["workspace_id"], unique=True,
                    sqlite_where=sa.text("kind = 'workspace_folder'"))
    op.create_index("ix_roots_identity", "roots", ["fs_dev", "fs_ino"])

    with op.batch_alter_table("files") as batch:
        batch.add_column(sa.Column("root_id", sa.String(128), nullable=True))
        batch.add_column(sa.Column("relative_path", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("relative_path")
        batch.drop_column("root_id")
    op.drop_index("ix_roots_identity", "roots")
    op.drop_index("uq_roots_workspace_folder", "roots")
    with op.batch_alter_table("roots") as batch:
        for column in ("checked_at", "marker_writable", "folder_status", "fs_ino", "fs_dev"):
            batch.drop_column(column)
    op.drop_index("ix_sessions_workspace", "sessions")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("workspace_id")
    op.drop_table("workspaces")
