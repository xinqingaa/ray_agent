"""Bind a session to one host project directory.

Revision ID: e7b1c4d9a2f6
Revises: c3f8e1a2b7d4
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e7b1c4d9a2f6'
down_revision: Union[str, Sequence[str], None] = 'c3f8e1a2b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('project_path', sa.String(length=4096), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'project_path')
