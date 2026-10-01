"""工作区内交付是原文件引用，可由不同调用共享路径；发布副本路径仍排他。
Revision ID: e5b9c2d64a75
Revises: d4a8b1c53f64
"""
from alembic import op
import sqlalchemy as sa
revision = 'e5b9c2d64a75'
down_revision = 'd4a8b1c53f64'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('uq_project_file_copies_path', 'project_file_copies', type_='unique')
    op.create_index('uq_project_file_copies_path', 'project_file_copies', ['project_id','path'], unique=True,
        postgresql_where=sa.text("resolved_path IS NULL OR resolved_path NOT LIKE '/workspace/%'"))


def downgrade():
    # 不通过删除用户记录回滚。存在重复原文件引用时明确拒绝旧约束。
    duplicate = op.get_bind().execute(sa.text('SELECT 1 FROM project_file_copies WHERE path IS NOT NULL GROUP BY project_id,path HAVING count(*) > 1 LIMIT 1')).scalar()
    if duplicate:
        raise RuntimeError('已有共享工作区交付引用，不能无损降级路径约束')
    op.drop_index('uq_project_file_copies_path', table_name='project_file_copies')
    op.create_unique_constraint('uq_project_file_copies_path', 'project_file_copies', ['project_id','path'])
