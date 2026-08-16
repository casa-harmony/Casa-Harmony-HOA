# Casa Harmony — Live QA Report & Fix Instructions

**Run date:** 2026-08-16
**Frontend:** https://frontend-mock-production.up.railway.app
**Backend:** https://casa-harmony-production.up.railway.app
**Method:** Browser-driven testing of the deployed build (real HTTP to the live
FastAPI backend, `NEXT_PUBLIC_DATA_MODE=live` confirmed), with API-level
verification of every request/response.
**Signed in as:** `superadmin@casaharmony.ai` (SUPERADMIN, permissions `["*"]`)

---

## 0. Status: code fixed locally, NOT deployed

Everything below was reproduced twice — once on Pinecrest Lakes HOA, once on a
second community (**Willow Creek Estates**) created fresh during this session
to walk the whole day-zero flow (community → admin → resident → service
ticket) end to end. Every bug reproduced identically on both tenants, which
rules out tenant-specific data corruption as the cause — these are code bugs.

Fixes for §3 and §4 are written and committed to the working tree on
`develop` (uncommitted — see `git status`), verified with `tsc --noEmit`,
`alembic heads` (single clean head), and a full `from app.main import app`
import check. **None of it has been pushed, migrated, or deployed** — that
was an explicit choice to hold for review before touching the live Railway
services. Two new Alembic migrations are included and have NOT been run
against any database (no local Postgres was available in this session to
even smoke-test them locally). Run them somewhere disposable before
production.

What's fixed and where:

| Bug | Fixed by |
|---|---|
| §3.1 Reports page crash | `backend/app/api/v1/reports.py` (adds `formats`), `reports/page.tsx` guard |
| §3.2 Migration page crash | `frontend-mock/app/(app)/migration/page.tsx` |
| §3.3 Vendor creation 422 | `backend/app/models/masters.py`, `schemas/financials.py`, `api/v1/vendors.py` + migration `c2d3e4f5a6b7`; `vendors/page.tsx` |
| §3.4 AP invoice entry 422 + empty vendor dropdown | `payables/page.tsx` (real form fields, GL account picker), backend status-casing fix |
| §3.5 Duplicate homeowner double-billing | `backend/app/models/subledger.py` (unique constraint) + migration `c2d3e4f5a6b7`, `api/v1/subledger.py` (409 on duplicate) |
| §4.1 `undefined%` on Dashboard/Board | `backend/app/services/board_reports.py` (`units`, `occupancy_pct`, `reserve_funded_pct`) |
| §4.2 Vendors list `NaN`/`—`/wrong counts | `backend/app/api/v1/vendors.py` (computed `ytd_spend`/`open_pos`), model/schema additions |
| §4.3 Modals hang forever on error | `vendors/page.tsx`, `payables/page.tsx` (try/catch, error shown in the modal) |
| §4.4 Gateway `undefined%` | `backend/app/models/payment_gateway.py`, `schemas/gateway.py`, `api/v1/gateway.py` + migration `d3e4f5a6b7c8` |
| Stale lists after create (service desk, vendors, payables, …) | **Root-caused and fixed once, app-wide**: `lib/api.ts` (`subscribeToLiveWrites`) + `app/providers.tsx` — live-mode writes now bump the same `revision` counter mock-mode already used, so every `useApi()` list re-reads after any create/update/delete. No per-page patching needed. |

**Not attempted** (found during this session, real, but out of scope for a
same-session code fix — flagging for a separate pass):
- `/reports/{id}` is still a stub (`{"status": "ok"}`) — every report
  download button saves a junk file. Wiring 44 reports to their real
  `*/export` endpoints is a bigger job than this pass.
- Payables list/detail were also missing `vendor_name`, `po_number`,
  `fund`, `account`, `description` entirely (`ApInvoiceOut` didn't have
  them) — found while fixing the create flow, since I couldn't get past the
  422 in the original pass to see it. **This one I did fix** (see
  `_invoices_out` in `backend/app/api/v1/payables.py`) — listed here only
  because it wasn't in the original numbered list above; treat it as part
  of §3.4/§4.2's fix set.
