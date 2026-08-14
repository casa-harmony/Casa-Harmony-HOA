# Day zero to a working community

Architecture review and remediation plan. Why a platform administrator cannot
currently use the product they just deployed, what the architecture is missing,
and the sequenced work required to close it.

Reviewed 2026-08-14 against `develop` @ `9c1bb09`, by source read plus live API
probes against a running backend. Findings in this document were confirmed, not
inferred; the evidence is in the last section.

---

## Verdict

The backend is a substantially complete multi-tenant HOA ERP — 248 endpoints,
row-level security, double-entry GL, AP/AR/cash/collections/fixed-assets. The
frontend is 45 finished screens. Neither is the problem.

**The problem is that nothing in the product knows how to bring a community into
existence.** Creating an HOA is treated as inserting one row, when it is actually
a twelve-part provisioning transaction. And the one person authorised to do it —
the platform SUPERADMIN — is the one identity the permission model gives no place
to stand: they hold no membership, so the frontend hands them an empty community
list, an empty sidebar, and a `400` on every tenant-scoped request.

Both are architectural omissions, not bugs. They are also the whole of the
problem: fix those two and roughly thirty downstream symptoms stop existing.

The expensive work — the ledger, the isolation model, the subledgers, the screens
— is already done and is good.

---

## Part 1 — What you actually have

| Layer | State | Assessment |
|---|---|---|
| Backend domain model | Solid | 36 model modules, 34 migrations, tenant mixin + RLS policy per table. Money is `numeric(18,2)`. Fund accounting enforced at the distribution layer. |
| Backend service layer | Solid | Business rules live in `app/services/`, not handlers. GL posting balances. Period close blocks on unfinished batches. |
| Tenant isolation | Solid | Transaction-local GUCs via `set_config(..., true)`, app connects as a `NOBYPASSRLS` role. Defence in depth done properly. |
| Frontend screens | Built | 45 routes, one component kit, one data-access seam (`apiFetch`). The transport switch is the right design. |
| Tenant onboarding | **Absent** | No provisioning concept anywhere. Three half-recipes in three places (D2). |
| Platform-admin scope | **Broken** | Superadmin has no tenant context mechanism. Empty nav, empty switcher, `400`s (D1). |
| Identity lifecycle | Partial | Create only. No list/revoke memberships, no user update, no admin password reset, no invitations. |
| Resident portal | **Mock only** | Backend portal API is complete and token-scoped. The frontend portal never calls it. |
| Reports screen | **Dead** | ~40 export endpoints exist across modules; no catalog endpoint, so the screen renders nothing. |
| Frontend auth model | Transitional | Still persona-shaped. Navigation keys off a role *code*, not the server's permission list. |

### The shape of the seam

Everything hinges on one contract. A staff request carries a bearer token (who
you are) plus an `X-Tenant-Id` header (where you are standing). Middleware
resolves both into a request context; the session dependency binds them to
PostgreSQL as RLS variables; the RBAC dependency resolves your permissions
*within that tenant* by looking up your membership.

That contract is correct. The defect is that the frontend obtains the list of
places you may stand from *one* source — the memberships returned at login — and
a superadmin has none, by design.

---

## Part 2 — Five architectural defects

Everything reported as "not working" traces back to these, ordered by how much
else they unblock.

### D1 — Platform scope has no tenant context  · BLOCKER

There are three distinct things in the authorisation model: *who you are* (a
platform-global user), *where you are standing* (the active tenant), and *what
you may do there* (membership → role → permissions). The system conflates the
second and third: the only way to acquire a tenant context is to hold a
membership in it.

A superadmin deliberately holds no memberships. Login returns `memberships: []`
— confirmed against the live API. The frontend builds its community list from
that array, so `activeTenantId` stays `null`, no `X-Tenant-Id` is sent, and every
tenant-scoped endpoint returns `400 "X-Tenant-Id header is required for this
operation"`.

Separately, navigation is computed from the role code of the active membership
(`navFor` in `frontend-mock/lib/rbac.ts:368`). With no membership the role code
is the empty string, `ROLES[""]` is undefined, and the sidebar renders **zero
items**.

This is why day zero looks like a broken app rather than an empty one. The fix is
not a patch — it is introducing *platform scope* as a first-class concept
distinct from membership.

