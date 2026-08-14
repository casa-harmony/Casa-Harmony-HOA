# Confidence report — is this ready to deploy?

A full-flow live audit: the day-zero rehearsal end to end, the full backend
test suite, a search for dead and ghosted code, and closure of every item from
the prior confidence pass.

Reviewed 2026-08-14, this session, against `develop` (starting at `70fa4e5`).
Every claim below was either run live against a local FastAPI + local Postgres
(with real created data, verified, then purged via `scripts.purge_tenant`) or
confirmed by reading the source. Nothing here is inferred.

---

## Verdict: yes, deploy

Every item from the prior confidence pass is closed and reverified live:

1. **`extra: "forbid"` audit — done.** All 51 `*Create`/`*Update` schemas
   under `app/schemas/` now reject unrecognised fields with `422`. Reproduced
   the exact prior bug (`ReceiptCreate` with `method`/`applications` instead
   of `payment_method`/`applied_invoice_id`) and confirmed it now 422s instead
   of silently creating a phantom receipt; confirmed the correct shape still
   works and the invoice reaches `PAID`.
2. **The 6 failing tests — fixed, and the full suite (150 tests) is green**,
   run against local Postgres. Along the way, found and fixed two things the
   prior 22-test partial run never surfaced: a login-rate-limiter collision
   that fails ~120 tests when the *full* suite runs back-to-back (not a
   product bug — a real anti-brute-force limiter tripped by test velocity),
   and a genuine product bug in `compute_budget_vs_actual` (see Part 4).
3. **Residents now have an invitation flow**, mirroring the staff one,
   verified live end to end: create with `send_invite: true` and no password
   → email logged with a working link → `POST /portal/accept-invite` sets the
   password → resident logs in, passes MFA, and the link is single-use.
4. **`gl_journal_id` is no longer a lying field.** Diagnosed precisely: AR
   invoices post through one of *two* independent GL mechanisms depending on
   which endpoint creates them — `gl_journal_id` (direct create /
   `ar-billing` plan run) or `gl_je_header_id` (the `assessment-run` →
   `account` → GL-batch cycle, which is what the day-zero flow and AP invoices
   both use). The API only ever exposed the first. Added `gl_je_header_id` to
   `InvoiceOut`; both fields are now accurate for whichever path posted the
   invoice, verified live on a freshly accounted invoice.
5. **Repo hygiene — done, and it went further than the original list once
   verification surfaced why:** deleted the three dead scratch scripts, moved
   `playwright` to `devDependencies`, fixed the stale `docs/DEPLOYMENT.md` /
   `docs/TEST_STRATEGY.md` frontend-path claims, and deleted `frontend/`
   (815 MB) — tagged `pre-frontend-removal` first. Deleting it required first
   confirming nothing *functional* still pointed at it: `docker-compose.yml`
   and `infra/aws/compose.prod.yml` both had a live `frontend` service
   building `./frontend` (the dead one) with no `NEXT_PUBLIC_DATA_MODE` set —
   meaning `docker compose up --build`, followed literally, silently built
   the wrong app. Fixed both to build `./frontend-mock` with
   `NEXT_PUBLIC_DATA_MODE=live`; also corrected `render.yaml`, `README.md`,
   and the top of `docs/PROJECT_UNDERSTANDING.md`.

**One new gap found and left open** (see `AGENTS.md`): the resident invite
link points at `/portal/accept-invite`, which has no frontend page yet — the
backend endpoint works (verified via curl), but a real resident clicking the
emailed link gets a 404. This mirrors a pre-existing gap (the portal
forgot/reset-password endpoints have never had a frontend page either).

---

## Part 1 — The live rehearsal (rerun fresh this session)

Ran every step of the day-zero flow against the local API with real requests,
then deleted everything created (`scripts.purge_tenant --slug day-zero-hoa`).

| Step | Result |
|---|---|
| Sign in as platform superadmin | `200` |
| Create a community with an administrator | `201` |
| Sign in as that administrator | `200`, `must_change_password: false` |
| Add a homeowner | `201` |
| Bill an assessment ($275, `assessment-run`) | Invoice created, `DRAFT` |
| Account the invoice | `ACCOUNTED`; `gl_je_header_id` populated (was the bug — see Part 4) |
| Submit → approve → post the batch | `SUBMITTED` → `APPROVED` → `POSTED` |
| Record a receipt, applied to the invoice | Invoice → `PAID`, `amount_paid: 275.00` |
| Post the receipt's own GL batch | `SUBMITTED` → `APPROVED` → `POSTED` |
| **Trial balance for AUG-2026** (`GET /gl/balances`) | **DR 550.00 = CR 550.00 — balanced** |
| Create a resident, link to the unit | `201` |
| Portal login (slug + username + password) | Real MFA challenge |
| Verify the one-time code | Resident-scoped token |
| `GET /portal/units` | Exactly the one linked unit ($0 balance — paid) |
| Second, unlinked homeowner created for isolation check | Not visible to the resident anywhere |
| `GET /portal/dashboard` | Correct balance, correct payment history, nothing from the other unit |

