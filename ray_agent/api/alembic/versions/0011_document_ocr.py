"""保存当前文档修订的文字识别状态。"""

import sqlalchemy as sa
from alembic import op

revision = "0011_document_ocr"
down_revision = "0010_document_page_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_revisions", sa.Column("ocr_state", sa.String(32), nullable=True))
    op.add_column("document_revisions", sa.Column("ocr_pages_pending", sa.Integer(), nullable=True))
    op.add_column("document_revisions", sa.Column("ocr_error", sa.Text(), nullable=True))
    op.execute("UPDATE index_publications SET status = 'idle' WHERE status = 'semantic_indexing'")


def downgrade() -> None:
    with op.batch_alter_table("document_revisions") as batch:
        batch.drop_column("ocr_error")
        batch.drop_column("ocr_pages_pending")
        batch.drop_column("ocr_state")
