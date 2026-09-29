"""Track session title ownership for asynchronous generation.

Revision ID: a7d9215bc8e0
Revises: 5b7e2c9d4a10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d9215bc8e0'
down_revision: Union[str, Sequence[str], None] = '5b7e2c9d4a10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('title_source', sa.String(length=16), nullable=False,
                                        server_default='placeholder'))
    op.execute("UPDATE sessions SET title_source = 'auto' WHERE title NOT IN ('', '新对话')")


def downgrade() -> None:
    op.drop_column('sessions', 'title_source')
