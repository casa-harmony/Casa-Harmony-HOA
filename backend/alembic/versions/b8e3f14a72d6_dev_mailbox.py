"""dev mailbox: captured outbound email/SMS for in-app testing

Gives the application its own inbox so invite links, password resets and OTP
codes can be read back during testing without owning a real mailbox for every
test resident and staff account.

The table holds live secrets on purpose — tokens and one-time codes sit in the
body verbatim, which is the whole point — so it is treated like the identity
tables rather than like ordinary tenant data:

* it carries ``is_sandbox`` and gets the same ``sandbox_partition`` policy as
  ``tenants`` and ``users``, so a developer never reads a live resident's reset
  token and the live side never sees sandbox noise;
* it also gets the restrictive ``sandbox_tenant_visible`` policy every other
  tenant-scoped table has, since ``tenant_id`` is set when a message is sent
  inside a community;
* the API on top is SUPERADMIN-only and off in production by default
  (``DEV_MAILBOX_ENABLED``).

Revision ID: b8e3f14a72d6
Revises: d7c2a91b4e05
Create Date: 2026-08-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b8e3f14a72d6"
down_revision: Union[str, None] = "d7c2a91b4e05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SANDBOX_PREDICATE = (
    "coalesce(current_setting('app.sandbox', true), 'off') = 'any' "
    "OR is_sandbox = (coalesce(current_setting('app.sandbox', true), 'off') = 'on')"
)

_TENANT_VISIBLE = (
    "dev_mailbox.tenant_id IS NULL "
    "OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = dev_mailbox.tenant_id)"
)


def upgrade() -> None:
    op.create_table(
        "dev_mailbox",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column("to_address", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=500)),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column(
            "tenant_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
        ),
        sa.Column("is_sandbox", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.Column("updated_by", sa.dialects.postgresql.UUID(as_uuid=True)),
    )
    op.create_index("ix_dev_mailbox_channel", "dev_mailbox", ["channel"])
    op.create_index("ix_dev_mailbox_to_address", "dev_mailbox", ["to_address"])
    op.create_index("ix_dev_mailbox_status", "dev_mailbox", ["status"])
    op.create_index("ix_dev_mailbox_tenant_id", "dev_mailbox", ["tenant_id"])
    op.create_index("ix_dev_mailbox_is_sandbox", "dev_mailbox", ["is_sandbox"])
    # The inbox is read newest-first, always.
    op.create_index("ix_dev_mailbox_created_at", "dev_mailbox", [sa.text("created_at DESC")])

    op.execute("ALTER TABLE dev_mailbox ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY sandbox_partition ON dev_mailbox "
        f"USING ({_SANDBOX_PREDICATE}) WITH CHECK ({_SANDBOX_PREDICATE})"
    )
    op.execute(
        f"CREATE POLICY sandbox_tenant_visible ON dev_mailbox AS RESTRICTIVE "
        f"USING ({_TENANT_VISIBLE}) WITH CHECK ({_TENANT_VISIBLE})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS sandbox_tenant_visible ON dev_mailbox")
    op.execute("DROP POLICY IF EXISTS sandbox_partition ON dev_mailbox")
    op.drop_table("dev_mailbox")
