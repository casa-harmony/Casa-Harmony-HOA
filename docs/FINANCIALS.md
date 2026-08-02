# Financial Modules (Oracle EBS-aligned) & Fund Accounting

This document covers the Procure-to-Pay, Order-to-Cash, and General Ledger flows
added per Grok Prompts 2 & 3, and how fund accounting is enforced end-to-end.

## Oracle EBS table alignment

| Casa Harmony | Oracle EBS | Notes |
|---|---|---|
| `ap_suppliers` | AP_SUPPLIERS / PO_VENDORS | Vendor master; Tax ID encrypted at rest |
| `ap_banks` / `ap_bank_accounts` / `ap_bank_account_uses` | AP_BANKS_ALL / AP_BANK_ACCOUNTS_ALL / AP_BANK_ACCOUNT_USES_ALL | Account numbers encrypted; routing enrichment |
| `po_headers` / `po_lines` / `po_distributions` | PO_HEADERS_ALL / PO_LINES_ALL / PO_DISTRIBUTIONS_ALL | KFF distributions |
| `ap_invoices` / `ap_invoice_lines` / `ap_invoice_distributions` | AP_INVOICES_ALL / AP_INVOICE_LINES_ALL / AP_INVOICE_DISTRIBUTIONS_ALL | 2-way PO match |
| `ar_homeowners` / `ar_invoices` / `ar_receipts` | (HOA customer + AR_*) | Assessments, late fees, receipts |
| `gl_je_batches` / `gl_je_headers` / `gl_je_lines` / `gl_balances` | GL_JE_BATCHES / GL_JE_HEADERS / GL_JE_LINES / GL_BALANCES | Control totals + period balances |
| `approval_hierarchies` / `approval_rules` / `approval_requests` / `approval_actions` | (AME-style approvals) | Amount-banded multi-level |

Every table carries `tenant_id`, the Who columns, status/approval fields, and RLS.

## Procure-to-Pay (P2P)

```
Vendor → Purchase Order (lines + KFF distributions)
      → submit → multi-level approval (by amount)
      → AP Invoice (2-way PO match: invoice ≤ PO)
      → submit → approval
      → Subledger Accounting "Create Accounting"
         → draft GL_JE_BATCH (Dr expense distributions / Cr AP, PER FUND)
      → GL accountant: submit → approve (control totals) → POST
      → GL_BALANCES updated by period + code combination
```

## Order-to-Cash (O2C)

```
Homeowner → monthly Assessment run (bulk AR invoices for all active homeowners)
         → Receipt (Dr Cash / Cr Assessments Receivable, per fund)
         → Subledger Accounting → draft GL batch → approve → POST → GL_BALANCES
Homeowner Ledger export (xlsx): charges, payments, running balance.
```

## Fund accounting — how it is guaranteed

1. The COA's **Fund** segment (Operating / Reserve / Special) is a flexfield
   qualifier on the structure.
2. `services/distributions.resolve_combination` **rejects any distribution whose
   account combination lacks a Fund value** — so a PO/AP distribution can never be
   booked without a fund.
3. Subledger Accounting books the offsetting liability/cash lines **per fund**
   (grouping distributions by `fund_value`), so every fund's journal nets to zero.
4. `GL_BALANCES` rows carry `fund_value`; the trial balance export groups by fund.

The result: each fund is self-balancing and independently reportable, satisfying
HOA fund-accounting and reserve-segregation requirements.

## Approval workflow (state machine)

`required_levels` = number of hierarchy rules whose `min_amount ≤ document amount`.
A request advances level-by-level (`current_level`) until satisfied or rejected.
With no enabled hierarchy for a document type, the document auto-approves.
On final approval, the document's router finalizes status and (for AP) triggers
Create Accounting.

## Exports

| Report | Endpoint | Format |
|---|---|---|
| Trial balance (fund-based) | `GET /gl/trial-balance/export?period=MON-YYYY` | xlsx |
| Financial statements (fund-based Balance Sheet + Revenues & Expenses) | `GET /gl/financial-statements/export?period=MON-YYYY&fmt=xlsx\|docx` | xlsx / docx |
| Budget vs Actual (by Fund/account) | `GET /gl/budget-vs-actual/export?period=MON-YYYY` | xlsx |
| Board report (fund-based, board-ready) | `GET /gl/board-report/export?period=MON-YYYY` | PDF |
| AR aging / collections / AR by fund | `GET /subledger/{ar-aging,collections,ar-summary}/export` | xlsx |
| Compliance summary (SOC 2 / PCI / ISO / CCPA) | `GET /privacy/compliance-report/export` | PDF |
| GL batch summary (journals + lines + KFF) | `GET /gl/batches/{id}/export` | xlsx |
| Homeowner ledger | `GET /subledger/homeowners/{id}/ledger/export` | xlsx |
| COA structure | `GET /coa/structures/{id}/export` | xlsx |

## Service Desk integration hook

The Service Desk (`service_tickets`) is the "Service Desk" half of the product. A
ticket with a `vendor_id` and `estimated_cost` can spawn a Purchase Order via
`POST /service-desk/tickets/{id}/create-po` (choosing an expense KFF account), so
maintenance/service requests flow into the same PO → AP → approval → GL pipeline.
This is the basic hook for "future tickets drive expenses."
