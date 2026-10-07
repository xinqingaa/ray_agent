"""Remember the context window, output budget and temperature on a session.

Revision ID: c4e8a1b72d09
Revises: b8c1e4a90d27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4e8a1b72d09'
down_revision: Union[str, Sequence[str], None] = 'b8c1e4a90d27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('context_window', sa.BigInteger(), nullable=True))
    op.add_column('sessions', sa.Column('max_tokens', sa.BigInteger(), nullable=True))
    op.add_column('sessions', sa.Column('temperature', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'temperature')
    op.drop_column('sessions', 'max_tokens')
    op.drop_column('sessions', 'context_window')
