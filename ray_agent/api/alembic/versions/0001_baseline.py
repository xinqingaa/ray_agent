"""桌面业务库基线：会话、运行、事件、文件、可访问根、受理记录与持久输入、后台任务、应用配置与 skill。

后续工作包新增的表各自以升级脚本加入，表结构变更使用批量模式。

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.infrastructure.models.base import UTCDateTime

revision: str = "0001_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("title_source", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("model_id", sa.String(128), nullable=True),
        sa.Column("reasoning", sa.String(32), nullable=True),
        sa.Column("context_window", sa.Integer(), nullable=True),
        sa.Column("max_tokens", sa.Integer(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("unread_message_count", sa.Integer(), nullable=False),
        sa.Column("latest_message", sa.Text(), nullable=False),
        sa.Column("latest_message_at", UTCDateTime(), nullable=True),
        sa.Column("next_event_seq", sa.Integer(), nullable=False),
        sa.Column("memories", sa.JSON(), nullable=False),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_sessions_latest", "sessions", ["latest_message_at", "created_at"])

    op.create_table(
        "runs",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("started_at", UTCDateTime(), nullable=False),
        sa.Column("ended_at", UTCDateTime(), nullable=True),
        sa.Column("turns", sa.Integer(), nullable=False),
        sa.Column("model_requests", sa.Integer(), nullable=False),
        sa.Column("tool_calls", sa.Integer(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("cached_tokens", sa.Integer(), nullable=True),
        sa.Column("config_snapshot", sa.JSON(), nullable=False),
    )
    op.create_index("ix_runs_session", "runs", ["session_id", "started_at"])
    op.create_index("ix_runs_status", "runs", ["status"])
    op.create_index("uq_runs_active_session", "runs", ["session_id"], unique=True,
                    sqlite_where=sa.text("status IN ('running', 'waiting')"))

    op.create_table(
        "events",
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(128), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("session_id", "seq", name="pk_events"),
    )
    op.create_index("ix_events_run", "events", ["run_id"])
    op.create_index("ix_events_session_type", "events", ["session_id", "type", "seq"])

    op.create_table(
        "files",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("filepath", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("extension", sa.String(64), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("visual", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_files_session", "files", ["session_id"])

    op.create_table(
        "roots",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("workspace_id", sa.String(128), nullable=True),
        sa.Column("location", sa.Text(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("uq_roots_session_workdir", "roots", ["session_id"], unique=True,
                    sqlite_where=sa.text("kind = 'session_workdir'"))

    op.create_table(
        "accepted_requests",
        sa.Column("request_id", sa.String(128), primary_key=True),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )

    op.create_table(
        "run_inputs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(128), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("message_seq", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("consumed_seq", sa.Integer(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("consumed_at", UTCDateTime(), nullable=True),
    )
    op.create_index("ix_run_inputs_run", "run_inputs", ["run_id", "status", "id"])
    op.create_index("ix_run_inputs_session", "run_inputs", ["session_id", "status"])

    op.create_table(
        "background_jobs",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("scope_kind", sa.String(16), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=True),
        sa.Column("session_id", sa.String(128), nullable=True),
        sa.Column("object_version", sa.String(128), nullable=True),
        sa.Column("idempotency_key", sa.String(255), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("owner_instance", sa.String(128), nullable=True),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("cancel_requested_at", UTCDateTime(), nullable=True),
        sa.Column("phase", sa.String(64), nullable=True),
        sa.Column("progress_completed", sa.Integer(), nullable=False),
        sa.Column("progress_total", sa.Integer(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("error", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("started_at", UTCDateTime(), nullable=True),
        sa.Column("finished_at", UTCDateTime(), nullable=True),
    )
    op.create_index("ix_background_jobs_status", "background_jobs", ["status", "created_at"])
    op.create_index("uq_background_jobs_key", "background_jobs", ["kind", "idempotency_key"], unique=True,
                    sqlite_where=sa.text("idempotency_key IS NOT NULL"))

    op.create_table(
        "app_config",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )

    op.create_table("skills", sa.Column("name", sa.String(64), primary_key=True),
                    sa.Column("data", sa.JSON(), nullable=False))
    op.create_table("skill_versions", sa.Column("id", sa.String(64), primary_key=True),
                    sa.Column("data", sa.JSON(), nullable=False))
    op.create_table("skill_imports", sa.Column("id", sa.String(64), primary_key=True),
                    sa.Column("data", sa.JSON(), nullable=False))
    op.create_table(
        "run_skills",
        sa.Column("run_id", sa.String(128), sa.ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("version", sa.String(64), sa.ForeignKey("skill_versions.id"), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    for table in ("run_skills", "skill_imports", "skill_versions", "skills", "app_config", "background_jobs",
                  "run_inputs", "accepted_requests", "roots", "files", "events", "runs", "sessions"):
        op.drop_table(table)
