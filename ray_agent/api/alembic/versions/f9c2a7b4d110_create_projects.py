"""长期项目、会话归属与首次受理快照；一次路径去重回填，不保留双事实来源。

Revision ID: f9c2a7b4d110
Revises: e7b1c4d9a2f6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f9c2a7b4d110"
down_revision = "e7b1c4d9a2f6"
branch_labels = None
depends_on = None


def upgrade():
    # 先拒绝旧库中的重叠路径；整次迁移事务回滚，不丢历史或挑选其中一项。
    op.execute("""DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM (SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL) a
        JOIN (SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL) b
        ON a.project_path <> b.project_path
        AND left(b.project_path, length(rtrim(a.project_path, '/') || '/')) = rtrim(a.project_path, '/') || '/'
      ) THEN RAISE EXCEPTION '旧项目路径存在嵌套，请清点并明确处理后重试迁移；没有修改数据'; END IF;
      IF EXISTS (
        SELECT s.project_path FROM sessions s JOIN runs r ON r.session_id=s.id
        WHERE s.project_path IS NOT NULL AND r.status IN ('running','waiting')
        GROUP BY s.project_path HAVING count(*) > 1
      ) THEN RAISE EXCEPTION '旧项目存在多个活动对话，请明确处理后重试迁移；没有修改数据'; END IF;
    END $$""")
    op.create_table("projects",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("path", sa.String(4096), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("git_author_name", sa.String(120), nullable=True),
        sa.Column("git_author_email", sa.String(320), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(0)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(0)")),
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("path", name="uq_projects_path"),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 160", name="ck_projects_name"),
        sa.CheckConstraint("instructions IS NULL OR char_length(instructions) <= 8000", name="ck_projects_instructions"),
        sa.CheckConstraint("(git_author_name IS NULL) = (git_author_email IS NULL)", name="ck_projects_git_identity_pair"),
    )
    op.add_column("sessions", sa.Column("project_id", sa.String(255), nullable=True))
    op.add_column("sessions", sa.Column("project_snapshot", postgresql.JSONB(), nullable=True))
    op.execute("""INSERT INTO projects(id, path, name, created_at, updated_at, last_active_at)
      SELECT md5('rayagent-project:' || project_path)::uuid::text, project_path,
        left(COALESCE(NULLIF(regexp_replace(project_path, '^.*/', ''), ''), '/'), 160),
        min(created_at), min(created_at), max(latest_message_at)
      FROM sessions WHERE project_path IS NOT NULL GROUP BY project_path""")
    op.execute("UPDATE sessions s SET project_id=p.id FROM projects p WHERE s.project_path=p.path")
    # 已受理的旧任务冻结空设置，不能在迁移后悄悄继承新说明/身份；HEAD/dirty 没有旧证据，保留 unknown。
    op.execute("""UPDATE sessions s SET project_snapshot=jsonb_build_object(
        'project_id',p.id,'path',p.path,'name',p.name,'instructions',NULL,
        'git_author_name',NULL,'git_author_email',NULL,'initial_head',NULL,'initial_dirty',NULL,'directory_identity',NULL)
      FROM projects p WHERE s.project_id=p.id AND EXISTS(SELECT 1 FROM runs r WHERE r.session_id=s.id)""")
    op.create_foreign_key("fk_sessions_project_id", "sessions", "projects", ["project_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_sessions_project_id", "sessions", ["project_id"])
    op.drop_column("sessions", "project_path")


def downgrade():
    op.add_column("sessions", sa.Column("project_path", sa.String(4096), nullable=True))
    op.execute("UPDATE sessions s SET project_path=p.path FROM projects p WHERE s.project_id=p.id")
    op.drop_index("ix_sessions_project_id", table_name="sessions")
    op.drop_constraint("fk_sessions_project_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "project_snapshot")
    op.drop_column("sessions", "project_id")
    op.drop_table("projects")
