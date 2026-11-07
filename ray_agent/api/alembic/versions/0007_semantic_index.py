"""P7：索引发布指针增加向量代次与 Embedding 配置。

Revision ID: 0007_semantic_index
Revises: 0006_document_knowledge
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_semantic_index"
down_revision = "0006_document_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("index_publications") as batch:
        batch.add_column(sa.Column("embedding_config", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("vector_generation", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("vector_table_version", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("semantic_operation_id", sa.String(length=128), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("index_publications") as batch:
        batch.drop_column("semantic_operation_id")
        batch.drop_column("vector_table_version")
        batch.drop_column("vector_generation")
        batch.drop_column("embedding_config")
