# Test Scripts — 7. Reports

Reporting and exports: trial balance, fund-based financial statements (xlsx + docx),
GL batch summary, homeowner ledger, and the COA structure export. All exports are
generated server-side and downloaded by the browser.

Pre (all): posted GL activity exists for a period (run scripts 03–05 first, posting
into **FEB-2026**). Role: `report.read`. On **General Ledger** / **Receivables**.

---

## TC-RPT-01 · Trial balance (fund-based) export · P1
- **Steps:** On GL, set period **FEB-2026**, click **Trial Balance ⬇**.
- **Expected:** An `.xlsx` downloads. It lists accounts grouped by **fund**, with Debit/Credit columns and a **TOTAL row where Σ Debit = Σ Credit**. Totals reconcile to `GET /gl/balances?period=FEB-2026`.
- **Automated:** export asserted in `tests/test_financials.py`.

## TC-RPT-02 · Financial statements — xlsx · P1
- **Steps:** Click **Financials (xlsx) ⬇** for FEB-2026.
- **Expected:** Workbook with a **Balance Sheet** sheet (Assets, Liabilities, Fund Balance/Equity by fund) and a **Revenues & Expenses** sheet (with **Net Surplus/(Deficit)**). Assets = Liabilities + Equity holds.
- **Automated:** `tests/test_financials.py`.

## TC-RPT-03 · Financial statements — docx · P2
- **Steps:** Click **Financials (docx) ⬇** for FEB-2026.
- **Expected:** A Word document with a cover heading, Balance Sheet tables, and the Statement of Revenues & Expenses; figures match the xlsx version.
- **Automated:** `tests/test_financials.py` (docx is a valid OOXML/zip).

## TC-RPT-04 · GL batch summary export · P2
- **Steps:** Open a batch → **⬇ xlsx** (or `GET /gl/batches/{id}/export`).
- **Expected:** Workbook lists each journal's lines (KFF account, fund, debit, credit) and a TOTAL row equal to the batch control totals.
- **Automated:** `tests/test_financials.py`.

## TC-RPT-05 · Homeowner ledger export · P2
- **Steps:** On Receivables, **Ledger ⬇** for H-0001.
- **Expected:** `.xlsx` with chronological charges/payments and a running **Balance**; final balance equals charges − payments.
- **Automated:** `tests/test_financials.py::test_ar_receipt_posts_and_ledger_exports`.

## TC-RPT-06 · COA structure export · P3
- **Steps:** On Chart of Accounts, export the structure (`GET /coa/structures/{id}/export`).
- **Expected:** Workbook with segments, value sets, and code combinations for the structure.
- **Automated:** COA export in `tests/test_api.py`.

## TC-RPT-07 · Empty-period report · P3
- **Steps:** Export trial balance / statements for a period with no postings (e.g., DEC-2026).
- **Expected:** A valid file downloads with headers and zero/empty totals (no error).

## TC-RPT-08 · Reports respect tenant isolation · P1
- **Steps:** Generate the trial balance for HOA A and HOA B.
- **Expected:** Each report contains only its own HOA's balances (RLS); no figures bleed across tenants.

## TC-RPT-09 · Reports require permission · P2
- **Steps:** As a user without `report.read`, attempt an export.
- **Expected:** **403 Forbidden**.
