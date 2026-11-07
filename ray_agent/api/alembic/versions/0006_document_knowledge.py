"""文档登记、修订、结构块、片段与索引发布。

Revision ID: 0006_document_knowledge
Revises: 0005_skill_multi_source
Create Date: 2026-11-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.infrastructure.models.base import UTCDateTime

revision: str = "0006_document_knowledge"
down_revision: Union[str, Sequence[str], None] = "0005_skill_multi_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("format", sa.String(32), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "relative_path", name="uq_documents_path"),
    )
    op.create_index("ix_documents_workspace_status", "documents", ["workspace_id", "status"])

    op.create_table(
        "document_revisions",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("document_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("modified_ns", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("format", sa.String(32), nullable=False),
        sa.Column("parse_config", sa.String(64), nullable=False),
        sa.Column("chunk_config", sa.String(64), nullable=False),
        sa.Column("staging_object_id", sa.String(128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("component_needed", sa.String(64), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("published_at", UTCDateTime(), nullable=True),
        sa.UniqueConstraint("document_id", "revision", name="uq_document_revisions_doc_rev"),
    )
    op.create_index("ix_document_revisions_workspace_status", "document_revisions",
                    ["workspace_id", "status"])
    op.create_index("ix_document_revisions_document", "document_revisions", ["document_id", "revision"])

    op.create_table(
        "content_blocks",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("revision_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("locator", sa.JSON(), nullable=False),
    )
    op.create_index("ix_content_blocks_revision", "content_blocks", ["revision_id", "ordinal"])

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("revision_id", sa.String(128), nullable=False),
        sa.Column("document_id", sa.String(128), nullable=False),
        sa.Column("workspace_id", sa.String(128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("text_hash", sa.String(64), nullable=False),
        sa.Column("locator", sa.JSON(), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_document_chunks_workspace_published", "document_chunks",
                    ["workspace_id", "published"])
    op.create_index("ix_document_chunks_revision", "document_chunks", ["revision_id", "ordinal"])
    op.create_index("ix_document_chunks_document", "document_chunks", ["document_id", "revision"])

    op.create_table(
        "index_publications",
        sa.Column("workspace_id", sa.String(128), primary_key=True),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("active_operation_id", sa.String(128), nullable=True),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("index_publications")
    op.drop_table("document_chunks")
    op.drop_table("content_blocks")
    op.drop_table("document_revisions")
    op.drop_table("documents")
