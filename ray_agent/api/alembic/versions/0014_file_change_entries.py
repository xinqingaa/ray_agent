"""文件变更记录区分文件与文件夹，并允许界面手动操作作为变更来源。

既有行没有条目类型，全部视为文件：与升级前的记录含义一致，不改动已有数据。
"""

from alembic import op
import sqlalchemy as sa

revision = "0014_file_change_entries"
down_revision = "0013_usage_total_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = sa.inspect(op.get_bind()).get_columns("file_changes")
    if any(column["name"] == "entry_kind" for column in columns):
        return
    with op.batch_alter_table("file_changes") as batch:
        batch.add_column(sa.Column("entry_kind", sa.String(length=16), nullable=False,
                                   server_default="file"))


def downgrade() -> None:
    with op.batch_alter_table("file_changes") as batch:
        batch.drop_column("entry_kind")