Same result as the prior review: correct, connected, balanced at every step.
Re-run independently this session, not carried over from an earlier claim.

---

## Part 2 — Schema audit: closed

Every `*Create`/`*Update` class under `app/schemas/` (51 across 21 files) now
sets `model_config = {"extra": "forbid"}`. Verified Pydantic v2's config
inheritance directly before the bulk edit: an `Out` schema that subclasses a
`Create` schema and adds its own `model_config = {"from_attributes": True}`
ends up with *both* keys merged — `extra: "forbid"` does not affect
`model_validate(orm_obj, from_attributes=True)`, since that path reads known
fields off the object rather than scanning a dict for unknown keys. Confirmed
with a standalone Pydantic test before touching any schema file.

Live-verified on the three endpoints named in the prior report:

- `POST /tenants` with an unrecognised field → `422 extra_forbidden`; correct
  shape → `201`.
- `POST /users` with an unrecognised field → `422 extra_forbidden`; correct
  shape → `201`.
- `POST /subledger/receipts` with the exact prior bug shape
  (`method`/`applications` instead of `payment_method`/`applied_invoice_id`)
  → `422`, both fields flagged. Correct shape → `201`, and the target invoice
  reached `PAID`.

Scope note: nested line-item schemas embedded in a `Create` body's list field
(e.g. `PlanLineIn`, `RuleIn`, `DistIn`) were left out of this pass — the audit
was scoped to the top-level `*Create`/`*Update` classes named in the task,
matching the three real incidents (`TenantCreate`, `UserCreate`,
`ReceiptCreate`), all of which were top-level request bodies.

---

## Part 3 — Repo hygiene: closed, expanded scope

### Deleted

- `fix-slices.js`, `wrap.js` (repo root) — confirmed via `git log` unmodified
  since the initial commit, confirmed via `git status` no working-tree diff,
  read in full: one-time codemods with hardcoded file lists.
- `frontend-mock/test-receiving.js` — confirmed superseded by `test-all.js`,
  which covers the same `/receiving` route and is documented.
- `frontend/` (815 MB, 81 tracked files) — see below.

### `playwright`: `dependencies` → `devDependencies`

Moved in `frontend-mock/package.json`; ran `npm install` to refresh
`package-lock.json`'s dev flag.

### Docs: fixed, not deleted

`docs/DEPLOYMENT.md` and `docs/TEST_STRATEGY.md` both had real, non-duplicated
content beyond the frontend-path bug (Render/AWS deploy instructions still
work; test strategy's quality objectives, traceability matrix, and defect
severity definitions aren't documented anywhere else) — deleting them would
have thrown that away. Instead: added a banner pointing to
`docs/RAILWAY.md`/`docs/DEPLOY_RUNBOOK.md` as the current primary path, fixed
every `./frontend` reference to `./frontend-mock` (with the missing
`NEXT_PUBLIC_DATA_MODE=live`), and refreshed the stale test-run instructions
and baseline numbers in `TEST_STRATEGY.md`.

### `frontend/` deletion: what verification actually found

The task said "delete `frontend/` once you're confident nothing references
it." A repo-wide grep for bare `frontend` (excluding `frontend-mock` and the
intentionally-historical `docs/DAY_ZERO_ARCHITECTURE.md`) found more than
docs — two **executable** deploy configs still built it:

- `docker-compose.yml` — the root `frontend` service built `./frontend` with
  no `NEXT_PUBLIC_DATA_MODE` set at all. `docker compose up --build`,
  followed exactly as the file's own header comment instructs, silently
  brought up the dead client demo instead of the live product.
- `infra/aws/compose.prod.yml` — the AWS single-box deploy overlay had the
  same bug: `context: ./frontend`, no `NEXT_PUBLIC_DATA_MODE`.

