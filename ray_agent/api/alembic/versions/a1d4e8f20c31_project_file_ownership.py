"""持久化项目文件操作。既有迁移已在产品库执行，追加单 head 迁移，不重写已执行版本。

Revision ID: a1d4e8f20c31
Revises: f9c2a7b4d110
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'a1d4e8f20c31'
down_revision = 'f9c2a7b4d110'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('file_operation', JSONB(), nullable=True))
    op.create_table('project_audit_events',
        sa.Column('project_id', sa.String(255), sa.ForeignKey('projects.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('seq', sa.Integer(), primary_key=True),
        sa.Column('type', sa.String(80), nullable=False),
        sa.Column('payload', JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('project_audit_events')
    op.drop_column('projects', 'file_operation')
