"""项目内容快照、大小与保护状态；保留已执行版本，追加单 head。
Revision ID: b2e6f9a31d42
Revises: a1d4e8f20c31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'b2e6f9a31d42'
down_revision = 'a1d4e8f20c31'
branch_labels = None
depends_on = None


def upgrade():
    for column in (
        sa.Column('files_size', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('files_size_at', sa.DateTime(), nullable=True),
        sa.Column('files_size_stale', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('protection', JSONB(), nullable=True),
        sa.Column('snapshot_gc_pending', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('snapshots_cleaned_at', sa.DateTime(), nullable=True),
        sa.Column('snapshots_released_bytes', sa.BigInteger(), nullable=False, server_default='0'),
    ):
        op.add_column('projects', column)
    op.create_table('project_snapshots',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('project_id', sa.String(255), sa.ForeignKey('projects.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('run_id', sa.String(255), nullable=True),
        sa.Column('session_id', sa.String(255), nullable=True),
        sa.Column('total_bytes', sa.BigInteger(), nullable=False),
        sa.Column('manifest_sha256', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("source IN ('run', 'upload', 'restore')", name='ck_project_snapshots_source'),
    )
    op.create_index('ix_project_snapshots_project_id', 'project_snapshots', ['project_id'])


def downgrade():
    op.drop_table('project_snapshots')
    for name in ('files_size','files_size_at','files_size_stale','protection','snapshot_gc_pending','snapshots_cleaned_at','snapshots_released_bytes'):
        op.drop_column('projects', name)
