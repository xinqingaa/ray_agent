"""unread_message_count now counts completed runs the user has not opened; drop old per-message counts."""
from alembic import op

revision = 'f7b1d4e85a32'
down_revision = 'e6a0c3d94f21'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE sessions SET unread_message_count = 0")


def downgrade():
    pass
