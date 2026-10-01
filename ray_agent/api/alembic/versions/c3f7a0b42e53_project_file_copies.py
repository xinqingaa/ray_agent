"""附件受理与项目副本关联；上传对象保存实际哈希和确认规则。
Revision ID: c3f7a0b42e53
Revises: b2e6f9a31d42
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'c3f7a0b42e53'
down_revision = 'b2e6f9a31d42'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('files', sa.Column('sha256', sa.String(64), nullable=True))
    op.add_column('files', sa.Column('project_upload', JSONB(), nullable=True))
    op.create_table('project_file_copies',
        sa.Column('project_id', sa.String(255), sa.ForeignKey('projects.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('copy_key', sa.String(255), primary_key=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('attachment_id', sa.String(255), nullable=False),
        sa.Column('session_id', sa.String(255), nullable=False),
        sa.Column('run_id', sa.String(255), nullable=False),
        sa.Column('message_seq', sa.BigInteger(), nullable=True),
        sa.Column('path', sa.Text(), nullable=True),
        sa.Column('sha256', sa.String(64), nullable=False),
        sa.Column('size', sa.BigInteger(), nullable=False),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("state IN ('pending','ready')", name='ck_project_file_copies_state'),
        sa.UniqueConstraint('project_id', 'path', name='uq_project_file_copies_path'),
    )


def downgrade():
    op.drop_table('project_file_copies')
    op.drop_column('files', 'project_upload')
    op.drop_column('files', 'sha256')
