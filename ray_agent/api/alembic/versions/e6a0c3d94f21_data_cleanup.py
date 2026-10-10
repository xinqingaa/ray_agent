"""Persistent cleanup manifests, independent from deleted business records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e6a0c3d94f21'
down_revision = 'd5f9b2c83e10'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('data_cleanup_tasks',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('scope', sa.String(16), nullable=False),
        sa.Column('project_id', sa.String(255)),
        sa.Column('name', sa.String(160), nullable=False),
        sa.Column('state', sa.String(16), nullable=False),
        sa.Column('phase', sa.String(24), nullable=False),
        sa.Column('completed', sa.Integer(), nullable=False),
        sa.Column('total', sa.Integer(), nullable=False),
        sa.Column('error', sa.Text()),
        sa.Column('manifest', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False))
    op.create_index('uq_data_cleanup_pending', 'data_cleanup_tasks', [sa.text('(1)')],
        unique=True, postgresql_where=sa.text("state <> 'completed'"))


def downgrade():
    op.drop_table('data_cleanup_tasks')
