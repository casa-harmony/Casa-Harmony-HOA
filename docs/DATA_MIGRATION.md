# Data Migration — NetSuite-style CSV Import (P34–P35)

Idempotent, auditable import of legacy HOA data into the ERP, modeled on the NetSuite
CSV Import Assistant. Drive it from the **Data Migration** admin page (permission
`data.migrate`; SYSADMIN/HOA_ADMIN) or the `/api/v1/migration/*` API.

## The NetSuite-style model
- **External ID** — every source row carries the legacy key (the `external_id` /
  natural-key column). It gives idempotency (re-imports skip known keys) and lets one
  file reference records loaded by another (an invoice line points at its vendor by
  `vendor_number`).
- **Import modes** — `ADD` (create, skip existing), `UPDATE` (update existing, error if
  missing), `UPSERT` (add-or-update). Masters support all three; transactions are ADD.
- **Header + line (sublist) documents** — transactional record types accept one file
  where rows sharing an external id form a document (header from the first row, lines
  collected), e.g. an AP invoice with several distribution lines.
- **Field mapping** — `POST /migration/preview` returns the detected headers, a sample,
  and a suggested `{source_header → canonical_column}` mapping (auto-matched by
  normalized name). Pass an explicit `mapping` JSON on `/run` to override.
- **Load order** — Setup → Masters → Open Transactions → Historical, surfaced per
  record type so the cutover runs in dependency order.
- **Jobs + results** — each run is a MigrationBatch (DRY_RUN/COMMITTED/ROLLED_BACK) with
  per-row results (action + message), a downloadable xlsx, and clean rollback.

## Record types (in load order)
| Order | Entity | Kind | Key | Notes |
|---|---|---|---|---|
| 10 | `HOMEOWNER` | Master | account_number | upsert-able |
| 20 | `VENDOR` | Master | vendor_number | upsert-able |
| 25 | `VENDOR_BANK` | Master | external_id | account number tokenized at rest |
| 50 | `AR_OPENING` | Open txn | account_number | DRAFT open AR invoice |
| 55 | `AP_OPEN_INVOICE` | Open txn (doc) | external_id | header + lines + distributions, DRAFT |
| 60 | `PO_OPEN` | Open txn (doc) | external_id | PO/contract header + lines + distributions |
| 65 | `DELINQUENCY_CASE` | Open txn | account_number | one case per homeowner |
| 70 | `AR_RECEIPT` | Historical | external_id | optional application to invoice by number |
| 75 | `AP_PAYMENT` | Historical | external_id | vendor payment history; 1099 via vendor flag |

Header+line documents (`AP_OPEN_INVOICE`, `PO_OPEN`) use one file: header columns repeat
on every line row; rows are grouped by the external id. Each line resolves its GL
account by COA concatenated segments and carries a fund.

## Workflow
1. **Template / Preview** — download the template, or upload your file and Preview to see
   the auto-suggested field mapping.
2. **Dry-run** — validates every row/document (required fields, vendor/homeowner exists,
   COA combination resolves, fund present, numeric amounts) with no writes.
3. **Commit** — creates targets and records each `external_id → target_id`.
4. **Idempotent re-run** — known external ids / natural-key dups are skipped.
5. **Rollback** — a COMMITTED batch deletes its created targets and frees the external
   ids for re-import.
6. **Report** — per-row xlsx for the audit file. Every run/rollback is audited
   (`MIGRATION_RUN` / `MIGRATION_ROLLBACK`).

## GL safety
Open AR/AP documents load as **DRAFT** (no GL post) so a batch is fully reversible; staff
post them through the normal controlled flow at cutover, keeping fund accounting and
period controls authoritative. Historical receipts/payments load as recorded
(non-posting) history.

## Deliberately out of this batch
- **COA combinations** — created through the KFF-validated COA config flow (cross-
  validation rules + positional segment derivation), not a flat CSV.
- **Budgets** — go through the versioned budget module (version → lines → approval).
- **Documents/attachments** — need binary storage + per-record linkage; a metadata-only
  CSV import is not useful on its own. Candidate for a follow-on with file upload.