### D2 — Creating a community is not a transaction  · BLOCKER

A usable HOA requires roughly twelve things to exist. Three places know
overlapping subsets, and none knows the whole:

- `POST /tenants` creates the tenant row and the COA structure. Nothing else.
- `scripts/create_community.py` creates the tenant, the COA structure, an admin
  user with a membership, and optionally residents. No GL combinations, no
  calendar, no masters.
- `scripts/seed.py` is the only thing that creates **GL code combinations**, a
  bank, a bank account, and a vendor — and only for the hard-coded demo tenant.

GL code combinations are the hard blocker. The posting engine resolves accounts
by (natural account, fund) and raises *"Missing GL account for natural 4000 /
fund OPER"* when no combination matches (`_account()` in
`backend/app/services/subledger_accounting.py:62`).

**Verified:** the community created through the UI has **0** combinations; the
seeded demo has **9**. Every accounting action in a UI-created community
therefore fails — invoices, receipts, payments, journals, depreciation.

Provisioning must become one named service with a declared output contract,
called by the API, the script, and the seed alike.

### D3 — No concept of how ready a community is  · STRUCTURAL

A freshly created community legitimately has no residents, no invoices, no bank
statements. Every screen renders that identically to a failure: an empty table
with no explanation. There is no way for the UI to say "this is empty because you
have not done step 4 yet" versus "this is empty because something is wrong".

The backend already computes most of the underlying facts — the go-live health
endpoint counts COA structures, vendors, open periods, posted batches. What is
missing is a per-tenant *readiness* resource expressing setup as an explicit
ordered state machine, and screens that consult it for their empty states.

Without this an administrator has no path through the product. They see 45 menu
items and no indication which three matter today.

### D4 — The frontend is still shaped like the demo  · STRUCTURAL

The transport seam is right, but four things leak through it.

**Mock constants imported at module scope.** The Communities, Users, Login, and
both Portal screens import the mock `TENANTS` / `PERSONAS` arrays directly. In
live mode the Users screen's "Assigned Community" dropdown offers *fictional
tenant IDs*, and both portal screens are driven entirely by the in-browser store.

**Field shapes invented by the demo.** Screens read `role_code`, `title`,
`tenant_ids` on users and `monthly_dues`, `kind` on tenants. None exist
server-side. Writes silently drop them (Pydantic ignores extras) and reads return
`undefined` — which is why the Communities screen shows $0 billing and the Users
table crashes on `role_code.toLowerCase()`.

**Navigation driven by role code, not permissions.** `lib/rbac.ts` is documented
as presentation-only, but it is the sole input to the sidebar. The authoritative
permission list from `/auth/me` is fetched and then largely unused for
navigation. A server-side custom role has no sidebar at all.

**Twelve endpoints that do not exist.** Enumerated in Part 5.

### D5 — Controls that are advisory where they must be enforced  · PRE-LAUNCH

Not day-zero blockers, but hard gates before any real association's money is in
the system:

- `must_change_password` is returned to the client and **never enforced**. A user
  created with a temporary password can call every endpoint indefinitely. Only
  the UI routes them to the change-password screen, and the UI is not an
  authorisation boundary.
- Factory-default superadmin and sysadmin credentials are committed to the
  repository in `docs/COMMUNITIES.md`, and the same password is the default value
  of the `SUPERADMIN_PASSWORD` setting.
- A superadmin's session sets `app.is_superadmin = 'on'`, which every RLS policy
  honours as a full bypass. Any endpoint relying on RLS alone rather than an
  explicit `tenant_id` filter returns cross-tenant rows for that session. The
  user list is a confirmed instance: it returns every user on the platform even
  with a community selected.
- No rate limiting on `/auth/login` or `/portal/login`.
- 60-minute access token, no refresh path. Sessions die mid-task and bounce to
  the sign-in screen with no warning.
- The frontend portal identifies a resident by passing their id as a query
  parameter. The backend correctly ignores it, but the pattern must be deleted
  rather than left for someone to implement server-side later.

---

## Part 3 — The target architecture

Three additions. Each is a concept the system currently lacks, not a refactor of
something it has.

### 1. Scope as a first-class concept

Split the two things "membership" currently does. Introduce an explicit notion of
the **scope** a request is made in:

