"""工作区与独立对话的应用内项目预览声明表（静态站点与轻量单进程本地脚本）。"""

from alembic import op
import sqlalchemy as sa

revision = "0015_workspace_previews"
down_revision = "0014_file_change_entries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("workspace_previews"):
        return
    op.create_table(
        "workspace_previews",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("workspace_id", sa.String(length=128), sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("session_id", sa.String(length=128), sa.ForeignKey("sessions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("run_id", sa.String(length=128), sa.ForeignKey("runs.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("root_id", sa.String(length=128), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("entry_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("start_command", sa.Text(), nullable=True),
        sa.Column("health_path", sa.String(length=512), nullable=False, server_default="/"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workspace_previews_session", "workspace_previews", ["session_id", "updated_at"])
    op.create_index("ix_workspace_previews_workspace", "workspace_previews", ["workspace_id", "updated_at"])


def downgrade() -> None:
    op.drop_table("workspace_previews")
