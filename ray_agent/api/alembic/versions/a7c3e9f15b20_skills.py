"""全局技能与运行版本引用。"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'a7c3e9f15b20'
down_revision = 'f7b1d4e85a32'
branch_labels = None
depends_on = None


def upgrade():
    for table, key, size in [('skills', 'name', 64), ('skill_versions', 'id', 64), ('skill_imports', 'id', 64)]:
        op.create_table(table, sa.Column(key, sa.String(size), primary_key=True), sa.Column('data', JSONB, nullable=False))
    op.create_table('run_skills',
        sa.Column('run_id', sa.String(255), sa.ForeignKey('runs.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('name', sa.String(64), primary_key=True),
        sa.Column('version', sa.String(64), sa.ForeignKey('skill_versions.id'), nullable=False),
        sa.Column('data', JSONB, nullable=False))


def downgrade():
    for table in ('run_skills', 'skill_imports', 'skill_versions', 'skills'):
        op.drop_table(table)