| Scope | Who holds it | Tenant context comes from | Permissions |
|---|---|---|---|
| `platform` | Users with `is_superadmin` | Any existing tenant, selected freely — no membership required | All |
| `tenant` | Everyone else | Tenants they hold an active membership in | Union of that membership's role permissions |
| `resident` | Portal logins | Bound into the token; never client-selectable | Own units only |

The practical consequence: the community switcher must be fed by a dedicated
endpoint that answers *"where may I stand?"* rather than by the login response's
membership array. For platform scope that answer is "every tenant"; for tenant
scope it is "your memberships". One endpoint, two answers, one frontend code
path.

Every platform-scope tenant selection should be written to the audit log. A
superadmin standing inside an association's ledger is exactly the event an
auditor will ask about.

### 2. Provisioning as a declared contract

One service function, one output contract, three callers. When it returns
successfully, the community is guaranteed usable.

| # | Output | Why it is required | Exists today in |
|---|---|---|---|
| 1 | Tenant row | The isolation boundary | API · script · seed |
| 2 | COA structure, segments, value sets, values | Nothing can be coded to an account without it | API · script · seed |
| 3 | **GL code combinations** for every account the posting engine references | Hard blocker — all posting fails without these | **seed only** |
| 4 | Fiscal calendar — 12 periods for the current and next year | Periods screen is otherwise empty and uncreatable from the UI | **nowhere** |
| 5 | Budget control settings row | Budget and encumbrance screens read it; health reports `NONE` | **nowhere** |
| 6 | AP config — payment terms, vendor types, payment methods, distribution sets | No vendor invoice can be entered without terms | **nowhere** |
| 7 | Bank and operating bank account | Prerequisite for payments and reconciliation | seed only |
| 8 | Default approval hierarchy | Submit-for-approval silently has no route otherwise | **nowhere** |
| 9 | Late-fee rule and dunning rules | Collections screens read them | **nowhere** |
| 10 | Go-live checklist items | Already has a seeding helper; call it here | lazily, on first read |
| 11 | First administrator: user + SYSADMIN membership, atomically | Otherwise the community has no one who can enter it | script only |
| 12 | Audit record of the provisioning | Compliance | API only |

> **Design constraint.** Make items 7, 9 and the resident set *optional inputs*,
> not unconditional defaults. Fabricating a bank account for a real association is
> worse than leaving the slot empty — the readiness resource is what surfaces the
> gap. Items 1–6, 8, 10–12 should be unconditional.

### 3. Readiness as an ordered state machine

A per-tenant resource that answers "what is the next thing to do here". Six
stages, each with machine-checkable conditions:

| Stage | Complete when | Unlocks |
|---|---|---|
| `IDENTITY` | At least one active non-superadmin membership exists | Someone other than the platform admin can sign in |
| `LEDGER` | COA structure enabled and combinations exist for every account the posting engine references | All accounting |
| `CALENDAR` | Periods exist for the current fiscal year, current period is OPEN | Period close, year-end, budget spread |
| `MASTERS` | ≥1 bank account, ≥1 payment term, approval hierarchy present | Vendors, purchasing, payables, payments |
| `SUBLEDGER` | ≥1 homeowner and ≥1 active billing plan | Assessments, statements, collections, portal |
| `LIVE` | Go-live validation passes and the tenant is activated | Production use |

### The day-zero journey

```
PLATFORM SCOPE — works today
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Deploy + migrate │──▶│ Seed the platform│──▶│ Sign in as admin │──╳ BREAKS HERE (D1)
│ alembic upgrade  │   │ superadmin+roles │   │ POST /auth/login │    no memberships
└──────────────────┘   └──────────────────┘   └──────────────────┘    → no tenant context
                                                                       → empty sidebar
                                                                       → 400 everywhere
TENANT SCOPE — to be built
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────────┐
│ Create community │──▶│ Provision        │──▶│ Add administrator│──▶│ Hand over    │──▶│ Configure+go live│
│ name, slug,      │   │ 12 outputs, one  │   │ user+membership, │   │ admin signs  │   │ readiness stages │
│ units, dues, tz  │   │ transaction (WP2)│   │ atomically       │   │ in, sets pw  │   │ drive the order  │
└──────────────────┘   └──────────────────┘   └──────────────────┘   └──────────────┘   └──────────────────┘
```