- Full resident-portal login (past the sign-in screen) — see §6, still
  blocked on a real inbox or a decision to reset a portal password directly
  in the production database.

---

## 1. Headline

The **backend is healthy**. Across a sweep of all 34 staff screens, not one
backend endpoint returned a 5xx and tenant isolation held. The money pipeline —
billing plan → assessment run → GL accounting → submit → approve → post →
dashboard — **works end to end and balances**.

The failures are almost entirely **frontend↔backend contract drift**: the
frontend was written against the mock data shapes in `lib/mock-data/`, and
several screens were never re-fitted to what FastAPI actually returns. Because
`extra: "forbid"` is set on the Pydantic schemas, a payload with one wrong field
name is rejected outright rather than partially accepted.

**Two pages crash outright. Two core create-flows are impossible from the UI.**

| Area | Verdict |
|---|---|
| Auth, sessions, tenant scoping | Working |
| AR → GL → posting → dashboard | Working |
| Service desk, users, POs, billing plans | Working |
| Reports page | **Crashes** |
| Data Migration page | **Crashes** |
| Vendor creation | **Impossible from UI** |
| AP invoice entry | **Impossible from UI** |
| Dashboard / Board KPI tiles | Partly `undefined%` |
| Vendors list figures | `NaN` / `—` / wrong counts |

---

## 2. What I verified as working

Confirmed by driving the UI and reading the resulting HTTP traffic:

- **Staff login** (`POST /auth/login`) → real JWT, `/auth/me` returns scope and
  permissions correctly.
- **Tenant scoping.** Same superadmin token with `X-Tenant-Id` of the demo
  tenant returned that tenant's homeowners, not Pinecrest's. Missing header →
  `400`. Missing token → `401`. No leakage observed.
- **AR billing plan creation** — `POST /ar-billing/plans` → `201`.
- **Monthly assessment run** — `POST /subledger/assessment-run` → `200`,
  `{"invoices_created":2,"total_billed":"500.00"}`.
- **AR → GL accounting** — `POST /subledger/invoices/account-run` → `200`,
  produced batch `AR Assessments AUG-2026`, DR 500.00 / CR 500.00, **in balance**.
- **GL lifecycle** — submit → approve → post all returned `200`; batch reached
  `POSTED`, journals hit `0100-OPER-000-1100` (AR) and `0100-OPER-000-4000`
  (income).
- **Figures propagate** — dashboard "Owed by homeowners" went `$0` → `$500`;
  `/subledger/aging` bucketed correctly into 90+.
- **Service desk ticket creation** — `POST /service-desk/tickets` → `201`.
- **Staff user creation** — `POST /users` → `201`, role granted, invite path taken.
- **PO creation** — `POST /purchasing` → `201`, `PO-000001` persisted.
- **Resident portal login error handling** — bad password → `401` with the
  message rendered correctly in the UI. (This is the pattern the broken modals
  in §3.3 and §3.4 should copy.)
- **Pages that render cleanly with no console errors:** service-desk, residents,
  documents, notifications, coa, value-sets, ap-setup, cash, budgets,
  fixed-assets, purchasing, receiving, encumbrance, payables, payments,
  ar-billing, collections, statements, dunning, receivables, gl, periods,
  approvals, users, tenants, gateway, scheduler, board, go-live,
  roles-and-flow.

---

## 3. P0 — Broken, fix first

### 3.1 Reports page crashes on load

**Symptom:** `/reports` renders "This page couldn't load".
**Console:** `TypeError: Cannot read properties of undefined (reading 'map')`

**Cause:** `frontend-mock/app/(app)/reports/page.tsx:132` calls `r.formats.map(...)`,
but `GET /reports/catalog` returns entries with only `id`, `name`, `category`,
`description` — there is no `formats` key on any of the 44 entries.

