"""记录双币种计费（人民币纳元）与缓存写入 Token。"""

from alembic import op
import sqlalchemy as sa

revision = "0017_usage_currency"
down_revision = "0016_session_active_preset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("model_usage")}
    if "cache_write_tokens" not in columns:
        op.add_column("model_usage", sa.Column("cache_write_tokens", sa.Integer(), nullable=True))
    if "cost_nano_cny" not in columns:
        op.add_column("model_usage", sa.Column("cost_nano_cny", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("model_usage")}
    targets = [name for name in ("cost_nano_cny", "cache_write_tokens") if name in columns]
    if not targets:
        return
    with op.batch_alter_table("model_usage") as batch_op:
        for name in targets:
            batch_op.drop_column(name)
