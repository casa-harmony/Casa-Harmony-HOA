"""tenant is_demo flag

Marks a tenant as sample/demo data so it can be hidden from community lists by
default (GET /tenants excludes it unless include_demo=true is passed) without
deleting it. Not an RLS/security boundary — a display flag only.

Revision ID: d0d87e7cfe34
Revises: c4e1a8f93b07
Create Date: 2026-08-14 09:23:14.572979
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd0d87e7cfe34'
down_revision: Union[str, None] = 'c4e1a8f93b07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("tenants", "is_demo")
