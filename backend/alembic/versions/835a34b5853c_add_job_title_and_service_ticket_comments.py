"""add_job_title_and_service_ticket_comments

Revision ID: 835a34b5853c
Revises: 3d9c0ff90050
Create Date: 2026-08-14 13:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '835a34b5853c'
down_revision: Union[str, None] = '3d9c0ff90050'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('users', sa.Column('job_title', sa.String(length=200), nullable=True))
    op.create_table('service_ticket_comments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('ticket_id', sa.UUID(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=False),
        sa.Column('is_public', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ticket_id'], ['service_tickets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_service_ticket_comments_tenant_id'), 'service_ticket_comments', ['tenant_id'], unique=False)
    op.execute('ALTER TABLE service_ticket_comments ENABLE ROW LEVEL SECURITY')
    op.execute(
        "CREATE POLICY tenant_isolation_service_ticket_comments ON service_ticket_comments "
        "USING (tenant_id = current_setting('app.current_tenant', true)::uuid);"
    )


def downgrade() -> None:
    op.drop_table('service_ticket_comments')
    op.drop_column('users', 'job_title')