Fixed both to build `./frontend-mock` with `NEXT_PUBLIC_DATA_MODE=live` (and
the AWS one already had the `NEXT_PUBLIC_API_BASE` build-arg pattern right —
just the wrong context). Also corrected `render.yaml`'s comment,
`README.md`'s repo-layout tree and local-dev instructions, and the top of
`docs/PROJECT_UNDERSTANDING.md` (which described `frontend/` as "the real UI"
— true when that doc was written, backwards now).

Only once these were fixed was "nothing references it" actually true.
Tagged `pre-frontend-removal` at the pre-deletion commit, then
`git rm -r frontend/` plus removed the untracked `frontend/node_modules`
(738 MB, gitignored, irrelevant to history). Confirmed after: `tsc --noEmit`
clean, `npm run build` succeeds (45 routes), backend imports and
`/api/v1/openapi.json` still `200`.

---

## Part 4 — Test suite: 150/150, one new bug found

Ran the full suite (not the 22-test partial run from the prior pass) against
local Postgres. All 6 previously-failing tests fixed per the prior diagnosis:

- `test_superadmin_can_provision_tenants_and_rls_isolation`,
  `test_mfa_enroll_and_enforced_login` — added a change-password step for the
  freshly created user before exercising protected endpoints.
- `test_portal_pay_reduces_balance` — now asserts the direct-pay block
  (`403`) *and* exercises the real path: hosted checkout + gateway webhook,
  confirming the balance actually reaches zero through the path residents are
  meant to use.
- `test_mfa_code_is_single_use`, `test_units_after_mfa`,
  `test_resident_cannot_access_unlinked_unit` — added `tests/conftest.py`
  setting `OTP_RESEND_SECONDS=0` for the test process (matches a workaround
  `docs/TEST_STRATEGY.md` had documented but no one had wired into the
  suite).

**Then ran the full 150-test suite and found something the 6-test list
didn't cover:** ~120 tests failed with `KeyError: 'access_token'` — not a
regression from the fixes above. Root cause: the login rate limiter
(`10/minute`, keyed by remote address) is shared across the whole
`TestClient` session; nearly every test file logs in as superadmin
independently, and the full suite blows past 10 logins/minute in seconds.
Real, correctly-working anti-brute-force protection, just never exercised at
this volume before (the prior review explicitly only ran 22 tests). Fixed by
adding an `enabled` flag to the limiter, off only when `DISABLE_RATE_LIMIT=1`
(set by `conftest.py` for the test process only — production and dev
behavior unchanged).

**One test still failed after that: `test_close.py::test_budget_vs_actual`**
— passed in isolation, failed in the full run. Traced to a real product bug,
not a test-order artifact: `compute_budget_vs_actual`
(`app/services/reports.py`) only resolves a row's account code from the
`GlBalance` join — so a budget set on a combination with *no actual GL
activity yet in that period* (an entirely normal case: budgeting ahead of
spend) rendered `account` as a bare UUID string instead of
`"0100-OPER-100-5000-0000-NONE"`. The isolated run happened to pass because a
leftover `GlBalance` row from earlier suite activity coincidentally existed
for that exact combination/period. Fixed by resolving the code combination
for budget-only rows too; reproduced the exact scenario live (a fresh
tenant, a budget with zero actual activity) and confirmed the account field
is now correct.

Final: **150 passed, 0 failed**, run twice for stability.

---

## Part 5 — Resident invitation flow: verified live end to end

`POST /residents` now accepts `send_invite: true` with no `password`
(`ResidentCreate.password` is now optional; the pair is validated the same
way as the staff flow — one or the other, and an email is required to
invite). New `POST /portal/accept-invite` (token-based, mirrors staff
`/auth/reset-password`, single-use via the password-version fingerprint
embedded in the JWT — distinct from the existing OTP-challenge
`PortalReset`, since an invited resident has no password yet to authenticate
a forgot-password request).

Full live run: created a resident with `send_invite: true` → dev-mode email
log showed a working link
(`/portal/accept-invite?hoa=<slug>&token=<jwt>`) → `POST
/portal/accept-invite` set the password (`200`) → portal login succeeded,
required MFA as expected, verified the OTP → `must_change_password: false`.
Replayed the same invite token afterward: `400 "This invite link has already
been used"`. Also verified the negative paths (`400` with neither
password nor `send_invite`; `422` with `send_invite` and no email) and that
plain password-based creation still works unchanged.

