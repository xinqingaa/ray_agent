"""在已发布的文档版本记录上保留实际 PDF 页数。"""

import sqlalchemy as sa
from alembic import op

revision = "0010_document_page_count"
down_revision = "0009_document_index_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_revisions", sa.Column("page_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("document_revisions") as batch:
        batch.drop_column("page_count")