The top row is the only part that currently works. Everything below the break
exists as isolated endpoints and scripts, never as a flow a person can walk
through inside the product.

---

## Part 4 — Work packages, in order

Sequenced by dependency, not by size. **WP1 and WP2 unblock everything else — do
not start anywhere else.** Each package states its acceptance test; treat that as
the definition of done.

### WP1 — Give the platform admin somewhere to stand

*Resolves D1 · unblocks every screen · backend + frontend*

**Backend**

1. Add an endpoint that answers "which communities may I act in" — suggest
   `GET /auth/tenants`. Return, per tenant: id, name, slug, status, `is_demo`,
   the caller's `role_code` and `role_name` (null for platform scope), and a
   `scope` discriminator of `platform` or `tenant`. For a superadmin, return all
   tenants, excluding demo tenants unless asked for. For everyone else, return
   their active memberships. This becomes the single source for the community
   switcher.
2. Add `scope` to the `/auth/me` response so the frontend never has to infer it
   from an empty array.
3. In `backend/app/core/deps.py`, in the superadmin branch of the principal
   resolver, validate that a supplied `X-Tenant-Id` refers to an existing tenant
   and return `404` if not. Today an unknown-but-well-formed UUID binds RLS to a
   nonexistent tenant and every screen renders empty instead of erroring — an
   expensive failure to diagnose.
4. Record an audit event whenever a platform-scope principal supplies a tenant
   header for the first time in a session. Reuse the existing audit service.

**Frontend**

1. In `frontend-mock/app/providers.tsx`, live branch: populate `tenants` from the
   new endpoint instead of `live.memberships`. Keep memberships only for
   resolving the role label. Remove the localStorage membership cache — the
   endpoint makes it unnecessary, and it is currently the reason a revoked
   membership still shows in the switcher until sign-out.
2. Default `activeTenantId` to the first entry of that list and persist the
   choice. Today it defaults to `memberships[0]?.tenant_id ?? null`.
3. In `frontend-mock/lib/rbac.ts`, change the navigation builder to filter on the
   server's permission list rather than looking up a role code in a local table.
   Superadmin passes every check. Keep the local role table for labels and the
   explanatory role-comparison screens only — that is its documented purpose.
4. In `frontend-mock/app/(app)/layout.tsx`, the sidebar footer reads persona
   fields that are always null in live mode. Point it at the live user and role.
5. Handle the genuine zero-community case explicitly: when the list is empty and
   the caller is platform scope, the shell should render with a nav containing
   only the platform items (Communities, Users) and route to a create-community
   call to action. The work already started on the dashboard is the right idea —
   it needs the nav to survive too.

> **Acceptance.** Sign in as the superadmin against a database with at least one
> community. The sidebar renders. The community switcher lists communities.
> Selecting one and opening Residents, Periods, and Cash all return `200`. Then
> sign in as a SYSADMIN and confirm they see only their own communities.

### WP2 — Make provisioning one transaction

*Resolves D2 · unblocks all accounting · backend*

1. Create a single provisioning service in `backend/app/services/` that produces
   the twelve outputs in Part 3, in one database transaction, idempotent by slug.
   Model the existing COA bootstrap service for style — module docstring
   explaining *why*, business logic in the service.
2. Move the standard GL code-combination list out of `scripts/seed.py` and into
   that service. It is domain configuration, not seed data. Derive it from the
   accounts the posting engine actually references so the two cannot drift:
   operating and reserve cash, assessments receivable, accounts payable per fund,
   assessment income, the expense accounts, reserve funding transfer, and
   retained earnings per fund.
3. Add fiscal-calendar generation. Periods are currently created lazily and
   treated as implicitly open when absent, which is why the Periods screen is
   blank and offers no way to create anything. Generate twelve periods for the
   current and next fiscal year, with the current period OPEN and future periods
   FUTURE. Expose it as `POST /periods/generate` taking a year, so an
   administrator can extend the calendar later.
4. Rewrite `POST /tenants` to call the service. Rewrite
   `scripts/create_community.py` to call the same service and keep only its
   argument parsing and resident creation. Rewrite `scripts/seed.py` to call it
   for the demo tenant. After this, the three paths cannot diverge.
