"""Owned visual artifacts and expiry metadata.

Revision ID: d5f9b2c83e10
Revises: c4e8a1b72d09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd5f9b2c83e10'
down_revision = 'c4e8a1b72d09'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('files', sa.Column('visual', postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column('files', 'visual')
