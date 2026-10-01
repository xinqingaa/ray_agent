"""持久交付调用来源，按 run/call/path 补存而不重新交付。
Revision ID: d4a8b1c53f64
Revises: c3f7a0b42e53
"""
from alembic import op
import sqlalchemy as sa
revision = 'd4a8b1c53f64'
down_revision = 'c3f7a0b42e53'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('project_file_copies', sa.Column('resolved_path', sa.Text(), nullable=True))
    op.add_column('project_file_copies', sa.Column('source_path', sa.Text(), nullable=True))
    op.add_column('project_file_copies', sa.Column('tool_call_id', sa.String(255), nullable=True))


def downgrade():
    op.drop_column('project_file_copies', 'tool_call_id')
    op.drop_column('project_file_copies', 'source_path')
    op.drop_column('project_file_copies', 'resolved_path')
