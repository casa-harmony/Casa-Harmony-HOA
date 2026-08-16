"""gateway config fee/enabled fields

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-16 13:00:00.000000

The Gateway screen (`app/(app)/gateway/page.tsx`) has always rendered
`config.card_fee_pct`, `card_fee_flat`, `ach_fee_flat`, `card_enabled`,
`ach_enabled` and `pass_fees_to_resident` — none of which existed on
`GatewayConfig` or `GatewayConfigOut`, so every one of those fields rendered
as the literal string "undefined". Add them with the same defaults the mock
data layer already used (lib/mock-data/mock-api.ts), so live and mock agree.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('gateway_configs', sa.Column(
        'card_enabled', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('gateway_configs', sa.Column(
        'ach_enabled', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('gateway_configs', sa.Column(
        'card_fee_pct', sa.Numeric(5, 2), nullable=False, server_default='2.90'))
    op.add_column('gateway_configs', sa.Column(
        'card_fee_flat', sa.Numeric(18, 2), nullable=False, server_default='0.30'))
    op.add_column('gateway_configs', sa.Column(
        'ach_fee_flat', sa.Numeric(18, 2), nullable=False, server_default='1.50'))
    op.add_column('gateway_configs', sa.Column(
        'pass_fees_to_resident', sa.Boolean(), nullable=False, server_default=sa.false()))
    for col in ('card_enabled', 'ach_enabled', 'card_fee_pct', 'card_fee_flat',
                'ach_fee_flat', 'pass_fees_to_resident'):
        op.alter_column('gateway_configs', col, server_default=None)


def downgrade() -> None:
    for col in ('pass_fees_to_resident', 'ach_fee_flat', 'card_fee_flat',
                'card_fee_pct', 'ach_enabled', 'card_enabled'):
        op.drop_column('gateway_configs', col)