**Fix (backend, preferred):** in `backend/app/api/v1/reports.py`, add a
`formats` list to every `_CATALOG` entry, e.g. `"formats": ["PDF", "XLSX"]`.
Set it to what each report can genuinely produce.

**Also add a guard** so one bad row can't blank the page —
`{(r.formats ?? []).map(...)}` at `reports/page.tsx:132`.

**Second, larger problem on the same page:** `GET /reports/{report_id}` in
`backend/app/api/v1/reports.py:125-129` is a stub that returns `{"status":"ok"}`.
Every Download PDF / XLSX button on the Reports screen therefore saves a junk
file. Either route `/reports/{id}` to the real per-module `*/export` endpoints,
or remove the download buttons until it is wired. **The Reports screen is
non-functional even once the crash is fixed** — treat this as the bigger of the
two.

### 3.2 Data Migration page crashes on load

**Symptom:** `/migration` renders "This page couldn't load".
**Console:** `Minified React error #31` (objects are not valid as a React child).

**Cause:** `frontend-mock/app/(app)/migration/page.tsx:19-20` declares
`useApi<string[]>("/migration/entities", [])`, then renders
`<option key={e} value={e}>{e}</option>` at line 126-130. But
`GET /migration/entities` returns **objects**:

```json
{"entity_type":"HOMEOWNER","label":"Homeowners / units","kind":"MASTER",
 "load_order":10,"modes":["ADD","UPDATE","UPSERT"],"columns":[...],"key":"account_number"}
```

**Fix (frontend):** in `migration/page.tsx`:

```tsx
const { data: entities } = useApi<any[]>("/migration/entities", []);
...
{entities.map((e) => (
  <option key={e.entity_type} value={e.entity_type}>{e.label}</option>
))}
```

Check the rest of the file for other places `entity` is used as a bare string.

### 3.3 Vendor creation is impossible from the UI

**Symptom:** Fill "Add a vendor", click Add — the button sticks on "Adding…"
forever. No error. No vendor created.

**Actual response:** `POST /api/v1/vendors` → **422**

```json
{"detail":[
  {"type":"missing","loc":["body","vendor_number"],"msg":"Field required"},
  {"type":"extra_forbidden","loc":["body","category"],"msg":"Extra inputs are not permitted"}
]}
```

**Cause:** the form sends `{name, category, payment_terms, email, phone}`
(`frontend-mock/app/(app)/vendors/page.tsx:381`). `VendorCreate`
(`backend/app/schemas/financials.py:11-28`) requires `vendor_number`, has no
`category`, and sets `extra: "forbid"`. Payment terms also mismatch — the UI
sends `"Net 30"`, the backend default is `"NET30"`.

**Fix — decide one of two, then apply consistently:**

- **Option A (recommended): add `category` to the backend.** Add a `category`
  column to the `Vendor` model + a migration, add it to `VendorCreate`,
  `VendorUpdate` and `VendorOut`. This also fixes §4.2, where the vendors list
  reads `v.category` in four places.
- **Option B: drop `category` from the frontend** and rename the field to
  something the backend accepts.

**In both cases the frontend must send `vendor_number`.** Either add a field to
the form, or have the backend auto-generate it when omitted (mirroring how
`po_number`/`PO-000001` is generated in purchasing) — auto-generation is the
better UX. Also normalise payment terms to the backend's `NET30` form.

### 3.4 AP invoice entry is impossible from the UI

Two independent defects, either one alone is fatal.

**(a) The vendor dropdown is always empty.**
`frontend-mock/app/(app)/payables/page.tsx:469`:

```tsx
{vendors.filter((v) => v.status === "ACTIVE").map(...)}
```

The API returns `"status":"active"` — **lowercase**. Nothing ever matches, so
the Vendor select renders zero options even when vendors exist (verified with a
live vendor present).

**(b) The submitted payload is rejected.** `POST /api/v1/payables` → **422**

