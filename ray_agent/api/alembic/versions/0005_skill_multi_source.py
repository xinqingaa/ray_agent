"""Skill 多来源：目录主键改为稳定 id，运行绑定按 skill_id。

Revision ID: 0005_skill_multi_source
Revises: 0004_working_style_memory
Create Date: 2026-11-07

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_skill_multi_source"
down_revision: Union[str, Sequence[str], None] = "0004_working_style_memory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skills_new",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    conn = op.get_bind()
    for row in conn.execute(sa.text("SELECT name, data FROM skills")).mappings():
        raw = row["data"]
        data = json.loads(raw) if isinstance(raw, str) else dict(raw or {})
        skill_id = data.get("id") or row["name"]
        data["id"] = skill_id
        data.setdefault("name", row["name"])
        conn.execute(
            sa.text("INSERT INTO skills_new (id, data) VALUES (:id, :data)"),
            {"id": skill_id, "data": json.dumps(data, ensure_ascii=False)},
        )
    op.drop_table("skills")
    op.rename_table("skills_new", "skills")

    op.create_table(
        "run_skills_new",
        sa.Column("run_id", sa.String(128), sa.ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("skill_id", sa.String(128), primary_key=True),
        sa.Column("version", sa.String(64), sa.ForeignKey("skill_versions.id"), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    for row in conn.execute(sa.text("SELECT run_id, name, version, data FROM run_skills")).mappings():
        raw = row["data"]
        data = json.loads(raw) if isinstance(raw, str) else dict(raw or {})
        skill_id = data.get("id") or row["name"]
        data["id"] = skill_id
        data.setdefault("name", row["name"])
        conn.execute(
            sa.text(
                "INSERT INTO run_skills_new (run_id, skill_id, version, data) "
                "VALUES (:run_id, :skill_id, :version, :data)"
            ),
            {
                "run_id": row["run_id"],
                "skill_id": skill_id,
                "version": row["version"],
                "data": json.dumps(data, ensure_ascii=False),
            },
        )
    op.drop_table("run_skills")
    op.rename_table("run_skills_new", "run_skills")


def downgrade() -> None:
    raise NotImplementedError("桌面业务库不回退 schema")
