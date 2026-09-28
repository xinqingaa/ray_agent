"""create runs and events tables, drop sessions.events

W3：运行与事件改为独立表，数据库是事件的事实源。不转换旧数据，开发库按 API 指南重建。

Revision ID: 5b7e2c9d4a10
Revises: 0e0d242438bc
Create Date: 2026-09-28 18:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '5b7e2c9d4a10'
down_revision: Union[str, Sequence[str], None] = '0e0d242438bc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'runs',
        sa.Column('id', sa.String(length=255), nullable=False),
        sa.Column('session_id', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('reason', sa.String(length=64), nullable=True),
        sa.Column('started_at', postgresql.TIMESTAMP(precision=3), nullable=False),
        sa.Column('ended_at', postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column('turns', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('model_requests', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('tool_calls', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('prompt_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('completion_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('cached_tokens', sa.Integer(), nullable=True),
        sa.Column('config_snapshot', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name='fk_runs_session_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_runs_session_id', 'runs', ['session_id'], unique=False)
    op.create_index('uq_runs_active_session', 'runs', ['session_id'], unique=True,
                    postgresql_where=sa.text("status IN ('running', 'waiting')"))

    op.create_table(
        'events',
        sa.Column('session_id', sa.String(length=255), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('run_id', sa.String(length=255), nullable=True),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(precision=3), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name='fk_events_session_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['run_id'], ['runs.id'], name='fk_events_run_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id', 'seq', name='pk_events_session_seq'),
    )
    op.create_index('ix_events_run_id', 'events', ['run_id'], unique=False)

    op.drop_column('sessions', 'events')


def downgrade() -> None:
    op.add_column('sessions', sa.Column('events', postgresql.JSONB(astext_type=sa.Text()),
                                        server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.drop_index('ix_events_run_id', table_name='events')
    op.drop_table('events')
    op.drop_index('uq_runs_active_session', table_name='runs')
    op.drop_index('ix_runs_session_id', table_name='runs')
    op.drop_table('runs')
