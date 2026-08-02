"""performance indexes for high-volume HOA tables (1000+ homeowners)

Composite indexes matching the hot query paths: per-tenant lookups joined with
the most selective filter (homeowner, vendor, account, status). Created
CONCURRENTLY-friendly names; safe and additive.

Revision ID: d7b1f0c2a9e1
Revises: c6a4544d0bed
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op

revision: str = "d7b1f0c2a9e1"
down_revision: Union[str, None] = "c6a4544d0bed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (index_name, table, columns)
INDEXES = [
    ("ix_ar_invoices_tenant_homeowner", "ar_invoices", ["tenant_id", "homeowner_id"]),
    ("ix_ar_invoices_tenant_status", "ar_invoices", ["tenant_id", "status"]),
    ("ix_ar_receipts_tenant_homeowner", "ar_receipts", ["tenant_id", "homeowner_id"]),
    ("ix_ap_invoices_tenant_vendor_status", "ap_invoices", ["tenant_id", "vendor_id", "status"]),
    ("ix_ap_invoices_tenant_status", "ap_invoices", ["tenant_id", "status"]),
    ("ix_po_headers_tenant_status", "po_headers", ["tenant_id", "status"]),
    ("ix_po_distributions_tenant_ccid", "po_distributions", ["tenant_id", "code_combination_id"]),
    ("ix_ap_invoice_dist_tenant_ccid", "ap_invoice_distributions", ["tenant_id", "code_combination_id"]),
    ("ix_gl_je_lines_tenant_ccid", "gl_je_lines", ["tenant_id", "code_combination_id"]),
    ("ix_gl_balances_tenant_period", "gl_balances", ["tenant_id", "period_name"]),
    ("ix_service_tickets_tenant_status", "service_tickets", ["tenant_id", "status"]),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.create_index(name, table, cols, unique=False)


def downgrade() -> None:
    for name, table, _cols in INDEXES:
        op.drop_index(name, table_name=table)
