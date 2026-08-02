# Test Scripts — 9. Resident Self-Service Portal

Owner/renter logins, multi-unit linking, the resident portal (balances, invoices,
online payment, ledger), and strict per-resident + per-HOA isolation.

Seed login: HOA `casa-harmony`, resident `owner1` / `ChangeMe!Owner1` (OWNER), linked
to one unit. Admin actions run as a staff user with `resident.manage`.

---

## TC-RES-01 · Admin creates a resident login · P1
- **Role:** staff with `resident.manage`; on **Residents**.
- **Steps:** New Resident → username `jsmith`, type OWNER, full name, temp password (≥8). Save.
- **Expected:** Resident appears with 0 units. Duplicate username in the same HOA → 409.

## TC-RES-02 · Link one resident to multiple units · P1
- **Steps:** On `jsmith` → **Units**, link unit A (primary), then link unit B.
- **Expected:** Both units listed; one marked primary. Re-linking the same unit → 409 (the (unit#, username) pair is unique).

## TC-RES-03 · Renter type · P2
- **Steps:** Create a resident with type **RENTER**; link to a unit.
- **Expected:** Resident saved as RENTER; can log in and see that unit (same portal as owners).

## TC-RES-04 · Resident login with email/SMS MFA · P1
- **Steps:** Go to `/portal/login`; enter HOA `casa-harmony`, `owner1`, `ChangeMe!Owner1` → Continue. A 6‑digit code is sent by the resident's channel (email for `owner1`); enter it → Verify.
- **Expected:** Step 1 shows "code sent to j***@…"; entering the correct code signs in to `/portal` with the unit card(s) and **balance due**. Wrong password → 401 at step 1. (No authenticator app — just an emailed/texted code.)
- **Dev note:** with no mail/SMS provider configured, the code is logged and (in `ENVIRONMENT=development`) returned as `dev_otp` so UAT works offline. Configure SendGrid/Twilio env vars to send for real.
- **Automated:** `tests/test_portal.py::test_mfa_challenge_then_token`, `test_mfa_wrong_code_rejected`, `test_mfa_code_is_single_use`, `test_login_bad_password`.

## TC-RES-04b · MFA channel = SMS · P2
- **Steps:** Admin creates a resident with **MFA via Text (SMS)** + a phone; that resident logs in.
- **Expected:** Step 1 reports a code sent by text to `***-***-1234`; verifying the code signs in. Creating an SMS resident without a phone (or an email resident without an email) is rejected (422).

## TC-RES-05 · View balances & invoices · P1
- **Steps:** On `/portal`, select a unit.
- **Expected:** Unit balance equals the sum of open invoice balances; invoices list with type, due date, and balance.

## TC-RES-06 · Online payment (tokenized, no PAN) · P1
- **Steps:** Click **Pay** on an invoice with a balance.
- **Expected:** Payment recorded; invoice balance → 0 / status **PAID**; unit balance drops. A receipt posts Dr Cash / Cr Receivable to the GL. No card PAN is stored.
- **Automated:** `tests/test_portal.py::test_portal_pay_reduces_balance`.

## TC-RES-07 · Download unit ledger · P2
- **Steps:** On a unit, **Download ledger**.
- **Expected:** xlsx with chronological charges/payments and running balance for that unit only.

## TC-RES-08 · Cross-resident isolation · P1 ⚠️ critical
- **Steps:** As resident B (linked to a different unit), attempt to load resident A's unit invoices (by id, e.g., via the API).
- **Expected:** **404** — a resident can only access units they are linked to.
- **Automated:** `tests/test_portal.py::test_resident_cannot_access_unlinked_unit`.

## TC-RES-09 · Token-scope separation · P1
- **Steps:** Use a resident token against a staff endpoint (`/residents`); use a staff token against `/portal/me`.
- **Expected:** Each is rejected (401/403). Resident tokens carry their HOA and cannot switch via `X-Tenant-Id`.
- **Automated:** `tests/test_portal.py::test_token_scope_separation`.

## TC-RES-10 · Cross-HOA isolation · P1
- **Steps:** Create a resident with the same username in a second HOA; log into each.
- **Expected:** Each login only ever sees its own HOA's units (RLS + tenant-bound token). Usernames are unique only within an HOA.