5. Add `POST /tenants/{id}/admins` — accepts email, full name, job title, role
   code, and either a temporary password or a request to send an invitation.
   Creates or links the user and grants the membership in one call. Today the UI
   would have to create a user, list roles, find the role id, switch tenant
   context, and post a membership; it does none of that, which is why users
   created in the UI cannot sign in anywhere.
6. Extend the tenant model and schemas with the fields the UI already collects
   and the server silently discards: `monthly_dues` as `numeric(18,2)` and a
   community kind. Add the migration. Set `extra="forbid"` on the create schema
   so the next silently-dropped field is a `422` instead of a mystery. Then
   confirm the Communities screen's billing figures stop reading zero.

> **Migration discipline.** Both new tenant columns land on an existing
> tenant-scoped table, so no new RLS policy is needed — but re-read rule 3 in
> [AGENTS.md](../AGENTS.md) before adding any new table for approval defaults or
> dunning rules.

> **Acceptance.** Create a community through the UI. Without running any script:
> confirm the combination count is non-zero, twelve periods exist, payment terms
> exist, the checklist is populated, and then post an assessment run and an AR
> receipt successfully. Purge the community and repeat via
> `create_community.py` — the resulting state must be identical.

### WP3 — Readiness resource and guided empty states

*Resolves D3 · backend + frontend*

1. Add `GET /tenants/{id}/readiness` returning the six stages from Part 3, each
   with a boolean, the failing conditions, and a suggested next action with a
   target route. Compute it from live counts — reuse the queries already in the
   go-live health service rather than storing state.
2. Add a small shared component that renders a stage's unmet condition as the
   empty state of a screen: what is missing, why this screen is empty because of
   it, and a link to the screen that fixes it. Replace the bare empty tables on
   the screens that gate on setup — Periods, Cash, Payables, Purchasing,
   Statements, Collections, Budgets, Fixed Assets.
3. Put a compact readiness strip on the dashboard showing the current stage and
   the next action. This is the administrator's path through the product; without
   it they are guessing.

> **Acceptance.** On a freshly provisioned community, every screen that cannot yet
> do anything says why and links onward. No screen shows a bare empty table. The
> dashboard names the next action, and that action advances the stage when
> completed.

### WP4 — Complete the identity lifecycle

*Users, roles, memberships · backend + frontend*

**Backend — endpoints that do not exist yet**

- `GET /memberships` filtered by tenant and by user. Currently only POST exists,
  so a granted membership can never be seen or revoked.
- `PATCH /memberships/{id}` to deactivate or change role, and
  `DELETE /memberships/{id}`.
- `GET /users/{id}` returning the user with their memberships expanded.
- `PATCH /users/{id}` — full name, job title, active flag, superadmin flag. Guard
  the superadmin flag behind superadmin, as the create path already does.
- `POST /users/{id}/reset-password` — admin-initiated, sets
  `must_change_password`, delivers by email.
- Add a job title column to the user model plus migration. The UI collects it and
  the server discards it.
- Fix the user list: for a superadmin it currently ignores the active tenant and
  returns every user on the platform. When a tenant header is present, scope to
  that tenant regardless of superadmin status; add an explicit flag for the
  deliberate platform-wide listing.

**Frontend — `frontend-mock/app/(app)/users/page.tsx`**

- Fix the create path: it posts to `/rbac/users`, which does not exist. The
  endpoint is `/users`, or preferably the new tenant-admin endpoint from WP2 so
  the membership is created too.
- Remove the mock `TENANTS` import. Feed the community selector from the
  switcher's tenant list.
- Stop reading `role_code`, `title`, and `tenant_ids` off the user object. Read
  role from the expanded memberships. Guard every string operation — the table
  currently crashes on a null full name.
- Add the membership grant and revoke controls. This screen claims in its own
  body copy that removing a membership removes access; there is currently no
  control that does it.

> **Acceptance.** As superadmin, create a community, create an administrator for
> it, sign out, sign in as that administrator, change the password, and reach the
> dashboard of that community and no other. Then revoke the membership and confirm
> the next request fails with `403`.

### WP5 — Close the twelve endpoint gaps

