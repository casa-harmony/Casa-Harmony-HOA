"""row-level security policies + app role grants

Enables PostgreSQL Row-Level Security so tenant isolation is enforced by the
database itself. Policies read two session GUCs set per request/transaction by
the application (see app/core/database.py):

* ``app.current_tenant``  – active HOA UUID
* ``app.is_superadmin``   – ``'on'`` for the platform SUPERADMIN

The application connects as the non-owner role ``casa_app`` (NOSUPERUSER,
NOBYPASSRLS), so these policies are always in force for it.

Revision ID: a1b2c3d4e5f6
Revises: fd9d0e868ac5
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "fd9d0e868ac5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "casa_app"

# Tables with a NOT NULL tenant_id → standard isolation policy.
TENANT_TABLES = [
    "memberships",
    "kff_structures",
    "kff_value_sets",
    "kff_value_set_values",
    "kff_segments",
    "kff_cross_validation_rules",
    "kff_cross_validation_rule_lines",
    "gl_code_combinations",
    "payment_tokens",
]

_TENANT_PREDICATE = (
    "current_setting('app.is_superadmin', true) = 'on' "
    "OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
)


def upgrade() -> None:
    # --- Standard tenant-scoped tables ---
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING ({_TENANT_PREDICATE}) WITH CHECK ({_TENANT_PREDICATE})"
        )

    # --- roles: system roles (tenant_id IS NULL) are visible to everyone ---
    op.execute("ALTER TABLE roles ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY role_isolation ON roles "
        f"USING (tenant_id IS NULL OR {_TENANT_PREDICATE}) "
        f"WITH CHECK (tenant_id IS NULL OR {_TENANT_PREDICATE})"
    )

    # --- audit_logs: append-only. Anyone may INSERT; reads are tenant-scoped;
    #     UPDATE/DELETE are denied (no policy → default deny for non-owner). ---
    op.execute("ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (true)")
    op.execute(
        "CREATE POLICY audit_select ON audit_logs FOR SELECT "
        f"USING ({_TENANT_PREDICATE} OR tenant_id IS NULL "
        "AND current_setting('app.is_superadmin', true) = 'on')"
    )

    # --- Privileges for the restricted application role ---
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"
    )
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}")
    # Future tables/sequences created by later migrations inherit these grants.
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS audit_select ON audit_logs")
    op.execute("DROP POLICY IF EXISTS audit_insert ON audit_logs")
    op.execute("ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS role_isolation ON roles")
    op.execute("ALTER TABLE roles DISABLE ROW LEVEL SECURITY")
    for table in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
