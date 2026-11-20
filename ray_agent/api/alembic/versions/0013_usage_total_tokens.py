"""记录上游提供的总 Token，并补齐已创建的用量表。"""

from alembic import op
import sqlalchemy as sa

revision = "0013_usage_total_tokens"
down_revision = "0012_model_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 有一版 0012 已包含此列，其中的上游总量优先于按分项推算的值。
    columns = sa.inspect(op.get_bind()).get_columns("model_usage")
    if any(column["name"] == "total_tokens" for column in columns):
        return
    op.add_column("model_usage", sa.Column("total_tokens", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE model_usage
        SET total_tokens = coalesce(input_tokens, 0) + coalesce(output_tokens, 0)
        WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL
    """)


def downgrade() -> None:
    with op.batch_alter_table("model_usage") as batch:
        batch.drop_column("total_tokens")