*Resolves the enumerated 404s · see Part 5*

Four are frontend path errors — fix the caller. Eight need server work. The full
table with exact call sites is in Part 5; work from it directly.

Re-run `frontend-mock/scripts/check-endpoints.mjs` against the running API after
each change. Note that six of its nineteen reported mismatches are false
positives — paths built as `` `/resource/${id}/${verb}` ``, which the checker
cannot resolve. Part 5 separates the real gaps from those; do not spend time on
the false positives.

> **Acceptance.** The checker reports zero unmatched paths other than the six
> known template-literal false positives, and every screen listed in Part 5
> performs its action against the live backend without a console error.

### WP6 — Put the resident portal on the live transport

*Resolves D4 for the portal · frontend, mostly*

The backend portal API is complete and correctly designed — password, then a
one-time code, then a resident-scoped token carrying the tenant so RLS binds from
the token and a resident can never select an HOA. The frontend uses none of it.

1. Rewrite `frontend-mock/app/portal/login/page.tsx` as the real two-step flow:
   community slug plus username plus password, then the one-time code. Delete the
   resident picker and the mock store import — a login screen must never
   enumerate accounts.
2. Give the portal its own token storage and session provider, kept separate from
   the staff session so the two cannot be confused. Send the token as a bearer
   header.
3. Delete the `?resident=<id>` convention from
   `frontend-mock/app/portal/page.tsx` entirely. Identity comes from the token.
4. Add the first-login password change and the forgot-password flow, both of
   which the backend already supports.
5. Backend: add a resident invitation endpoint that generates a reset token and
   emails it, so an administrator can onboard residents from the Residents
   screen. Today the provisioning script sets a random password and instructs the
   resident to use forgot-password, which is not a product flow.
6. Backend: add `PATCH /residents/{id}` — the Residents screen already calls it.

> **Acceptance.** Create a resident from the staff Residents screen, send the
> invitation, set a password from the emailed link, sign in at the portal, and see
> only that resident's units, invoices, and documents. Confirm a resident of one
> community cannot reach another's data by any request you can construct.

### WP7 — Report catalog

*Revives a dead screen cheaply · backend*

Roughly forty export endpoints already exist, scattered across modules. The
Reports screen calls a catalog and a dispatcher, neither of which exists, so it
renders nothing.

1. Add `GET /reports/catalog` returning, per report: id, name, description,
   category, the permission required, the accepted formats, and whether it takes
   a period. Filter the response by the caller's permissions so the screen only
   offers what the server would allow.
2. Add `GET /reports/{id}` as a dispatcher that validates the permission and
   delegates to the existing module export. Do not reimplement any report.
3. Frontend: replace the hard-coded period list in
   `frontend-mock/app/(app)/reports/page.tsx` with the periods endpoint. It
   currently offers five fixed month names.

> **Acceptance.** The Reports screen lists every report the signed-in role may
> run, for real periods, and each one downloads a correct file. An accountant and
> a viewer see different catalogs.

### WP8 — Security hardening

*Resolves D5 · gate before any real association*

1. **Enforce `must_change_password` server-side.** Add the check to the principal
   resolver so every route except change-password, me, and sign-out returns `403`
   with a distinguishable code the frontend can route on. This is the single
   highest-value item in this package.
2. Remove the factory credentials from `docs/COMMUNITIES.md` and delete the
   default value of the superadmin password setting so an unconfigured deployment
   fails loudly instead of booting with a known password. Rotate the existing
   accounts.
3. Audit every tenant-scoped list endpoint for an explicit `tenant_id` filter. A
   superadmin session bypasses RLS entirely, so any endpoint relying on the
   policy alone leaks cross-tenant rows for that session. The user list is one
   confirmed case; treat it as a sample, not the whole population. Consider a
   test that signs in as superadmin with a tenant header and asserts every list
   endpoint returns only that tenant's rows.
4. Add rate limiting to `/auth/login`, `/portal/login`, and both forgot-password
   endpoints.
5. Add a refresh-token path, or extend the access token and add a silent-renewal
   call. A 60-minute hard expiry with no renewal means a long accounting session
   dies without warning.
6. Confirm the CORS origin list is set explicitly in production. It falls back to
   localhost when unset.

