"""Delete one or more HOAs (tenants) and everything scoped to them.

For removing test/demo communities that accumulated during development. This is
destructive and irreversible — it deletes every tenant-scoped row across all
tables, then the tenant itself, then any user left with no remaining membership.

    python -m scripts.purge_tenant --slug isolation-probe-29198a48 --slug alpha-fbc60e86
    python -m scripts.purge_tenant --slug some-hoa --yes    # skip the prompt

Runs as the migration/owner role so it can delete across every table regardless
of RLS. It refuses to touch the primary demo tenant unless --force is given.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import text

from app.core.database import session_for
from app.models.identity import Membership, Tenant, User

PROTECTED_SLUGS = {"casa-harmony"}

# Every table carrying a tenant_id, child-first so foreign keys are satisfied.
# Derived from the models at write time; a stray table just means a FK error
# that names it, which is easy to add here.
TENANT_TABLES_CHILD_FIRST = [
    # AR / collections / statements
    "statement_deliveries", "statement_runs", "dunning_logs", "dunning_rules",
    "payment_plan_installments", "payment_plans", "liens", "collection_cases",
    "ar_receipts", "ar_invoices", "ar_late_fee_rules", "ar_billing_plan_lines",
    "ar_billing_plans", "ar_homeowners",
    # resident portal
    "resident_units", "resident_otp_challenges", "residents",
    # AP / PO / receiving / vendors
    "ap_invoice_holds", "ap_invoice_distributions", "ap_payment_links",
    "ap_payment_schedules", "ap_payments", "ap_invoices",
    "rcv_transactions", "rcv_lines", "rcv_headers",
    "po_encumbrances", "po_lines", "purchase_orders",
    "supplier_bank_accounts", "supplier_contacts", "supplier_sites", "vendors",
    "distribution_sets", "payment_terms", "vendor_types",
    # cash / gateway / payments
    "gateway_transactions", "gateway_configs", "payment_tokens",
    "bank_statement_lines", "bank_statements", "bank_accounts", "banks",
    # GL / budget / periods / encumbrance
    "gl_journal_lines", "gl_journals", "gl_batches", "gl_posting_runs",
    "gl_balances", "gl_budget_lines", "gl_budgets",
    "budget_control", "budget_lines", "budget_versions",
    "encumbrance_settings", "accounting_periods",
    # fixed assets
    "reserve_study_components", "reserve_studies", "fixed_assets",
    # COA / KFF
    "code_combinations", "cross_validation_rules", "value_set_values",
    "value_sets", "coa_segments", "coa_structures",
    # service desk / approvals / notifications / compliance / migration
    "service_tickets", "approval_requests", "approval_rules",
    "approval_hierarchies", "notifications", "compliance_items",
    "migration_records", "migration_batches", "golive_status", "backup_runs",
    "scheduler_configs", "job_runs", "document_attachments",
    # identity (memberships before roles; tenant roles are tenant-scoped)
    "memberships", "audit_logs",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", action="append", default=[], help="HOA slug (repeatable)")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    ap.add_argument("--force", action="store_true", help="allow purging a protected slug")
    args = ap.parse_args()

    if not args.slug:
        print("Nothing to do: pass at least one --slug", file=sys.stderr)
        return 2

    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        targets = []
        for slug in args.slug:
            if slug in PROTECTED_SLUGS and not args.force:
                print(f"Refusing to purge protected slug {slug!r} (use --force).", file=sys.stderr)
                return 2
            t = db.query(Tenant).filter(Tenant.slug == slug).one_or_none()
            if t is None:
                print(f"  {slug}: not found, skipping")
                continue
            targets.append(t)

        if not targets:
            print("No matching tenants.")
            return 0

        print("About to permanently delete these HOAs and ALL their data:")
        for t in targets:
            print(f"  - {t.name}  (slug={t.slug}, id={t.id})")
        if not args.yes:
            if input("Type 'delete' to confirm: ").strip() != "delete":
                print("Aborted.")
                return 1

        # Resolve which candidate tables actually exist and carry a tenant_id,
        # once — probing per-tenant with try/except + rollback is slow over a
        # remote database and pollutes the transaction.
        existing = {r[0] for r in db.execute(text(
            "SELECT c.table_name FROM information_schema.columns c "
            "WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'"
        )).all()}
        tables = [t for t in TENANT_TABLES_CHILD_FIRST if t in existing]

        # Capture identifiers as plain strings; the ORM row is deleted below and
        # must not be touched afterwards.
        target_info = [(str(t.id), t.slug) for t in targets]
        for tid, slug in target_info:
            deleted = 0
            for table in tables:
                res = db.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :tid"), {"tid": tid}
                )
                deleted += res.rowcount or 0
            # tenant-scoped (non-system) roles
            db.execute(text("DELETE FROM role_permissions WHERE role_id IN "
                            "(SELECT id FROM roles WHERE tenant_id = :tid)"), {"tid": tid})
            db.execute(text("DELETE FROM roles WHERE tenant_id = :tid"), {"tid": tid})
            db.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tid})
            db.commit()
            print(f"  purged {slug}: {deleted} scoped rows + roles + tenant")

        # Users with no memberships left and not superadmin are orphans.
        orphans = db.execute(text(
            "SELECT id, email FROM users u WHERE u.is_superadmin = false "
            "AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)"
        )).all()
        for uid, email in orphans:
            db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": str(uid)})
            print(f"  removed orphaned user {email}")
        db.commit()

        print("Done.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
