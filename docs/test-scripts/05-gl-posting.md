# Test Scripts — 5. GL Batch Review & Posting

General Ledger: reviewing draft batches (with **control totals** and KFF line detail),
the **submit → approve → post** lifecycle, the **nightly posting run**, **idempotency**,
and **balances** (including period **roll-forward**). Maps to Q2 (books balance).

Pre (all): at least one **draft** GL batch exists (from a P2P approval — TC-P2P-10 — or
an AR receipt — TC-O2C-04). Role: `gl.batch.manage` / `gl.batch.approve`. On **General Ledger**.

---

## TC-GL-01 · Review a draft batch (lines, totals, KFF) · P1
- **Steps:** Open the draft batch → **review**.
- **Expected:** Each journal shows lines with the **KFF code-combination string**, **fund badge**, debit, credit; **Total Debits = Total Credits** with a green **"In balance"** indicator.

## TC-GL-02 · Submit enforces balance & non-zero · P1
- **Steps:** Submit the batch.
- **Expected:** Status → **SUBMITTED**; control totals set from line sums. A batch that does not balance, or has zero amount, is **rejected (422)**.

## TC-GL-03 · Approve the batch · P1
- **Steps:** Approve the SUBMITTED batch.
- **Expected:** Status → **APPROVED**; approver + timestamp recorded. Only SUBMITTED batches can be approved (others 422).

## TC-GL-04 · Post to GL balances · P1
- **Steps:** Post the APPROVED batch.
- **Expected:** Status → **POSTED**, `posted_at` set, headers marked POSTED. `GET /gl/balances?period=…` shows the period net debits/credits updated for each affected code combination, carrying the fund value.
- **Automated:** `tests/test_financials.py`.

## TC-GL-05 · Posting is idempotent · P2
- **Steps:** Post an already-**POSTED** batch again (or include it in a posting run).
- **Expected:** No double counting; the call is a no-op for POSTED batches. Balances unchanged.

## TC-GL-06 · Lifecycle guards · P2
- **Steps:** Try to post a **DRAFT** batch (skip submit/approve); try to approve a DRAFT.
- **Expected:** Each is rejected (422) — only APPROVED can post, only SUBMITTED can approve.

## TC-GL-07 · Nightly posting run · P1
- **Steps:** Have ≥1 APPROVED, unposted batch. Click **Run Nightly Posting** (or `POST /gl/posting-runs`).
- **Expected:** All APPROVED batches for the HOA post; the result returns `count` posted. Posting history (POSTED count) increases. Re-running posts 0 (idempotent).
- **Automated:** `tests/test_financials.py::test_idempotent_posting_run`; CLI `python -m scripts.run_nightly_posting`.

## TC-GL-08 · Period balance roll-forward · P1
- **Steps:** Post activity for an account in **JAN-2026**, then post more for the same account in **FEB-2026**. Inspect balances.
- **Expected:** JAN begin = 0, JAN end = net; **FEB begin_balance = JAN end_balance** (roll-forward); FEB end = FEB begin + FEB net.
- **Automated:** `tests/test_gl_posting.py::test_balance_rolls_forward_across_periods`.

## TC-GL-09 · Books balance per fund · P1
- **Steps:** After posting AP + AR activity across OPER and RESV, sum debits and credits per fund for the period.
- **Expected:** Σ debits = Σ credits overall **and within each fund** (fund self-balancing).

## TC-GL-10 · Cross-tenant: batches isolated · P1
- **Steps:** As HOA A, list/open GL batches; confirm none belong to HOA B.
- **Expected:** Only HOA A batches/balances are visible (RLS).
