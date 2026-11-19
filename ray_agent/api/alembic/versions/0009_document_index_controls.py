"""文档索引控制、扫描范围与来源撤回代次。"""

import sqlalchemy as sa
from alembic import op

revision = "0009_document_index_controls"
down_revision = "0008_memory_consistency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("documents", "document_revisions"):
        op.add_column(table, sa.Column("source_epoch", sa.Integer(), nullable=False, server_default="0"))
    for column in ("explicit_hits", "retired_document_refs"):
        op.add_column("run_context_manifests", sa.Column(column, sa.JSON(), nullable=True))
    op.add_column("index_publications", sa.Column("policy", sa.JSON(), nullable=True))
    op.add_column("index_publications", sa.Column("scan", sa.JSON(), nullable=True))
    op.add_column("index_publications", sa.Column("scan_operation_id", sa.String(128), nullable=True))
    op.add_column("index_publications", sa.Column(
        "scope_review_required", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    for table, columns in (
        ("index_publications", ("scope_review_required", "scan_operation_id", "scan", "policy")),
        ("run_context_manifests", ("retired_document_refs", "explicit_hits")),
        ("document_revisions", ("source_epoch",)),
        ("documents", ("source_epoch",)),
    ):
        with op.batch_alter_table(table) as batch:
            for column in columns:
                batch.drop_column(column)
