# Test Scripts — 2. Security, Isolation & Compliance

Cross-cutting controls: authentication, MFA, RBAC enforcement, **multi-tenant RLS
isolation**, encryption at rest, PCI tokenization, and CCPA data-subject rights.
These map to quality objectives Q1, Q5, Q6.

---

## TC-SEC-01 · Login & token issuance · P1
- **Steps:** POST `/api/v1/auth/login` with SUPERADMIN creds (or UI login).
- **Expected:** 200 + JWT access token; `GET /auth/me` returns the user. Wrong password → 401.

## TC-SEC-02 · MFA enrollment & verification (TOTP) · P2
- **Steps:**
  1. `POST /api/v1/auth/mfa/enroll` → returns a TOTP secret + `otpauth://` URI.
  2. Generate a code from the secret (authenticator app or `pyotp`).
  3. `POST /api/v1/auth/mfa/verify` with the code.
- **Expected:** Enroll returns a provisioning URI (QR-renderable); a valid code verifies and enables MFA; an invalid/expired code is rejected.
- **Automated:** MFA path in `tests/test_gaps.py`.

## TC-SEC-03 · RBAC — permission enforcement · P1
- **Pre:** A VIEWER-role user in the HOA.
- **Steps:** As VIEWER, attempt `POST /coa/structures/{id}/combinations` and `POST /gl/batches/{id}/approve`.
- **Expected:** **403 Forbidden** on both; VIEWER can still `GET` COA (read).
- **Automated:** `tests/test_api.py`.

## TC-SEC-04 · Cross-tenant isolation — API (RLS) · P1 ⚠️ critical
- **Pre:** Two HOAs (A and B); an admin of HOA A; note an object id from HOA B (e.g., a B homeowner or PO).
- **Steps:** As HOA A admin (token + `X-Tenant-Id: A`), request HOA B's object by id, and list endpoints.
- **Expected:** B's object is **not found / not returned**; lists contain only A's data. No 200 with B's data under any endpoint.
- **Automated:** `tests/test_api.py` cross-tenant isolation test.

## TC-SEC-05 · Cross-tenant isolation — direct DB (RLS) · P1 ⚠️ critical
- **Steps:** Connect to Postgres as the **`casa_app`** role; `SET app.current_tenant` to HOA A; `SELECT * FROM ar_homeowners;` then change the GUC to B.
- **Expected:** Each query returns only the set-tenant's rows. With no GUC and not superadmin, no tenant rows are visible. `casa_app` has **NOBYPASSRLS**.

## TC-SEC-06 · SUPERADMIN scoped switch · P2
- **Steps:** As SUPERADMIN, operate with `X-Tenant-Id` set to a specific HOA.
- **Expected:** Even SUPERADMIN sees only the selected HOA's data when scoped to it (the `app.is_superadmin` GUC enables platform-wide reads only where intended, e.g., the tenant registry).

## TC-SEC-07 · Encryption at rest (PII/financial) · P1
- **Pre:** A vendor with a Tax ID and a bank account number were created (TC-CFG-11/13).
- **Steps:** Query the raw rows in Postgres: `SELECT tax_id FROM ap_suppliers; SELECT account_number FROM ap_bank_accounts;`
- **Expected:** Stored values are **Fernet ciphertext** (start with `gAAAAA…`), not plaintext. The API/UI shows decrypted/masked values to authorized users only.

## TC-SEC-08 · PCI tokenization — no PAN stored · P1
- **Steps:** `POST /api/v1/payments/methods` with a test card; then `GET /payments/methods`.
- **Expected:** Response stores only a **vault token + last four + brand**; the **full PAN is never persisted or returned**. DB `payment_tokens` has no PAN column.
- **Automated:** `tests/test_gaps.py` (tokenization).

## TC-SEC-09 · CCPA — data-subject access (right to know) · P2
- **Steps:** `POST /privacy/requests` (type ACCESS) for a subject; `GET /privacy/export`.
- **Expected:** A request record is created (auditable); export returns the subject's data the platform holds.

## TC-SEC-10 · CCPA — erasure (right to delete) · P2
- **Steps:** `POST /privacy/requests` (type ERASURE); `POST /privacy/requests/{id}/erase`.
- **Expected:** Request transitions to completed; subject PII is anonymized/removed per policy; the request itself remains as an audit record.
- **Automated:** `tests/test_gaps.py` (CCPA).

## TC-SEC-11 · Audit trail (who + before/after) · P2
- **Steps:** Update a vendor's email; then inspect the audit log entries.
- **Expected:** An audit record captures actor (who), timestamp, action, entity, and before/after values. Audit records are immutable (append-only).

## TC-SEC-12 · TLS in transit (staging) · P3
- **Steps:** On staging, confirm the app is served over HTTPS and HTTP redirects to HTTPS.
- **Expected:** Valid TLS; no mixed content. (Terminated at the platform/load balancer per `docs/DEPLOYMENT.md`.)
