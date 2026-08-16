"""vendor category/w9/status normalisation, AR homeowner account uniqueness

Revision ID: c2d3e4f5a6b7
Revises: b1d2c3e4f5a6
Create Date: 2026-08-16 12:00:00.000000

Two independent fixes bundled because both were found in the same QA pass:

1. Vendors: the "Add vendor" screen has always sent `category`, which the
   `ap_suppliers` table never had a column for — every vendor create from the
   UI failed with a 422. Add it, plus `w9_on_file` (the paperwork-compliance
   flag the Vendors screen already renders). Also normalise `status` to
   upper-case: it was stored lower-case ("active") while every other status
   column in this schema (PoHeader, ApInvoice, …) is upper-case, and the
   frontend's `status === "ACTIVE"` checks were silently never matching.

2. AR homeowners: `account_number` had no uniqueness constraint. Two rows
   with the same account number for the same tenant were created in
   production during testing, and a monthly assessment run billed the same
   unit twice. Add the constraint the model should have had from the start.
   This migration does NOT delete the pre-existing duplicate — that is
   tenant data and needs an operator decision (merge vs. delete), not a
   migration silently picking one. Deduplicate manually before upgrading,
   or this migration will fail on the UNIQUE index build.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1d2c3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ap_suppliers', sa.Column('category', sa.String(length=80), nullable=True))
    op.add_column(
        'ap_suppliers',
        sa.Column('w9_on_file', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column('ap_suppliers', 'w9_on_file', server_default=None)

    # Backfill existing rows, then flip the column default for new ones.
    op.execute("UPDATE ap_suppliers SET status = upper(status)")
    op.alter_column('ap_suppliers', 'status', server_default='ACTIVE')

    # Will fail loudly if a duplicate (tenant_id, account_number) already
    # exists — see the module docstring. Deduplicate first if it does.
    op.create_unique_constraint(
        'uq_ar_homeowners_tenant_account', 'ar_homeowners', ['tenant_id', 'account_number']
    )


def downgrade() -> None:
    op.drop_constraint('uq_ar_homeowners_tenant_account', 'ar_homeowners', type_='unique')
    op.alter_column('ap_suppliers', 'status', server_default='active')
    op.execute("UPDATE ap_suppliers SET status = lower(status)")
    op.drop_column('ap_suppliers', 'w9_on_file')
    op.drop_column('ap_suppliers', 'category')