```json
{"detail":[
  {"type":"missing","loc":["body","invoice_date"],"msg":"Field required"},
  {"type":"missing","loc":["body","gl_date"],"msg":"Field required"}
]}
```

The form state (`payables/page.tsx:429-434`) is
`{vendor_id, po_header_id, invoice_number, amount, description, fund}`.
`ApInvoiceCreate` (`backend/app/schemas/payables.py:21-31`) wants
`{vendor_id, invoice_number, invoice_date, gl_date, po_header_id?, description?,
tax_amount?, lines[]}` with `extra: "forbid"` — so `amount` and `fund` are
*also* rejected once the dates are supplied.

**Fix (frontend, `payables/page.tsx`):**

1. Change the filter to be case-insensitive:
   `v.status?.toUpperCase() === "ACTIVE"`. **Grep the whole frontend for
   `=== "ACTIVE"` and `=== "INACTIVE"` and fix each one** — the same mistake is
   in `vendors/page.tsx:46,191,192,216,219,223`.
2. Add **Invoice date** and **GL date** inputs to the form, defaulting to today.
3. Replace the flat `amount` + `fund` with a `lines: [{...}]` array matching
   `ApLineIn` (this is what carries the fund/account distribution).
4. Send `po_header_id: form.po_header_id || null` — the empty string is not a
   valid UUID.

### 3.5 Duplicate homeowner accounts cause double billing

**This one costs money and I reproduced the damage.**

`GET /subledger/homeowners` returns **two separate rows with the same
`account_number` "HO-101"**, same name, same email, same unit — two different
UUIDs. When I ran the monthly assessment, the system billed **both**:

```
POST /subledger/assessment-run → {"invoices_created": 2, "total_billed": "500.00"}
```

One unit, one homeowner, **$500 billed instead of $250**. The AR aging report
also lists John Smith twice, and the service-desk ticket form shows
"Unit 101 — John Smith" twice in its dropdown.

**Cause:** `account_number` has only a plain index, no uniqueness —
`backend/app/models/subledger.py:72`:

```python
account_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
```

and `create_homeowner` (`backend/app/api/v1/subledger.py:86-101`) does no
duplicate check before inserting.

**Fix:**

1. **Clean the existing data** — merge or delete the duplicate HO-101 row in
   Pinecrest before doing anything else, and void the extra assessment invoice
   from my test run (see §7).
2. **Add a DB constraint** in a new Alembic migration:
   `UniqueConstraint("tenant_id", "account_number", name="uq_ar_homeowners_tenant_account")`.
   Add it to `__table_args__` on `ArHomeowner` too.
3. **Add an application-level check** in `create_homeowner` returning `409` with
   a clear message, so the UI can show "that account number already exists"
   rather than surfacing a database error.
4. Check `app/services/migration.py:164` (the bulk importer) honours the same
   rule — it should upsert on `account_number`, not blindly insert.

---

## 4. P1 — Visibly wrong numbers

### 4.1 `undefined%` on the Dashboard and Board Dashboard

**Symptom:** Dashboard shows `RESERVE FUNDED undefined%` and
`UNITS · undefined% occupied`. Board Dashboard shows the same plus
`OCCUPANCY undefined% · undefined units`.

**Cause:** `GET /board/exec-dashboard` returns exactly:

```json
{"funds":[...], "cash_total":"0.00", "ar_open_total":"500.00",
 "delinquent_total":"500.00", "open_cases":0, "active_plans":0,
 "filed_liens":0, "aging_by_fund":{...}}
```

No `reserve_funded_pct`, no `occupancy_pct`, no `units`. The dashboard reads all
three — `frontend-mock/app/(app)/dashboard/page.tsx:141,143,148,149`.

**Fix (backend):** extend `exec_dashboard()` in
`backend/app/services/board_reports.py:131-154` to compute and return:

- `units` — from `tenants.num_units` (120 for Pinecrest), or a count of
  distinct occupied units.
