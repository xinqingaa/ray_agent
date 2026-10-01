"""项目设置/笔记共享版本与对话摘要代次。
Revision ID: f6cad3e75b86
Revises: e5b9c2d64a75
"""
from alembic import op
import sqlalchemy as sa
revision='f6cad3e75b86'
down_revision='e5b9c2d64a75'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('projects',sa.Column('notes',sa.Text(),nullable=False,server_default=''))
    for name in ('notes_version','settings_version'):
        op.add_column('projects',sa.Column(name,sa.Integer(),nullable=False,server_default='0'))
    op.create_check_constraint('ck_projects_notes','projects','char_length(notes) <= 8000')
    op.add_column('sessions',sa.Column('summary',sa.Text(),nullable=True))
    op.add_column('sessions',sa.Column('summary_source',sa.String(16),nullable=True))
    op.add_column('sessions',sa.Column('summary_state',sa.String(16),nullable=False,server_default='idle'))
    op.add_column('sessions',sa.Column('summary_error',sa.Text(),nullable=True))
    for name in ('summary_generation','summary_source_seq'):
        op.add_column('sessions',sa.Column(name,sa.BigInteger(),nullable=False,server_default='0'))


def downgrade():
    for name in ('summary','summary_source','summary_state','summary_error','summary_generation','summary_source_seq'):
        op.drop_column('sessions',name)
    op.drop_constraint('ck_projects_notes','projects',type_='check')
    for name in ('notes','notes_version','settings_version'):
        op.drop_column('projects',name)
