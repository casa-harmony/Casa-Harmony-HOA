"""drop dead ArReceipt.gl_journal_id

Revision ID: b1d2c3e4f5a6
Revises: 835a34b5853c
Create Date: 2026-08-15 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b1d2c3e4f5a6'
down_revision: Union[str, None] = '835a34b5853c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ArReceipt.gl_journal_id was never written: receipts post through the
    # GL batch path (GlJeBatch → GlBalance), not GlJournal. The column is dead
    # and a future caller could wrongly treat it as authoritative — remove it.
    op.drop_column('ar_receipts', 'gl_journal_id')


def downgrade() -> None:
    op.add_column('ar_receipts', sa.Column('gl_journal_id', sa.UUID(), nullable=True))