- `occupancy_pct` — occupied units / `num_units` × 100.
- `reserve_funded_pct` — reserve fund balance / reserve study target × 100;
  return `0` (not `null`) when no reserve study exists.

**Also guard the frontend** so a missing key degrades to `—` rather than
printing `undefined`. The template-literal pattern `` `${x}%` `` is the culprit;
it stringifies `undefined` happily.

### 4.2 Vendors list shows `NaN`, `—` and wrong counts

With one active vendor present, the page shows:

- `VENDORS 1` / **`0 active`** — wrong (the casing bug from §3.4a,
  `vendors/page.tsx:46`)
- `SPEND THIS YEAR —` — `VendorOut` has no `ytd_spend` (`page.tsx:47,95,169,175,177,239`)
- `OPEN COMMITMENTS NaN` — `VendorOut` has no `open_pos`; summing `undefined`
  gives `NaN` (`page.tsx:88,150`)
- `MISSING PAPERWORK 1` — `VendorOut` has no `w9_on_file`, so `!undefined` is
  always true and every vendor looks non-compliant (`page.tsx:48,101,245`)
- **Trade column blank** — no `category` (§3.3)

**Fix:** add `category`, `ytd_spend`, `open_pos` and `w9_on_file` to `VendorOut`
in `backend/app/schemas/financials.py:49-66` and populate them in the vendors
list endpoint (`ytd_spend` from posted AP distributions for the current year,
`open_pos` from POs not yet closed). Normalise `status` to uppercase in the
serializer, or make every frontend comparison case-insensitive.

**Latent crash on the same page:** `vendors/page.tsx:40` calls
`v.category.toLowerCase()` inside the search filter. Once `category` is
undefined and a user types anything into the vendor search box, this throws and
takes the page down. Fixing `category` resolves it; add `?.` regardless.

### 4.3 Failed saves hang forever with no error shown

**This is why §3.3 and §3.4 look like "nothing happens" instead of "that
failed".** Both modals do:

```tsx
setBusy(true);
await onCreate({ ...draft });   // throws on 422
setBusy(false);                 // never reached
```

(`vendors/page.tsx:424-440`, `payables/page.tsx:451-457`.) The rejection escapes
as an unhandled promise, `busy` stays `true`, the button reads "Adding…" /
"Saving…" permanently, and the user is told nothing.

**Fix:** wrap in `try/catch/finally`, surface `ApiError.message` in an `Alert`
inside the modal, and reset `busy` in `finally`. `ApiError` already carries a
formatted message — the console showed
`ApiError: vendor_number: Field required; category: Extra inputs are not permitted`,
which would have been perfectly actionable if displayed.

**Audit every modal in the app for this pattern**, not just these two. It is the
single highest-value fix here: it converts silent dead-ends into visible errors.

### 4.4 Payment Gateway shows `undefined%`

`/gateway` renders `CARD PAYMENTS Disabled undefined% + —`. Same root cause
family as §4.1 — a percentage field the gateway config endpoint doesn't return.
Fix the backend payload or guard the template literal.

---

## 5. P2 — Minor / polish

1. **Purchasing list doesn't refresh after create.** `POST /purchasing` returned
   `201` and the flash said "Purchase order created", but the table still read
   "No POs." until a manual reload. Re-fetch the list (or optimistically insert)
   in the create handler.
2. **Hardcoded dates in Receivables modals.** "Run Monthly Assessments" defaults
   to invoice date `2026-03-01` / due `2026-03-15`, and the receipt modal
   defaults to `2026-02-20` — five months stale
   (`app/(app)/receivables/page.tsx:26-31`). Default to today / today+15.
3. **GL batch detail shows stale journal status.** After the batch reached
   `APPROVED` and then `POSTED`, the individual journals on
   `/gl/{batchId}` still displayed a `DRAFT` badge. Cosmetic, but confusing on
   an audit screen.
