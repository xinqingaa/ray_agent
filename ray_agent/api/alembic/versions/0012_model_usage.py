"""记录模型请求、计价与音频时长。"""

from alembic import op
import sqlalchemy as sa

revision = "0012_model_usage"
down_revision = "0011_document_ocr"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("session_id", sa.String(128), sa.ForeignKey("sessions.id", ondelete="SET NULL")),
        sa.Column("run_id", sa.String(128), sa.ForeignKey("runs.id", ondelete="SET NULL")),
        sa.Column("workspace_id", sa.String(128), sa.ForeignKey("workspaces.id", ondelete="SET NULL")),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("failed", sa.Boolean(), nullable=False),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("cached_tokens", sa.Integer()),
        sa.Column("reasoning_tokens", sa.Integer()),
        sa.Column("audio_duration_ms", sa.Integer()),
        sa.Column("cost_nano_usd", sa.Integer()),
        sa.Column("price_version", sa.String(64)),
        sa.Column("price_period", sa.String(24)),
    )
    for suffix, columns in {
        "time": ["started_at"], "provider": ["provider", "started_at"],
        "session": ["session_id"], "run": ["run_id"],
    }.items():
        op.create_index(f"ix_model_usage_{suffix}", "model_usage", columns)


def downgrade() -> None:
    op.drop_table("model_usage")
