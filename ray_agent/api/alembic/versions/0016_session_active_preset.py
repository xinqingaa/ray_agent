"""会话表增加 active_preset_id，记录会话锁定的内置场景预设。"""

from alembic import op
import sqlalchemy as sa

revision = "0016_session_active_preset"
down_revision = "0015_workspace_previews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("sessions")}
    if "active_preset_id" in columns:
        return
    op.add_column("sessions", sa.Column("active_preset_id", sa.String(length=128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("sessions")}
    if "active_preset_id" not in columns:
        return
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("active_preset_id")
