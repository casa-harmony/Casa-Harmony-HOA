"""must_change_password flags

Revision ID: b019316ddbae
Revises: 232abeec7d72
Create Date: 2026-06-20 16:05:22.100984
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b019316ddbae'
down_revision: Union[str, None] = '232abeec7d72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Residents always receive a temp password → default true; existing rows true.
    op.add_column('residents', sa.Column('must_change_password', sa.Boolean(),
                  nullable=False, server_default=sa.text('true')))
    # Staff default false (seeded admins keep their known passwords); admin-created
    # users are flagged true in the API.
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(),
                  nullable=False, server_default=sa.text('false')))
    # NOTE: perf indexes from d7b1f0c2a9e1 live only in migrations; do NOT drop them.


def downgrade() -> None:
    op.drop_column('users', 'must_change_password')
    op.drop_column('residents', 'must_change_password')
    op.create_index('ix_ar_invoices_tenant_status', 'ar_invoices', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_ar_invoices_tenant_homeowner', 'ar_invoices', ['tenant_id', 'homeowner_id'], unique=False)
    op.create_index('ix_ap_invoices_tenant_vendor_status', 'ap_invoices', ['tenant_id', 'vendor_id', 'status'], unique=False)
    op.create_index('ix_ap_invoices_tenant_status', 'ap_invoices', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_ap_invoice_dist_tenant_ccid', 'ap_invoice_distributions', ['tenant_id', 'code_combination_id'], unique=False)
    # ### end Alembic commands ###
