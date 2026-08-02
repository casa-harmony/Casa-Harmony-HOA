"""migration_batches.mode + updated (P35 NetSuite-style import)

Revision ID: c4e1a8f93b07
Revises: b3d9c1a47e22
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "c4e1a8f93b07"
down_revision = "b3d9c1a47e22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("migration_batches", sa.Column("mode", sa.String(length=10),
                  nullable=False, server_default="ADD"))
    op.add_column("migration_batches", sa.Column("updated", sa.Integer(),
                  nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("migration_batches", "updated")
    op.drop_column("migration_batches", "mode")
