"""长期项目、会话归属与首次受理快照。不兼容旧数据：旧 project_path 直接删除，不回填。

Revision ID: f9c2a7b4d110
Revises: e7b1c4d9a2f6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f9c2a7b4d110"
down_revision = "e7b1c4d9a2f6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("projects",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("path", sa.String(4096), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(0)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(0)")),
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("path", name="uq_projects_path"),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 160", name="ck_projects_name"),
        sa.CheckConstraint("instructions IS NULL OR char_length(instructions) <= 8000", name="ck_projects_instructions"),
    )
    op.add_column("sessions", sa.Column("project_id", sa.String(255), nullable=True))
    op.add_column("sessions", sa.Column("project_snapshot", postgresql.JSONB(), nullable=True))
    op.create_foreign_key("fk_sessions_project_id", "sessions", "projects", ["project_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_sessions_project_id", "sessions", ["project_id"])
    op.drop_column("sessions", "project_path")


def downgrade():
    op.add_column("sessions", sa.Column("project_path", sa.String(4096), nullable=True))
    op.drop_index("ix_sessions_project_id", table_name="sessions")
    op.drop_constraint("fk_sessions_project_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "project_snapshot")
    op.drop_column("sessions", "project_id")
    op.drop_table("projects")
