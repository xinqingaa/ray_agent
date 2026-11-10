"""记忆候选的目标版本、来源版本与可撤销状态。

Revision ID: 0008_memory_consistency
Revises: 0007_semantic_index
"""
import sqlalchemy as sa
from alembic import op

revision = "0008_memory_consistency"
down_revision = "0007_semantic_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("memory_access_version", sa.Integer(), nullable=False, server_default="1"))
    # 旧数据没有这些依据，保持 NULL，不猜测候选依据或历史状态。
    op.add_column("memory_entries", sa.Column("supersedes_version", sa.Integer(), nullable=True))
    op.add_column("memory_sources", sa.Column("memory_version", sa.Integer(), nullable=True))
    op.add_column("memory_sources", sa.Column("content_fingerprint", sa.String(64), nullable=True))
    op.add_column("memory_changes", sa.Column("before_state", sa.JSON(), nullable=True))
    op.add_column("memory_changes", sa.Column("after_state", sa.JSON(), nullable=True))


def downgrade() -> None:
    for table, columns in (
        ("memory_changes", ("after_state", "before_state")),
        ("memory_sources", ("content_fingerprint", "memory_version")),
        ("memory_entries", ("supersedes_version",)),
        ("sessions", ("memory_access_version",)),
    ):
        with op.batch_alter_table(table) as batch:
            for column in columns:
                batch.drop_column(column)