> **Acceptance.** A user with a temporary password receives `403` from every
> endpoint except the change-password flow. The isolation script passes. Repeated
> bad logins are throttled. No default credential exists in the repository or in
> any settings default.

### WP9 — Retire the demo scaffolding

*Resolves the rest of D4 · frontend*

1. Remove every mock import outside the mock transport itself. Current offenders:
   `app/providers.tsx`, `app/login/page.tsx`, `app/(app)/tenants/page.tsx`,
   `app/(app)/users/page.tsx`, `app/portal/page.tsx`,
   `app/portal/login/page.tsx`. Add a lint rule so it cannot recur.
2. Delete the persona switcher and the compatibility shims in `providers.tsx`.
   The shims are documented as temporary and are now the reason the live and mock
   branches have different shapes. One session shape, one code path.
3. Keep the mock transport itself and keep it as the default for unconfigured
   builds — that decision in [AGENTS.md](../AGENTS.md) is sound. But bring it into
   line with the real response shapes so a screen that works in mock works live.
   Today the two disagree on user and tenant fields, which is how the field-shape
   bugs got in.
4. Leave the review and commenting feature untouched. It is inert unless its
   passcode is set and it must survive this work.

> **Acceptance.** A repository-wide search for mock-data imports outside the
> transport returns nothing. Every screen renders identically in mock and live
> mode against equivalent data. The type check is clean.

---

## Part 5 — Verified defect register

Every row below was confirmed against the running API at `127.0.0.1:8000` or by
reading the call site. Nothing here is inferred.

### Endpoints the frontend calls that do not exist

| Frontend call | Screen | Server reality | Action |
|---|---|---|---|
| `POST /rbac/users` | Users | `POST /users` exists | Fix caller · WP4 |
| `POST /service-desk/tickets/{id}/convert-to-po` | Service Desk | Endpoint is `create-po` | Fix caller · WP5 |
| `POST /migration/{id}/rollback` | Migration | Path is `/migration/batches/{id}/rollback` | Fix caller · WP5 |
| `POST /payables/{id}/pay` | Payables | Payment is created via `POST /ap-payments` | Rework the screen action · WP5 |
| `GET /reports/catalog` | Reports | None | Add · WP7 |
| `GET /reports/{id}` | Reports | None | Add dispatcher · WP7 |
| `GET /budgeting/lines` | Dashboard, Board | None | Add · WP5 |
| `POST /notifications/read-all` | Top bar, Notifications | Only `/{id}/read` | Add · WP5 |
| `GET, POST /service-desk/tickets/{id}/comments` | Service Desk | None — no comment model | Add model + migration + RLS · WP5 |
| `POST /service-desk/tickets/{id}/assign-vendor` | Service Desk | None | Add · WP5 |
| `POST /ap-payments/{id}/clear` | Payments | Only void and stop | Add · WP5 |
| `PATCH /residents/{id}` | Residents | None | Add · WP6 |

**Checker false positives — do not spend time on these.** The endpoint checker
reads string literals, so a path assembled as `` `/resource/${id}/${verb}` `` is
reported as `/resource/{id}/{id}`. These six are fine as written: GL batch
actions, period actions, receiving actions, vendor sub-resources, budget-version
actions, and purchasing report names.

### Data the UI collects and the server discards

| Field | Collected by | Consequence |
|---|---|---|
| `monthly_dues` | Create-community form | Dropped on write, absent on read. Communities screen reports $0 monthly billing for every community. |
| `kind` | Create-community form | Dropped. Community type never displays. |
| `title` | Create-user form | Dropped. The Users table has a "Job title" column that is permanently blank. |
| `role_code`, `tenant_ids` | Create-user form | Dropped. The user is created with **no membership at all** and cannot sign in to any community. |

### Runtime failures in live mode

