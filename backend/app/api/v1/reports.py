"""Report catalog: the discoverable list of every standard report the app can
export.

The catalog is static because reports are scattered across the API modules as
``*/export`` endpoints (each owns its own permission check); this is the index
the Reports screen renders. Keep it in sync with the export endpoints — the
frontend groups by ``category`` and links each row to ``/reports/{id}``.
"""
from fastapi import APIRouter, Depends

from app.core.deps import require_active_tenant

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_active_tenant)])

# id → (name, category, description). Sourced from the ~40 */export endpoints
# across the API modules, one entry per report a staff member can actually run.
_CATALOG: list[dict] = [
    # --- GL / close -------------------------------------------------------
    {"id": "trial-balance", "name": "Trial Balance", "category": "FINANCIAL",
     "description": "Account balances for the period, with debit/credit totals"},
    {"id": "financial-statements", "name": "Financial Statements", "category": "FINANCIAL",
     "description": "Balance sheet, income statement and fund balances"},
    {"id": "budget-vs-actual", "name": "Budget vs Actual", "category": "BUDGET",
     "description": "Budgeted versus posted amounts per account for the period"},
    {"id": "board-report", "name": "Board Report", "category": "BOARD",
     "description": "Board-ready summary of the period's financial position"},
    {"id": "gl-batch", "name": "GL Batch Export", "category": "FINANCIAL",
     "description": "Journal lines of a posting batch, ready for the auditor"},
    {"id": "period-close-checklist", "name": "Period Close Checklist", "category": "FINANCIAL",
     "description": "What remains to be done before the period can close"},
    {"id": "period-trial-balance", "name": "Period Trial Balance", "category": "FINANCIAL",
     "description": "Trial balance for a single accounting period"},
    {"id": "chart-of-accounts", "name": "Chart of Accounts", "category": "COA",
     "description": "The COA structure and its segment values / code combinations"},

    # --- AR / billing / collections --------------------------------------
    {"id": "ar-aging", "name": "AR Aging", "category": "AR",
     "description": "Open receivables aged by due-date buckets"},
    {"id": "ar-summary", "name": "AR Summary", "category": "AR",
     "description": "Summarised receivables by account and fund"},
    {"id": "homeowner-ledger", "name": "Homeowner Ledger", "category": "AR",
     "description": "Full statement history for one homeowner account"},
    {"id": "ar-billing-register", "name": "Billing Register", "category": "AR",
     "description": "All assessments raised in the period"},
    {"id": "collections-aging", "name": "Collections Aging", "category": "COLLECTIONS",
     "description": "Collection cases and payment plans aged by status"},
    {"id": "collections-effectiveness", "name": "Collections Effectiveness", "category": "COLLECTIONS",
     "description": "Recovery rates and plan performance"},
    {"id": "delinquency-packet", "name": "Delinquency Packet", "category": "COLLECTIONS",
     "description": "Full board report showing aged arrears, cases, and active liens"},
    {"id": "dunning-effectiveness", "name": "Dunning Effectiveness", "category": "COLLECTIONS",
     "description": "Dunning-run outcomes and recovery by rule"},
    {"id": "statement-run-report", "name": "Statement Run Report", "category": "AR",
     "description": "Audit trail of a statement run: delivered, failed, balances"},

    # --- AP / payables / purchasing --------------------------------------
    {"id": "ap-payment-register", "name": "AP Payment Register", "category": "AP",
     "description": "Payments made in the period with method and bank"},
    {"id": "aged-payables", "name": "Aged Payables", "category": "AP",
     "description": "Open supplier invoices aged by due date"},
    {"id": "cash-requirements", "name": "Cash Requirements", "category": "AP",
     "description": "Upcoming payment obligations by due date"},
    {"id": "payables-register", "name": "Payables Register", "category": "AP",
     "description": "Supplier invoices and their approval state"},
    {"id": "ap-distributions", "name": "AP Distributions", "category": "AP",
     "description": "Invoice distributions to GL accounts"},
    {"id": "1099-forms", "name": "1099 Tax Forms", "category": "AP",
     "description": "Vendor 1099 filings for the tax year"},
    {"id": "vendors", "name": "Vendor List", "category": "AP",
     "description": "All suppliers with sites, contacts and bank accounts"},
    {"id": "purchase-orders", "name": "Purchase Orders", "category": "PURCHASING",
     "description": "PO register with approval and receipt status"},
    {"id": "encumbrance-register", "name": "Encumbrance Register", "category": "PURCHASING",
     "description": "Committed-but-unposted encumbrances"},
    {"id": "receiving-register", "name": "Receiving Register", "category": "PURCHASING",
     "description": "Received goods and services against POs"},
    {"id": "service-cost-summary", "name": "Service Cost Summary", "category": "SERVICE",
     "description": "Service-desk ticket costs by category and vendor"},

    # --- Cash / banking ---------------------------------------------------
    {"id": "bank-reconciliation", "name": "Bank Reconciliation", "category": "CASH",
     "description": "Bank statement vs book balance, with outstanding items"},
    {"id": "cash-flow", "name": "Cash Flow Forecast", "category": "CASH",
     "description": "Cash flow trend analysis"},
    {"id": "gateway-reconciliation", "name": "Payment Gateway Reconciliation", "category": "CASH",
     "description": "Gateway transactions vs posted receipts"},

    # --- Budget / fixed assets / compliance -------------------------------
    {"id": "budget-spread", "name": "Budget Spread", "category": "BUDGET",
     "description": "Annual budget spread across periods"},
    {"id": "fixed-asset-register", "name": "Fixed Asset Register", "category": "FIXED_ASSETS",
     "description": "Capital assets with cost, depreciation and net book value"},
    {"id": "depreciation-forecast", "name": "Depreciation Forecast", "category": "FIXED_ASSETS",
     "description": "Projected depreciation by asset over time"},
    {"id": "reserve-utilization", "name": "Reserve Study Utilization", "category": "FIXED_ASSETS",
     "description": "Reserve study components and funding progress"},
    {"id": "compliance-health", "name": "Compliance Health Metrics", "category": "COMPLIANCE",
     "description": "Metrics and counts for compliance tracking"},
    {"id": "compliance-package", "name": "Compliance Package", "category": "COMPLIANCE",
     "description": "Board compliance reporting package"},
    {"id": "cutover-report", "name": "Cutover Report", "category": "COMPLIANCE",
     "description": "Data migration cutover results"},
    {"id": "go-live-execution", "name": "Go-Live Execution Report", "category": "COMPLIANCE",
     "description": "Execution status of the go-live checklist"},
    {"id": "privacy-data-export", "name": "Data Export (Privacy)", "category": "COMPLIANCE",
     "description": "CCPA/right-to-access export of a resident's data"},
    {"id": "privacy-compliance", "name": "Privacy Compliance Report", "category": "COMPLIANCE",
     "description": "Privacy requests and erasure activity"},

    # --- Resident portal / documents -------------------------------------
    {"id": "resident-statement", "name": "Resident Statement", "category": "PORTAL",
     "description": "Statement for a resident's unit: assessments, payments, balance"},
    {"id": "resident-ledger", "name": "Resident Ledger", "category": "PORTAL",
     "description": "Full ledger history for a resident's unit"},
    {"id": "document-index", "name": "Document Index", "category": "DOCUMENTS",
     "description": "All documents on file for the community"},
]


@router.get("/catalog")
def catalog():
    return _CATALOG


@router.get("/{report_id}")
def run_report(report_id: str, format: str = "pdf"):
    # Placeholder for frontend compatibility; the real exports are the
    # per-module */export endpoints listed in the catalog above.
    return {"status": "ok"}
