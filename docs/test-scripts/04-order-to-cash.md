# Test Scripts — 4. Order-to-Cash (Assessments & Receipts)

HOA receivables: bulk monthly assessment billing (scales to ~1000 homeowners) and
homeowner receipts that post to the GL via Subledger Accounting.

Pre (all): demo HOA active; homeowners H-0001..H-0003 seeded; cash `1000-OPER` and
receivable `1100-OPER` combinations exist (seeded).

---

## TC-O2C-01 · Bulk monthly assessment run · P1
- **Role:** `ar.manage`; on **Receivables**.
- **Steps:** **Run Monthly Assessments** → invoice date 2026-03-01, due 2026-03-15, amount 250.00, type ASSESSMENT. Run.
- **Expected:** One **ASSESSMENT** invoice created per active homeowner; result shows `invoices_created ≥ 3` and `total_billed = 250 × count`.
- **Automated:** `tests/test_financials.py::test_bulk_assessment_run`.

## TC-O2C-02 · Assessment types (late fee / special) · P3
- **Steps:** Run assessment with type **LATE_FEE**, then **SPECIAL**.
- **Expected:** Invoices created with the chosen `invoice_type`; only `ASSESSMENT|LATE_FEE|SPECIAL` accepted (others rejected).

## TC-O2C-03 · Scale smoke — ~1000 homeowners · P2
- **Pre:** Seed/import ~1000 homeowners into an HOA (script or repeated API).
- **Steps:** Run an assessment for all; time the call and a subsequent homeowner list load.
- **Expected:** Run completes without timeout; list queries remain responsive (composite indexes on `ar_invoices(tenant_id, homeowner_id)` etc. are in place).

## TC-O2C-04 · Record a homeowner receipt → posts to GL · P1
- **Steps:** On Receivables, **Receipt** for H-0001 → number `RCPT-1001`, amount 100.00, date 2026-02-20, method ACH, fund OPER. Save.
- **Expected:** Receipt created (**APPLIED → ACCOUNTED**). A **draft GL batch** `AR Receipt RCPT-1001` (source **AR**) exists with **Dr Cash $100 / Cr Assessments Receivable $100** (fund OPER), balanced.
- **Automated:** `tests/test_financials.py::test_ar_receipt_posts_and_ledger_exports`.

## TC-O2C-05 · Receipt applied to an invoice updates balance · P2
- **Pre:** An AR invoice for H-0001 of $250.
- **Steps:** Record a receipt of $250 applied to that invoice.
- **Expected:** Invoice `amount_paid` increases; when fully paid, status → **PAID**.

## TC-O2C-06 · Reserve-fund receipt uses reserve cash · P2
- **Steps:** Record a receipt with **fund = RESV**.
- **Expected:** SLA posts to **reserve cash (1010)** and reserve receivable, keeping the reserve fund self-balancing (fund segregation).

## TC-O2C-07 · Receipt without required GL accounts errors clearly · P3
- **Pre:** Remove/disable the receivable or cash combination for a fund.
- **Steps:** Attempt a receipt in that fund.
- **Expected:** **422** — "Missing GL account for natural … / fund …" (no partial/unbalanced posting).

## TC-O2C-08 · Homeowner ledger reflects charges & payments · P2
- **Steps:** For H-0001 with at least one assessment and one receipt, **export the ledger** (script 07 covers the file).
- **Expected:** Ledger lists charges and payments chronologically with a running balance; balance due is correct.
