"""Remember the model id and reasoning choice on a session.

Revision ID: b8c1e4a90d27
Revises: f6cad3e75b86
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b8c1e4a90d27'
down_revision: Union[str, Sequence[str], None] = 'f6cad3e75b86'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('model_id', sa.String(length=128), nullable=True))
    op.add_column('sessions', sa.Column('reasoning', sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'reasoning')
    op.drop_column('sessions', 'model_id')