| Symptom | Cause | Fixed by |
|---|---|---|
| Empty sidebar for the platform admin | Navigation keyed off a role code that is the empty string when no membership exists | WP1 |
| `400` on every tenant-scoped screen | No tenant context available to a superadmin | WP1 |
| Blank name and role in the sidebar footer | Reads persona fields, null in live mode | WP1 |
| Users table crashes while rendering | Unguarded string operations on fields the server does not return | WP4 |
| Community dropdown lists fictional communities | Mock tenant array imported at module scope | WP4, WP9 |
| All accounting fails in a UI-created community | Zero GL code combinations — verified | WP2 |
| Periods screen empty with no way to create anything | No fiscal calendar generation exists | WP2 |
| Reports screen renders nothing | Catalog endpoint does not exist | WP7 |
| Portal shows demo residents against a real backend | Portal frontend never migrated off the mock store | WP6 |
| User list shows every user on the platform | Superadmin branch of the list query ignores the active tenant | WP4, WP8 |
| Session dies mid-task | 60-minute token, no refresh | WP8 |
| Revoked membership still appears in the switcher | Memberships cached in localStorage; `/auth/me` does not return them | WP1 |

---

## Part 6 — Verification protocol

Run this end to end after each work package. It is the only test that actually
answers the original question — can a system administrator take delivery of this
and stand up a community.

### The day-zero rehearsal

1. Migrate a clean database and seed the platform. Nothing else.
2. Sign in as the platform administrator. **The sidebar must render.**
3. Create a community from the UI, with dues and unit count.
4. Create its administrator from the UI.
5. Confirm without touching a script: combinations exist, twelve periods exist,
   payment terms exist, the checklist is populated.
6. Sign out. Sign in as the new administrator. Change the password when forced to.
7. Confirm that administrator sees exactly one community and cannot reach any
   other.
8. Follow the readiness strip: add a bank account, a homeowner, a billing plan.
9. Run an assessment. Post it. Record a receipt. Open the trial balance and
   confirm it balances.
10. Create a resident, send the invitation, set a password, sign in at the portal,
    see one unit and one invoice.
11. Run the tenant-isolation script against the running API.
12. Close the period. Confirm it blocks on unfinished batches, then succeeds.

### Standing rules

Run the type check clean before every commit. Run the test suite against a local
Postgres, never Neon. Any migration adding a tenant-scoped table gets row-level
security and a policy in the same migration. Work in `frontend-mock/`. Do not
report a step as passing without its output. See [AGENTS.md](../AGENTS.md).

### Suggested order of attack

WP1 and WP2 in parallel if two people are available — they touch different layers
and both are prerequisites for everything else. Then WP4, then WP3. WP5 and WP7
are independent and can be picked up by anyone at any point after WP1. WP6 is
self-contained. **WP8 must complete before a real association's data enters the
system.** WP9 last, as cleanup.

---

## Part 7 — Evidence log

What was probed, and what came back. Recorded so the findings can be re-checked
rather than taken on trust.

| Probe | Result |
|---|---|
| `POST /auth/login` as superadmin | `200`, `is_superadmin: true`, `memberships: []` — the root cause of D1 |
| GET on 8 tenant-scoped endpoints, no tenant header | All `400 "X-Tenant-Id header is required for this operation"` |
| `GET /tenants` | `200` — two communities present: the seeded demo and one named `test`, created through the UI |
| COA combinations, UI-created community | **0** — every accounting posting in it will fail |
| COA combinations, seeded demo community | **9** — created only by `scripts/seed.py` |
| `GET /periods`, UI-created community | `200 []` — no fiscal calendar, and no endpoint to create one |
| `GET /users` with a tenant header, as superadmin | Returns platform-wide users, not the community's — confirms the scoping defect in D5 |
| Endpoint checker against the live API | 248 published paths, 139 requested, 19 unmatched — of which 12 real gaps and 6 template-literal false positives |
| Source read: navigation builder | Unknown role code yields an empty navigation array; superadmin has no role code |
| Source read: posting engine account resolution | Raises on a missing (natural account, fund) combination — confirms combinations are a hard blocker |
| Source read: portal frontend | Reads the in-browser store, sends no bearer token, passes the resident id as a query parameter |
| Source read: authentication config | 60-minute token, no refresh, no rate limiting, default superadmin password present in settings |

### Reproducing the probes

From `backend/` with the API running:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<superadmin-email>","password":"<password>"}'
```

The response's `memberships` array is the whole of D1. Then, with that token and
no `X-Tenant-Id` header, any of `/residents`, `/periods`, `/vendors`,
`/notifications` returns the `400`.

From `frontend-mock/`:

```bash
node scripts/check-endpoints.mjs http://127.0.0.1:8000
```
