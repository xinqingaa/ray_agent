"""工作方式、记忆、提炼、会话摘要、运行背景清单与全文检索底座。

Revision ID: 0004_working_style_memory
Revises: 0003_write_protection
Create Date: 2026-11-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.infrastructure.models.base import UTCDateTime

revision: str = "0004_working_style_memory"
down_revision: Union[str, Sequence[str], None] = "0003_write_protection"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instruction_versions",
        sa.Column("workspace_id", sa.String(128), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("proposal_id", sa.String(128), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_instruction_versions_workspace", "instruction_versions", ["workspace_id", "version"])

    op.create_table(
        "instruction_proposals",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("resolved_at", UTCDateTime(), nullable=True),
    )
    op.create_index("ix_instruction_proposals_workspace", "instruction_proposals", ["workspace_id", "status"])

    op.create_table(
        "working_style_templates",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tool_suggestions", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )

    op.create_table(
        "memory_entries",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("memory_type", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(32), nullable=False),
        sa.Column("certainty", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("pinned", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("supersedes_id", sa.String(128), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("last_used_at", UTCDateTime(), nullable=True),
    )
    op.create_index("ix_memory_entries_workspace_status", "memory_entries", ["workspace_id", "status"])
    op.create_index("ix_memory_entries_workspace_pinned", "memory_entries", ["workspace_id", "pinned"])

    op.create_table(
        "memory_sources",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("memory_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=True),
        sa.Column("event_seq_start", sa.Integer(), nullable=True),
        sa.Column("event_seq_end", sa.Integer(), nullable=True),
        sa.Column("document_id", sa.String(128), nullable=True),
        sa.Column("document_revision", sa.Integer(), nullable=True),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_memory_sources_memory", "memory_sources", ["memory_id"])
    op.create_index("ix_memory_sources_workspace", "memory_sources", ["workspace_id"])

    op.create_table(
        "memory_changes",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("memory_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("from_version", sa.Integer(), nullable=True),
        sa.Column("to_version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("origin", sa.String(32), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("replaces_change_id", sa.String(128), nullable=True),
        sa.Column("before_content", sa.Text(), nullable=True),
        sa.Column("after_content", sa.Text(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_memory_changes_memory", "memory_changes", ["memory_id", "to_version"])
    op.create_index("ix_memory_changes_workspace", "memory_changes", ["workspace_id", "created_at"])

    op.create_table(
        "memory_suppressions",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("source_seq_end", sa.Integer(), nullable=False),
        sa.Column("content_fingerprint", sa.String(64), nullable=False),
        sa.Column("memory_id", sa.String(128), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index(
        "uq_memory_suppressions_scope",
        "memory_suppressions",
        ["workspace_id", "session_id", "source_seq_end", "content_fingerprint"],
        unique=True,
    )

    op.create_table(
        "extraction_jobs",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("operation_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("source_seq_end", sa.Integer(), nullable=False),
        sa.Column("strategy_version", sa.Integer(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("result_identity", sa.String(128), nullable=True),
        sa.Column("commit_status", sa.String(16), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_extraction_jobs_session", "extraction_jobs", ["session_id", "generation"])
    op.create_index("uq_extraction_jobs_operation", "extraction_jobs", ["operation_id"], unique=True)

    op.create_table(
        "session_summaries",
        sa.Column("session_id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source_seq", sa.Integer(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_session_summaries_workspace", "session_summaries", ["workspace_id", "updated_at"])

    op.create_table(
        "run_context_manifests",
        sa.Column("run_id", sa.String(128), primary_key=True),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=True),
        sa.Column("instruction_version", sa.Integer(), nullable=True),
        sa.Column("instruction_body", sa.Text(), nullable=True),
        sa.Column("resident_memories", sa.JSON(), nullable=False),
        sa.Column("retrieval_hits", sa.JSON(), nullable=False),
        sa.Column("omissions", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_run_context_manifests_session", "run_context_manifests", ["session_id"])

    # 全文检索元数据；FTS5 虚表用内容同步，中文分词在应用层完成后再入库
    op.create_table(
        "search_documents",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("source_type", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tokenized", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index(
        "uq_search_documents_source",
        "search_documents",
        ["workspace_id", "source_type", "source_id"],
        unique=True,
    )
    op.create_index("ix_search_documents_workspace", "search_documents", ["workspace_id", "source_type"])

    op.execute(
        "CREATE VIRTUAL TABLE search_documents_fts USING fts5("
        "doc_id UNINDEXED, workspace_id UNINDEXED, source_type UNINDEXED, "
        "title, body, tokenize='unicode61')"
    )

    with op.batch_alter_table("sessions") as batch:
        batch.add_column(
            sa.Column("participate_in_memory", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch.add_column(
            sa.Column("instruction_version", sa.Integer(), nullable=True)
        )

    with op.batch_alter_table("workspaces") as batch:
        batch.add_column(sa.Column("instruction_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workspaces") as batch:
        batch.drop_column("instruction_version")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("instruction_version")
        batch.drop_column("participate_in_memory")
    op.execute("DROP TABLE IF EXISTS search_documents_fts")
    for table in (
        "search_documents",
        "run_context_manifests",
        "session_summaries",
        "extraction_jobs",
        "memory_suppressions",
        "memory_changes",
        "memory_sources",
        "memory_entries",
        "working_style_templates",
        "instruction_proposals",
        "instruction_versions",
    ):
        op.drop_table(table)
