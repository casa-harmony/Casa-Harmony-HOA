"""migration_batches + migration_records (P34 data migration)

Revision ID: b3d9c1a47e22
Revises: 8f7a60f004e5
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b3d9c1a47e22"
down_revision = "8f7a60f004e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "migration_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_number", sa.String(length=40), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=15), nullable=False, server_default="DRY_RUN"),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_migration_batches_batch_number"), "migration_batches", ["batch_number"])
    op.create_index(op.f("ix_migration_batches_tenant_id"), "migration_batches", ["tenant_id"])

    op.create_table(
        "migration_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("source_ref", sa.String(length=120), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("row_num", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action", sa.String(length=10), nullable=False, server_default="CREATE"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["batch_id"], ["migration_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_migration_records_batch_id"), "migration_records", ["batch_id"])
    op.create_index(op.f("ix_migration_records_entity_type"), "migration_records", ["entity_type"])
    op.create_index(op.f("ix_migration_records_source_ref"), "migration_records", ["source_ref"])
    op.create_index(op.f("ix_migration_records_tenant_id"), "migration_records", ["tenant_id"])

    predicate = ("current_setting('app.is_superadmin', true) = 'on' OR "
                 "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid")
    for table in ("migration_batches", "migration_records"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY tenant_isolation ON {table} "
                   f"USING ({predicate}) WITH CHECK ({predicate})")


def downgrade() -> None:
    for table in ("migration_batches", "migration_records"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.drop_table("migration_records")
    op.drop_table("migration_batches")