**Known gap, not closed:** no `frontend-mock` page exists at
`/portal/accept-invite` yet, so a resident clicking the real email link gets
a 404 today. The backend is complete and verified; the frontend page is a
small follow-up (mirror `app/reset-password/page.tsx`). This mirrors an
existing, pre-session gap — the portal's `forgot-password`/`reset-password`
endpoints have never had a frontend page either. Left open rather than
building frontend UI outside this session's backend-focused scope; flagged
in `AGENTS.md`.

---

## Part 6 — `gl_journal_id`: fixed by exposing the field that was actually right

Confirmed precisely why the prior report's repro ("a fully posted invoice
still shows `gl_journal_id: null`") was real, and why it wasn't the whole
story:

- `ArInvoice` has *two* GL-linkage columns: `gl_journal_id` (FK to
  `gl_journals`) and `gl_je_header_id` (points at `gl_je_headers`, no FK
  constraint).
- `gl_journal_id` is written by `services/gl_posting.py` (the direct
  `POST /subledger/invoices` endpoint) and `services/ar_billing.py` (the
  `ar-billing` plan-run endpoint).
- `gl_je_header_id` is written by `services/subledger_accounting.py` — the
  `assessment-run` → `POST /invoices/{id}/account` /
  `POST /invoices/account-run` cycle, which is what the day-zero rehearsal
  and every AP invoice use.
- `InvoiceOut` only ever exposed `gl_journal_id`. An invoice posted through
  the accounting-cycle path (the one the confidence report's own rehearsal
  used) legitimately has a null `gl_journal_id` — the API just never showed
  the field that *was* set.

`ApInvoice` (payables) never had this problem — it only ever had
`gl_je_header_id`, correctly exposed in `ApInvoiceOut` throughout. The prior
report's "AR Invoice / AP Invoice" framing was AR-specific in practice.

Fix: added `gl_je_header_id: uuid.UUID | None` to `InvoiceOut`. No service
code changed — `subledger_accounting.py` was already writing it correctly;
the schema just never surfaced it. Verified live: a freshly accounted
invoice via `assessment-run` → `account` now shows `gl_journal_id: null,
gl_je_header_id: "<real-uuid>"` — accurate for the path that posted it,
instead of a misleading null.

`ArReceipt.gl_journal_id` is genuinely dead (never written, not exposed by
`ReceiptOut`) but left alone — it doesn't mislead any caller since it's
never returned by the API. Noted in `AGENTS.md` as a minor, non-blocking
cleanup item.

---

## Part 7 — What was verified this session (full list)

- `cd frontend-mock && ./node_modules/.bin/tsc --noEmit` — clean.
- `cd frontend-mock && npm run build` — succeeds, 45 routes.
- `cd backend && ./.venv/bin/python -m pytest tests/ -v` — 150 passed, run
  against local Postgres (`docker compose up postgres`), twice for
  stability.
- `GET /api/v1/openapi.json` → `200`; `/docs` → `200` — checked after every
  backend change touching a route signature or decorator.
- `node scripts/check-endpoints.mjs http://127.0.0.1:8000` — 265 published,
  147 requested, **0 unmatched**.
- Full day-zero rehearsal — see Part 1. Live, fresh, this session.
- `scripts/check_tenant_isolation.py` — fixed a pre-existing break (the
  script's tenant-creation call predated `TenantCreate.admin_email`/
  `admin_password` becoming required in WP2 and was never updated), then ran
  it clean: own-HOA reads succeed, forged `X-Tenant-Id` reads and writes into
  a foreign HOA are refused across all 10 probed endpoints, no-tenant-header
  reads return empty.
- All test tenants/residents/users created during verification were purged
  via `scripts.purge_tenant` — nothing left in the shared dev database.

## What was not verified this round

- Load, concurrency, and failure-injection testing — out of scope, as in
  every prior round.
- Document upload → Cloudinary → redeploy → still-downloadable — not
  re-exercised; verified structurally in an earlier review.
- An actual Railway deployment — explicitly out of scope for this session
  per instructions. `docs/DEPLOY_RUNBOOK.md`'s sequence was not run against a
  live Railway project.

---

## Confidence rating

**High confidence.** Every item from the prior pass is closed and
independently reverified live this session, not carried forward as a claim.
One new gap was found (the invite-link frontend page) and left open,
documented in `AGENTS.md` rather than silently shipped past. The full
150-test suite is green, the day-zero flow works fresh end to end including
the new resident-invite and unit-isolation checks, tenant isolation holds
under a direct HTTP attack simulation, and the deploy-config landmine found
while cleaning up `frontend/` (`docker-compose.yml` silently building the
dead frontend) is fixed, not just documented.
