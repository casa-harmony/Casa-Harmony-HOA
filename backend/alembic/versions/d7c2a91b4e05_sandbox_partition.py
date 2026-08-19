"""sandbox partition: developer superadmin isolated from live data

Adds a second, mutually-invisible universe inside the same database so a
developer can exercise the real application — create communities, users,
residents, invoices — without any of it reaching (or being reachable from) the
live tenants. No separate deployment, no separate database.

The partition is a third RLS GUC, ``app.sandbox``, bound per transaction from
the caller's token (see app/core/database.py):

* ``'on'``   – the session sees only sandbox tenants/users
* ``'off'``  – the session sees only live tenants/users (the default)
* ``'any'``  – both; used *only* by the login route, which must find a user
               before it knows which side that user belongs to

Two mechanisms enforce it:

1. ``tenants`` and ``users`` get a policy keyed directly on ``is_sandbox``.
   There is deliberately **no superadmin bypass** here — that is what makes the
   isolation mutual: the live SUPERADMIN cannot list sandbox communities and
   the developer SUPERADMIN cannot list live ones.

2. Every tenant-scoped table gets an ``AS RESTRICTIVE`` policy requiring its
   tenant row to be visible. Restrictive policies AND with the permissive ones
   already in place, so this closes the ``app.is_superadmin = 'on'`` bypass for
   sandbox purposes without rewriting any existing policy. Because the subquery
   reads ``tenants``, whose own RLS is in force for the non-owner app role, a
   row is reachable only when its tenant is on the caller's side of the
   partition.

Revision ID: d7c2a91b4e05
Revises: e4f5a6b7c8d9
Create Date: 2026-08-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d7c2a91b4e05"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 'any' is the login route's mode; NULL (GUC unset) falls back to live so any
# caller that predates this migration — scripts, jobs, tests — stays on 'off'.
_SANDBOX_PREDICATE = (
    "coalesce(current_setting('app.sandbox', true), 'off') = 'any' "
    "OR is_sandbox = (coalesce(current_setting('app.sandbox', true), 'off') = 'on')"
)


def _visible(table: str) -> str:
    """Predicate: this row's tenant is visible on the caller's side.

    ``tenant_id IS NULL`` rows are platform-level, not tenant data — system
    roles and platform audit entries — and must stay reachable from both sides.
    """
    return (
        f"{table}.tenant_id IS NULL "
        f"OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = {table}.tenant_id)"
    )


def _tenant_tables(conn) -> list[str]:
    """Every public table carrying a tenant_id, discovered from the schema.

    Derived rather than hardcoded for the same reason scripts/purge_tenant.py
    does it: the hardcoded list drifted and silently skipped tables.
    """
    rows = conn.execute(sa.text(
        "SELECT c.table_name FROM information_schema.columns c "
        "JOIN information_schema.tables t "
        "  ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
        "WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' "
        "  AND t.table_type = 'BASE TABLE' "
        "ORDER BY c.table_name"
    )).all()
    return [r[0] for r in rows]


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("is_sandbox", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("is_sandbox", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # --- The partition itself, on the two platform-global tables ---
    for table in ("tenants", "users"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY sandbox_partition ON {table} "
            f"USING ({_SANDBOX_PREDICATE}) WITH CHECK ({_SANDBOX_PREDICATE})"
        )

    # --- Restrictive backstop on every tenant-scoped table ---
    conn = op.get_bind()
    for table in _tenant_tables(conn):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY sandbox_tenant_visible ON {table} AS RESTRICTIVE "
            f"USING ({_visible(table)}) WITH CHECK ({_visible(table)})"
        )


def downgrade() -> None:
    conn = op.get_bind()
    for table in _tenant_tables(conn):
        op.execute(f"DROP POLICY IF EXISTS sandbox_tenant_visible ON {table}")
    for table in ("tenants", "users"):
        op.execute(f"DROP POLICY IF EXISTS sandbox_partition ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_column("users", "is_sandbox")
    op.drop_column("tenants", "is_sandbox")
