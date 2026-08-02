"""Central permission catalog and the built-in system roles.

Permissions are coarse capability codes checked by the RBAC dependency. System
roles (SUPERADMIN, SYSADMIN, HOA_ADMIN, ACCOUNTANT, VIEWER) are seeded from
these definitions. SUPERADMIN implicitly holds every permission.
"""
from __future__ import annotations

# code -> (category, description)
PERMISSIONS: dict[str, tuple[str, str]] = {
    # Platform administration
    "tenant.create": ("Platform", "Create new HOA tenants"),
    "tenant.read": ("Platform", "View tenant details"),
    "tenant.update": ("Platform", "Update tenant configuration"),
    "tenant.suspend": ("Platform", "Suspend or activate tenants"),
    # User / role administration
    "user.manage": ("Security", "Create and manage users"),
    "role.manage": ("Security", "Create and assign roles"),
    "membership.manage": ("Security", "Grant/revoke HOA memberships"),
    # Chart of Accounts / KFF
    "coa.structure.manage": ("COA", "Create/modify COA flexfield structures"),
    "coa.segment.manage": ("COA", "Define and order COA segments"),
    "coa.valueset.manage": ("COA", "Manage value sets and values"),
    "coa.combination.manage": ("COA", "Create/validate code combinations"),
    "coa.read": ("COA", "View Chart of Accounts configuration"),
    "coa.export": ("COA", "Export COA structure reports"),
    # Audit
    "audit.read": ("Audit", "View audit logs"),
    # Subledgers / GL
    "gl.journal.manage": ("Ledger", "Create and post GL journals"),
    "ar.manage": ("Ledger", "Manage AR homeowners and invoices"),
    # Payments (PCI)
    "payment.manage": ("Payments", "Tokenize and manage payment methods"),
    # Privacy / compliance
    "privacy.manage": ("Compliance", "Process data-subject (CCPA) requests"),
    # Masters
    "vendor.manage": ("Masters", "Manage suppliers/vendors"),
    "bank.manage": ("Masters", "Manage banks and bank accounts"),
    # Procurement
    "po.manage": ("Procurement", "Create and edit purchase orders/contracts"),
    "po.approve": ("Procurement", "Approve purchase orders/contracts"),
    "po.receive": ("Procurement", "Record receipts and inspect/accept deliveries"),
    # Payables
    "ap.manage": ("Payables", "Enter and edit AP invoices"),
    "ap.approve": ("Payables", "Approve AP invoices"),
    # Receivables
    "ar.receipt.manage": ("Receivables", "Record homeowner receipts"),
    # General Ledger
    "gl.batch.manage": ("Ledger", "Create/prepare GL journal batches"),
    "gl.batch.approve": ("Ledger", "Approve and post GL journal batches"),
    "gl.period.manage": ("Ledger", "Open/close accounting periods and run year-end close"),
    "report.read": ("Ledger", "Run financial reports (trial balance, ledgers)"),
    # Service Desk
    "ticket.manage": ("Service Desk", "Create and manage service tickets"),
    # Approvals configuration
    "approval.config": ("Security", "Configure approval hierarchies"),
    # Budgets
    "budget.manage": ("Ledger", "Set GL budget amounts; create/edit budget versions"),
    "budget.approve": ("Ledger", "Approve budget versions and set budgetary control"),
    # AP setup (payment terms, vendor types, distribution sets, payment methods)
    "ap.config": ("Payables", "Configure payment terms, vendor types, distribution sets"),
    # AP payments
    "ap.pay": ("Payables", "Create, void, and stop vendor payments"),
    # Cash management / bank reconciliation
    "cash.manage": ("Cash", "Manage bank accounts, statements, and reconciliation"),
    # Fixed assets & reserve studies
    "fa.manage": ("Fixed Assets", "Manage fixed assets, depreciation, and reserve studies"),
    # Go-live / compliance
    "compliance.manage": ("Compliance", "View go-live checklist, health, and compliance reports"),
    # Document management
    "document.manage": ("Documents", "Upload, view, and manage document attachments"),
    # Collections / delinquency
    "collections.manage": ("Receivables", "Manage delinquency, payment plans, liens, write-offs"),
    # Scheduled automation
    "scheduler.manage": ("Platform", "Configure scheduled runs and trigger jobs"),
    # Data migration
    "data.migrate": ("Platform", "Import/migrate legacy data and roll back batches"),
    # Resident portal administration
    "resident.manage": ("Receivables", "Manage resident logins and unit links"),
}

# role code -> (name, description, permission codes | "*")
SYSTEM_ROLES: dict[str, tuple[str, str, object]] = {
    "SUPERADMIN": ("Platform Super Administrator", "Full platform-wide control.", "*"),
    "SYSADMIN": (
        "System Administrator",
        "Manages one or more HOAs: tenants, users, roles, and COA.",
        [
            "tenant.read",
            "tenant.update",
            "user.manage",
            "role.manage",
            "membership.manage",
            "coa.structure.manage",
            "coa.segment.manage",
            "coa.valueset.manage",
            "coa.combination.manage",
            "coa.read",
            "coa.export",
            "audit.read",
            "gl.journal.manage",
            "ar.manage",
            "payment.manage",
            "privacy.manage",
            "vendor.manage", "bank.manage", "ap.config", "po.manage", "po.approve",
            "ap.manage", "ap.approve", "ap.pay", "po.receive", "cash.manage", "fa.manage", "document.manage", "collections.manage", "scheduler.manage", "ar.receipt.manage",
            "gl.batch.manage", "gl.batch.approve", "gl.period.manage", "report.read", "ticket.manage",
            "approval.config", "budget.manage", "budget.approve", "compliance.manage", "resident.manage", "data.migrate",
        ],
    ),
    "HOA_ADMIN": (
        "HOA Administrator",
        "Administers a single HOA's setup and COA.",
        [
            "user.manage",
            "membership.manage",
            "coa.segment.manage",
            "coa.valueset.manage",
            "coa.combination.manage",
            "coa.read",
            "coa.export",
            "audit.read",
            "gl.journal.manage",
            "ar.manage",
            "payment.manage",
            "vendor.manage", "bank.manage", "ap.config", "po.manage", "po.approve",
            "ap.manage", "ap.approve", "ap.pay", "po.receive", "cash.manage", "fa.manage", "document.manage", "collections.manage", "scheduler.manage", "ar.receipt.manage",
            "gl.batch.manage", "gl.batch.approve", "gl.period.manage", "report.read",
            "ticket.manage", "approval.config", "budget.manage", "budget.approve", "compliance.manage", "resident.manage", "data.migrate",
        ],
    ),
    "ACCOUNTANT": (
        "Accountant / Controller",
        "Maintains the Chart of Accounts, subledgers, and journals.",
        [
            "coa.valueset.manage", "coa.combination.manage", "coa.read", "coa.export",
            "gl.journal.manage", "ar.manage",
            "vendor.manage", "bank.manage", "po.manage", "po.receive", "ap.manage",
            "ar.receipt.manage", "gl.batch.manage", "gl.batch.approve", "gl.period.manage", "report.read",
            "budget.manage", "budget.approve", "ap.pay", "ap.config", "cash.manage", "fa.manage", "document.manage", "collections.manage", "scheduler.manage",
        ],
    ),
    "VIEWER": ("Read-only", "Read-only access to COA configuration.", ["coa.read"]),
}
