# Sample migration dataset + dry-run rehearsal

A small, self-consistent Princeton-style dataset for rehearsing the NetSuite-style
import (see `docs/DATA_MIGRATION.md`). Every file validates against the seeded demo
COA with **0 errors**. Replace the values with your real data for go-live; keep the
header rows.

## Files (load in this order)
| # | File | Record type | Depends on |
|---|------|-------------|------------|
| 1 | `01_homeowners.csv` | HOMEOWNER | — |
| 2 | `02_vendors.csv` | VENDOR | — |
| 3 | `03_vendor_bank.csv` | VENDOR_BANK | vendors |
| 4 | `04_ar_opening.csv` | AR_OPENING | homeowners, COA |
| 5 | `05_ap_open_invoice.csv` | AP_OPEN_INVOICE | vendors, COA |
| 6 | `06_po_open.csv` | PO_OPEN | vendors, COA |
| 7 | `07_delinquency_cases.csv` | DELINQUENCY_CASE | homeowners |
| 8 | `08_ar_receipts.csv` | AR_RECEIPT | homeowners |
| 9 | `09_ap_payments.csv` | AP_PAYMENT (1099) | vendors |

`05_ap_open_invoice.csv` shows the header+line pattern: the two `APINV-5001` rows share
one external id and become **one** invoice with two distribution lines (operating +
reserve fund).

## Rehearsal steps (Data Migration wizard)
1. Pick the record type (grouped by load order) and download its template to compare.
2. **Preview / map** your file — confirm the auto-suggested field mapping.
3. **Dry-run** — expect created counts with 0 errors; fix any flagged rows.
4. **Commit** masters first (1–3), then open transactions (4–7), then historical (8–9).
5. Re-run any file to confirm idempotency (skipped, not duplicated).
6. Download the per-row **report** for the audit file; **rollback** any batch if needed.

The COA strings used here (`0100-OPER-000-4000-0000-NONE`, `0100-OPER-100-5000-0000-NONE`,
`0100-RESV-000-6000-0000-NONE`, …) are from the demo seed — substitute your tenant's
concatenated COA combinations. Open AR/AP documents import as DRAFT (no GL post) and are
posted later through the normal controlled flow at cutover.
