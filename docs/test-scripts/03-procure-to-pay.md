# Test Scripts — 3. Procure-to-Pay (PO → AP → Approval → Draft GL)

The purchasing and payables process, including **fund-mandatory distributions**,
**2-way PO matching**, the **multi-level approval workflow**, and **Subledger
Accounting** that produces a draft GL batch on final approval.

Pre (all): demo HOA active; vendor V-0001 exists; expense account `5000-OPER` and
AP account `2000-OPER` exist (seeded).

---

## TC-P2P-01 · Create a Purchase Order with KFF distribution · P1
- **Role:** `po.manage`; on **Purchasing (PO)**.
- **Steps:** New PO → vendor V-0001, item "Monthly landscaping", qty 1, unit price 500.00, account = `0100-OPER-100-5000-0000-NONE`. Create.
- **Expected:** PO created (status **INCOMPLETE**), number auto-assigned, amount **$500.00**. The distribution captured a Fund value (OPER) from the combination.
- **Automated:** `tests/test_financials.py::test_full_po_to_gl_balance_flow`.

## TC-P2P-02 · Distribution total must equal line amount · P2
- **Steps (API):** Create a PO where the line amount is 500 but distributions sum to 400.
- **Expected:** **422** with a message that distributions must equal the line amount.

## TC-P2P-03 · Fund segment is mandatory on a distribution · P1
- **Steps:** Attempt a distribution against an account combination that has no Fund value.
- **Expected:** **422** — "Fund segment is mandatory on all distributions."
- **Automated:** `tests/test_approvals.py::test_fund_is_mandatory_on_distributions`.

## TC-P2P-04 · Submit a PO — no hierarchy → auto-approve · P2
- **Pre:** No PO approval hierarchy configured.
- **Steps:** Submit the PO from TC-P2P-01.
- **Expected:** Status becomes **APPROVED** immediately (auto-approval when no hierarchy applies).

## TC-P2P-05 · Submit a PO — single-level hierarchy → pending then approve · P1
- **Pre:** PO hierarchy with one level (TC-CFG-10 level 1).
- **Steps:** Submit a $500 PO → check **Approvals**; approve it there.
- **Expected:** On submit, status **SUBMITTED** / approval **PENDING**, and the request appears on the Approvals dashboard. After approval → **APPROVED**.

## TC-P2P-06 · Multi-level approval escalation · P1
- **Pre:** PO hierarchy with L1 (0–5000) and L2 (5000+) (TC-CFG-10).
- **Steps:** Submit a **$7,500** PO. Approve once (L1). Approve again (L2).
- **Expected:** `required_levels = 2`. After the first approval the request stays **PENDING** at level 2; after the second it becomes **APPROVED**, and the PO is finalized. A **$500** PO requires only 1 level.
- **Automated:** `tests/test_approvals.py::test_multi_level_approval_escalation`.

## TC-P2P-07 · Reject in the workflow · P2
- **Steps:** Submit a PO; on Approvals, **Reject** with a comment.
- **Expected:** Request → **REJECTED**; PO status → **REJECTED**; an approval action records the rejecter + comment.

## TC-P2P-08 · Create AP invoice matched to a PO (2-way match OK) · P1
- **Pre:** An **APPROVED** PO of $500 (TC-P2P-04/05).
- **Role:** `ap.manage`; on **Payables (AP)**.
- **Steps:** New invoice → vendor V-0001, number `INV-1001`, invoice date, GL date, **match to PO**, amount 500.00, expense account `5000-OPER`. Create.
- **Expected:** Invoice created **DRAFT**, **match_status = MATCHED** (invoice ≤ PO).
- **Automated:** `tests/test_financials.py`.

## TC-P2P-09 · PO match exception blocks submission · P1
- **Steps:** Create an invoice for **$999** against the **$500** PO; submit.
- **Expected:** **match_status = MATCH_EXCEPTION**; submit is **rejected (422)** ("exceeds matched PO amount").
- **Automated:** `tests/test_financials.py::test_po_match_exception_blocks_submit`.

## TC-P2P-10 · Approve AP invoice → Subledger Accounting creates a draft GL batch · P1
- **Pre:** AP_INVOICE hierarchy (seeded, 1 level).
- **Steps:** Submit `INV-1001` → **PENDING**; approve it.
- **Expected:** Invoice → **ACCOUNTED**, `gl_je_header_id` set. A **draft GL batch** named `AP INV-1001` exists (source **AP**) with lines **Dr expense $500 / Cr AP $500**, balanced and **grouped per fund**.
- **Automated:** `tests/test_financials.py`.

## TC-P2P-11 · Contracts variant · P3
- **Steps:** Create a PO with document type **CONTRACT**; run it through approval.
- **Expected:** Behaves as a PO with the contract document type; eligible for a CONTRACT approval hierarchy if configured.

## TC-P2P-12 · Audit & who-columns on P2P documents · P3
- **Steps:** Inspect created/approved PO and invoice records.
- **Expected:** created_by/at, updated_by/at populated; approval captured approver + timestamp; audit log has CREATE/SUBMIT/APPROVE entries.