4. **`/portal/communities` is unauthenticated and enumerates every tenant.**
   It returns the full community list — including the seeded demo tenant "Casa
   Harmony Master Association" — to anyone on the internet. Two consequences:
   real residents see a demo community in their sign-in dropdown, and the
   customer list is public. At minimum filter `is_demo`; consider having the
   resident type their community slug instead of picking from a list.
5. **Cash flow chart axis when all values are zero** renders
   `$0k / $0.001k / $0.002k…`. Clamp the axis to a sensible minimum.
6. **No segregation of duties on GL batches.** The same user submitted,
   approved and posted the batch. Expected for SUPERADMIN, but confirm a
   non-superadmin preparer cannot approve their own batch before go-live.

---

## 6. Not yet tested — needs credentials from you

I only had the superadmin password (recovered from
`backend/scripts/reset_superadmin.py`). These accounts exist in the live
database but I could not sign in as them:

| Email | Role |
|---|---|
| `admin@pinecrest.com` | SYSADMIN |
| `dave.manager@pinecrest.com` | HOA_ADMIN |
| `sarah.accountant@pinecrest.com` | ACCOUNTANT |
| `johnsmith` (john.smith@example.com) | Resident portal |

Still outstanding as a result:

- **RBAC enforcement per role.** Superadmin holds `["*"]`, so nothing I did
  exercised a permission boundary. The `/users` screen reports SYSADMIN 42
  permissions, HOA_ADMIN 37, ACCOUNTANT 25 — none of that was verified against
  actual server behaviour. Per `AGENTS.md` rule 4 this is the check that
  matters most.
- **The whole resident portal past the login screen** — statements, payment,
  requests, documents, MFA.
- **Resident invite / accept-invite / forgot-password** end to end.
- **Whether invite emails actually send.** New users are created with
  `send_invite: true` and no password. If SendGrid is unconfigured on Railway,
  `app/services/email` falls back to logging and **nobody can ever log in to a
  newly created account.** Worth checking the Railway env before go-live —
  including for the QA user I created (see §7).

Send me those passwords and I'll run the same sweep per role.

---

## 7. Test data I created in your live database

Please clean these up (or tell me to):

| What | Where | ID / marker |
|---|---|---|
| Vendor `GreenLeaf Landscaping LLC` | `/vendors` | `V-1001` |
| Purchase order | `/purchasing` | `PO-000001`, $12,000, INCOMPLETE/DRAFT |
| Billing plan `Monthly Assessment 2026` | `/ar-billing` | MONTHLY_FEE, $350 |
| **2 assessment invoices, $250 each** | `/receivables` | `ASMT-000001`, `ASMT-000002` — one is the duplicate from §3.5 |
| **Posted GL batch, DR/CR $500** | `/gl` | `AR Assessments AUG-2026`, status POSTED |
| Service desk ticket | `/service-desk` | "Sprinkler head broken at pool gate" |
| Staff user `Test Viewer QA` | `/users` | `qa.viewer@pinecrest.com`, VIEWER |

The GL batch is **posted**, so it needs a reversing journal rather than a
delete.

---

## 8. Suggested fix order

1. §4.3 — error surfacing in modals. *Everything else gets easier to diagnose.*
2. §3.5 — homeowner uniqueness + clean the duplicate. *It is billing wrong.*
3. §3.3 + §3.4 — vendor and AP invoice contracts. *Unblocks the whole AP chain.*
4. §3.1 + §3.2 — the two crashing pages.
5. §4.1 + §4.2 + §4.4 — the KPI payload gaps.
6. §5 — polish.

**Root-cause note.** Items 3.1–3.4, 4.1, 4.2 and 4.4 are all the same bug in
different clothes: a screen still shaped like `lib/mock-data/` rather than the
live API. Before go-live it is worth doing a deliberate pass — for each screen,
diff the fields the component reads against the Pydantic `*Out` schema, and diff
each POST body against the `*Create` schema. `extra: "forbid"` means every one
of those mismatches is a hard 422, not a soft degradation. Generating a
TypeScript client from the OpenAPI schema at `/docs` would make this class of
bug impossible to reintroduce.
