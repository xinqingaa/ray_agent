"""Record whether a run was started in plan mode.

Revision ID: c3f8e1a2b7d4
Revises: a7d9215bc8e0
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3f8e1a2b7d4'
down_revision: Union[str, Sequence[str], None] = 'a7d9215bc8e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('mode', sa.String(length=16), nullable=False, server_default='normal'))


def downgrade() -> None:
    op.drop_column('runs', 'mode')
