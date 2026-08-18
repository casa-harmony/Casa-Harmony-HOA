"""fix service_ticket_comments RLS policy

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-08-17 12:00:00.000000

``service_ticket_comments``' policy (added in 835a34b5853c) was written as
just ``tenant_id = current_setting('app.current_tenant', true)::uuid`` —
missing the superadmin bypass and the NULLIF empty-string guard every other
tenant table's policy has. Elevated/superadmin sessions (platform tooling,
purge/admin scripts) can't see rows in this table, and an unset or empty GUC
raises `invalid input syntax for type uuid: ""` instead of matching no rows.
Bring it in line with the standard predicate used everywhere else.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_PREDICATE = "tenant_id = current_setting('app.current_tenant', true)::uuid"
NEW_PREDICATE = (
    "current_setting('app.is_superadmin', true) = 'on' OR "
    "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"
)


def upgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_service_ticket_comments ON service_ticket_comments")
    op.execute(
        f"CREATE POLICY tenant_isolation_service_ticket_comments ON service_ticket_comments "
        f"USING ({NEW_PREDICATE}) WITH CHECK ({NEW_PREDICATE})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_service_ticket_comments ON service_ticket_comments")
    op.execute(
        f"CREATE POLICY tenant_isolation_service_ticket_comments ON service_ticket_comments "
        f"USING ({OLD_PREDICATE})"
    )
