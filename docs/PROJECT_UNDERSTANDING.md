# Casa Harmony — Understanding the Project

A plain-English guide to what this product is, who uses it, how the code is
organised, and what the `frontend-mock` demo actually does today.

---

## Part 1 — The 5-minute version

### What is an HOA?

In America, when you buy a house in a planned community (a condo building, a
gated community, a townhouse complex), you don't only own your house. You also
automatically become a member of a **Homeowners Association (HOA)** — a small
non-profit corporation that owns and runs everything *shared*: the roads, the
pool, the gym, the lobby, the roof, the landscaping, the security gate.

The HOA is basically **a tiny local government for one neighbourhood**.

**How it works:**

1. Every homeowner pays a monthly fee — called **HOA dues** or **assessments**
   (typically $200–$700/month). This is not rent and not tax. It is the
   community's own money.
2. The HOA collects that money and spends it on shared expenses — pool cleaning,
   elevator maintenance, insurance, landscaping, security guards, trash.
3. Homeowners elect a **Board of Directors** from among themselves (President,
   Treasurer, Secretary). The Board are unpaid volunteer neighbours. They make
   decisions and approve spending.
4. Because volunteers don't have time to run a business, most HOAs hire a
   **Property Management Company**. That company employs **Property Managers**
   and **Accountants** who do the day-to-day work: answer complaints, hire
   plumbers, pay bills, send invoices, keep the books.
5. There are **rules** (called CC&Rs — noise limits, no red front doors, no
   parking on the street). If you break them you get a **violation notice** and
   eventually a fine.
6. If you don't pay your dues, the HOA can escalate: reminder letters
   (**dunning**), then a **payment plan**, then legal **collections**, and
   ultimately a **lien** on your house — a legal claim that blocks you from
   selling until you pay.

**Two pots of money** (this matters a lot in the code):

- **Operating Fund** — day-to-day money. Pays this month's bills.
- **Reserve Fund** — long-term savings. The roof will need replacing in 12
  years and will cost $400,000, so a little is saved every month. A **Reserve
  Study** is a professional report saying how much to save. American law in most
  states requires HOAs to keep these funds separate and report on them.

That separation is why the accounting in this system is **fund accounting**, not
plain business accounting.

### What is this product?

**Casa Harmony = Service Desk + ERP for HOAs**, sold as SaaS to property
management companies.

- **Service Desk half** — residents report problems ("water leaking in the
  lobby"), staff triage them, assign a vendor, and track them to closed.
- **ERP half** — the full accounting back office: chart of accounts, budgets,
  purchase orders, vendor bills, homeowner invoices, payments, bank
  reconciliation, fixed assets, financial reports, period close.

The ERP half is modelled deliberately on **Oracle E-Business Suite** — that's why
you see Oracle vocabulary everywhere: Key Flexfield, Chart of Accounts segments,
value sets, code combinations, subledgers, GL journal batches, encumbrances,
3-way matching, dunning, distribution sets. If a term looks strange, it's Oracle
ERP terminology, not something invented here.

**Multi-tenant** means one running system serves many HOAs at once. In this
codebase the word **"tenant" means one HOA** — not a renter. (A renter is called
a *resident* with `resident_type = RENTER`. Don't mix these up; it's the single
most confusing naming choice in the project.)

### The one sentence that ties it together

> A resident reports a leak → staff turn the ticket into a purchase order for a
> plumbing vendor → the Board approves it → the plumber sends a bill → the bill
> is matched against the PO → it gets paid from the Operating Fund → the expense
> hits the General Ledger → it shows against the budget → the Board sees it on
> their dashboard → and every homeowner's monthly dues that funded it flow
> through the same ledger.

That single chain is the whole product. Every menu item in the sidebar is one
station along it.

---

## Part 2 — The codebase

### Top-level layout

```
casa-harmony/
├── backend/         FastAPI + PostgreSQL — the real system (complete)
├── frontend/        Next.js 15 app — the real UI, talks to the backend
├── frontend-mock/   A COPY of frontend with fake data — the client demo
├── docs/            Schema, security, compliance, deployment notes
├── infra/           nginx, postgres, AWS config
└── docker-compose.yml
```

### Backend (this part is genuinely built)

- **FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 + Alembic migrations**
- **37 API modules** under `backend/app/api/v1/` — auth, tenants, rbac, coa, gl,
  payables, purchasing, receiving, ar_billing, collections, dunning, cash,
  fixed_assets, budgeting, service_desk, documents, notifications, portal,
  scheduler, migration, compliance, gateway, privacy, and more.
- **35 model files** under `backend/app/models/`, **44 service files** under
  `backend/app/services/`.
- **Isolation between HOAs is enforced twice**: every tenant table carries a
  `tenant_id`, *and* PostgreSQL Row-Level Security policies enforce it at the
  database layer, so even a buggy query cannot leak one HOA's data to another.
- **Security scaffolding**: JWT + bcrypt, TOTP MFA for staff, one-time email/SMS
  codes for residents, Fernet field-level encryption for sensitive columns
  (phone numbers, MFA secrets), immutable audit logging, PCI card tokenization,
  CCPA data-subject request flows.

### The two front-ends — important

`frontend/` and `frontend-mock/` are **near-identical copies**. Only 18 files
differ. The mock is not a separate design; it is the real UI with the network
layer replaced.

Two files do all the faking:

**`frontend-mock/lib/api.ts`** — `apiFetch()` never calls the server. It waits
300 ms to look like a real network, then runs a long `if / else` chain matching
the request path and returns hardcoded JSON. Anything it doesn't recognise
returns `[]` (an empty array). That fallback is why unfinished pages render as
empty tables instead of crashing.

**`frontend-mock/app/providers.tsx`** — there is no real login. The auth state is
hardcoded on load: you are `demo@casaharmony.ai`, `isSuperadmin: true`, with
memberships in "Sunnyvale HOA" (SUPERADMIN) and "Oakridge HOA" (ADMIN). Opening
the app drops you straight into the dashboard.

**Consequence:** the mock is **read-only theatre**. `apiFetch` ignores the HTTP
method entirely — a POST returns the same canned data as a GET. So every "Create
Ticket", "Save", "Approve", "Upload" button in the demo does nothing persistent.
The modal opens, you type, you submit, and nothing changes.

### Coverage reality check

The mock router in `lib/api.ts` handles about **25 request paths**. The pages
across the app call roughly **90 distinct paths**. So:

| State | Pages |
|---|---|
| Have real-looking data | Dashboard, Service Desk, Residents, Documents, Notifications, Users & Roles, HOAs/Tenants, Vendors, Payables, Budgets, Chart of Accounts, Value Sets, Board Dashboard, Go-Live, Receivables (aging), GL (batch list), Purchasing (partial) |
| Render but are empty | Cash & Bank Rec, Fixed Assets, AP Setup, Payments, Receiving, Encumbrances, AR Billing, Collections, Statements, Dunning, Period Close, Approvals, Payment Gateway, Scheduler, Reports, Data Migration |

Roughly **half the sidebar is a working demo; half is an empty shell.**

### The Resident Portal is currently broken in the mock

`frontend-mock/app/portal/page.tsx` and `portal/login/page.tsx` do **not** use
`apiFetch`. They call raw `fetch()` against `API_BASE`
(`http://localhost:8000/api/v1`). With no backend running, the portal shows an
error and bounces to the login screen. If the client asks "what does a homeowner
see?", there is currently nothing to show. This is the single biggest gap in the
demo.

---

## Part 3 — Users, roles and access (your specific question)

There are **two completely separate identity systems**. This is the key concept.

### System A — Staff (`users` table)

Defined in `backend/app/models/identity.py`. A `User` is **platform-global** —
one login, one email, one password, valid across the whole platform. Access to a
particular HOA comes from a **Membership**, which is a `(user, tenant, role)`
triple.

```
User "jane@pm-company.com"
  ├── Membership → Sunnyvale HOA  as HOA_ADMIN
  ├── Membership → Oakridge HOA   as ACCOUNTANT
  └── Membership → Pinecrest HOA  as VIEWER
```

Jane logs in once and switches HOAs from the dropdown in the header. Her powers
change per HOA. This is exactly how a property management company works — one
manager handles several communities with different levels of responsibility in
each.

**`is_superadmin` is a flag on the user row, not a membership.** A SUPERADMIN
bypasses tenant scoping entirely and implicitly holds every permission.

### The five system roles

Defined in `backend/app/core/permissions.py`:

| Role | Real-world person | Scope | Powers |
|---|---|---|---|
| **SUPERADMIN** | The SaaS vendor (you) | Whole platform | Everything. Creates new HOAs, suspends tenants. Only role that sees the "HOAs (Tenants)" menu. |
| **SYSADMIN** | Senior staff at the management company | Many HOAs | Everything except creating/suspending tenants. |
| **HOA_ADMIN** | Property Manager | One HOA | Full operational + financial control of their community. |
| **ACCOUNTANT** | Bookkeeper / Controller | One HOA | All financial modules. **No** user/role management, no approval-hierarchy config. |
| **VIEWER** | Board member, auditor | One HOA | Read-only — currently only `coa.read`. |

### Permissions

There are **~50 permission codes** in `PERMISSIONS`, each a string like
`ticket.manage`, `ap.approve`, `document.manage`, `collections.manage`,
`gl.batch.approve`. Roles are bundles of these codes. Every backend endpoint
declares what it needs:

```python
principal: Principal = Depends(require_permission("ticket.manage"))
```

Roles are stored in a `roles` table with a **nullable `tenant_id`** — NULL means
a system role shared by all HOAs; a set value means an HOA defined its own custom
role. So custom roles are supported by design.

**A gap worth naming now:** the VIEWER role only has `coa.read`. A real Board
member needs to *see* the budget, financial reports, the board dashboard, open
tickets, and documents — without being able to change anything. A
`BOARD_MEMBER` read-only role is missing and the client will very likely ask for
it. It's a small addition (one entry in `SYSTEM_ROLES`).

**A second gap:** the frontend does **not** enforce permissions. The sidebar only
checks `superadmin` to hide the Tenants link. Everything else is visible to
everyone, and the backend is the only thing saying no. For a demo where you want
to show "an accountant sees a smaller app than a manager", the UI needs
permission-aware rendering.

### System B — Residents (`residents` table)

Defined in `backend/app/models/resident.py`. **Completely separate from staff
users.** A `Resident` is a self-service portal login for a homeowner or renter.

- Username is unique **within one HOA**, not globally.
- `resident_type` is `OWNER` or `RENTER`.
- One resident → many units, through `ResidentUnit`. Each unit is an AR account
  (a row in `ar_homeowners`). So a landlord who owns three condos has one login
  and sees three units. Co-owners of one unit each get their own login.
- Residents get MFA by **one-time code over email or SMS** — not authenticator
  apps, deliberately, because residents aren't technical. Enabled by default.
- Phone numbers are encrypted at rest.
- Residents log in at `/portal/login`, staff at `/login`. Different tokens
  (`casa_portal_token` vs the staff auth key), different endpoints
  (`/api/v1/portal/*`), different UI entirely.

**Summary of every human in the system:**

```
SUPERADMIN ─ you, the SaaS vendor
SYSADMIN ─── management company senior staff (many HOAs)
HOA_ADMIN ── property manager (one HOA)
ACCOUNTANT ─ bookkeeper (one HOA)
VIEWER ───── board member / auditor (read-only, currently too narrow)
RESIDENT ─── homeowner or renter (separate portal, own units only)
VENDOR ───── ⚠️ has NO login. Exists only as a data record.
```

---

## Part 4 — Your two specific asks

### (a) "There need to be things to upload"

The **backend already supports uploads properly.** The model is
`DocumentAttachment` in `backend/app/models/documents.py`:

- `entity_type` + `entity_id` — a *polymorphic attachment*. A file can hang off
  any business object: an AP invoice, a purchase order, a ticket, a fixed asset,
  a board meeting.
- `filename`, `content_type`, `size_bytes`, `storage_key` (bytes stored on
  server under a UUID key), `uploaded_by`, `notes`.
- `homeowner_id` — an optional link so a document can be exposed to one resident
  in their portal.
- Downloads are permission-gated behind `document.manage`.
- API lives in `backend/app/api/v1/documents.py`.

**What's missing is the front-end.** `frontend-mock/app/(app)/documents/page.tsx`
lists four hardcoded fake documents. There is no drag-and-drop zone, no file
picker, no progress bar, no preview, no per-entity "Attachments" panel on the
ticket / invoice / PO detail screens.

For the demo you can build a **fully convincing** upload experience with no
backend at all: accept the file in the browser, hold it in React state (and a
`URL.createObjectURL` for preview), and render it in the list. It looks and feels
completely real for a demo. Wiring it to the live API afterwards is a small
change to one function.

### (b) "If I send a ticket to a vendor, it should appear in the other user's inbox"

This is the right instinct, and it's the most important thing to understand
before you build it. **Right now this does not work, and it can't, for a
structural reason.**

**What exists today:**

- `ServiceTicket` has a `vendor_id` and an `assigned_to` (a user id), plus
  `estimated_cost` and `po_header_id`. So a ticket *can* be pointed at a vendor
  and converted into a Purchase Order — that hook is real
  (`backend/app/api/v1/service_desk.py`, `TicketToPo`).
- `Notification` (`backend/app/models/notifications.py`) is a proper in-app
  inbox: `recipient_user_id` OR `recipient_role_code` (so you can notify "all
  board members"), plus `category`, `message`, `entity_type`, `entity_id`,
  `is_read`. That is exactly the right shape for what you want.
- There's an outbound email/SMS service (SendGrid / Twilio) in
  `backend/app/services/notifications.py`.

**The blocker:** `recipient_user_id` points at the `users` table — staff. **A
vendor is not a user.** `ap_suppliers` rows have no login, no password, no
portal. So a vendor literally cannot have an inbox to receive anything.

**You have three options. Decide this with the client before building.**

| Option | What it means | Effort |
|---|---|---|
| **1. Email only** | Ticket assigned to a vendor sends them an email with a magic link to a single read-only page. No login, no portal. | Small |
| **2. Vendor Portal** | Build a third identity system alongside staff and residents: vendor logins, their own portal showing assigned tickets, ability to accept, update status, upload photos and quotes, submit invoices. | Large — this is a whole new product surface |
| **3. Internal only** | "Assign to vendor" is just a data field. The real inbox notification goes to the **staff member** who owns the ticket. | Already 80% built |

**My recommendation:** demo **Option 3** now — it's genuinely close to working —
and *show* Option 1 or 2 as a mocked screen to see how the client reacts. Option
2 is a significant scope increase and should be priced separately.

**What to build for the demo (all UI-only, no backend):**

1. Ticket detail drawer with an **Activity Timeline** (created → assigned →
   vendor accepted → work done → closed) and a comment thread.
2. **Assign to Vendor** action that appends a timeline entry and — in the same
   client-side state — pushes a new row into the notifications list.
3. A **bell icon with an unread badge** in the header, opening a dropdown inbox.
   Notifications page already exists; connect them to shared state.
4. A **role switcher in the demo header** (Manager / Accountant / Board /
   Resident / Vendor). Switching re-renders the sidebar and the inbox for that
   role. This is the single most persuasive thing you can show a client — it
   makes the whole multi-role story visible in ten seconds.

If notifications live in one shared React context (or `localStorage`), then
assigning a ticket as the Manager and switching to the Vendor view to see it
arrive works **completely, live, in the browser, with zero backend**. That demo
lands very well.

---

## Part 5 — Suggested order of work

**Phase 0 — make the demo trustworthy (do this first)**

1. Move all mock data out of the `if/else` chain in `lib/api.ts` into a
   `lib/mock-data/` folder, one file per domain.
2. Make `apiFetch` honour the HTTP method: POST/PATCH/DELETE mutate an in-memory
   store, GET reads from it. This one change makes **every** create/edit button
   in the app work for the demo.
3. Fill in mock data for the ~16 currently-empty pages.
4. Fix the Resident Portal so it uses the mock layer instead of raw `fetch`.

**Phase 1 — the demo story** (this is what the client actually watches)

5. Demo role switcher in the header.
6. Ticket detail drawer + timeline + comments + assign-to-vendor.
7. Shared notification state + header bell with unread badge.
8. Real drag-and-drop file upload UI (client-side only) on Documents, plus an
   Attachments panel on ticket / invoice / PO details.

**Phase 2 — polish**

9. Visual pass: empty states, loading skeletons instead of spinners, consistent
   spacing, charts on the dashboards.
10. Add a `BOARD_MEMBER` read-only role and make the sidebar permission-aware.

**Phase 3 — after client approval**

11. Wire `frontend/` (the real one) to the live backend, module by module,
    reusing every component built in Phases 1–2.

The important structural point: because `frontend-mock` is a copy of `frontend`,
**every UI improvement made in the mock is directly portable to the real app.**
Nothing built for the demo is throwaway — only `lib/api.ts` and `providers.tsx`
get swapped back. Keep that boundary clean and the demo work is real work.

---

## Glossary (Oracle-ERP and HOA terms you'll keep hitting)

| Term | Meaning |
|---|---|
| **Tenant** | In this codebase: **one HOA**. Not a renter. |
| **Assessment / Dues** | The monthly fee each homeowner pays. |
| **Operating vs Reserve Fund** | Day-to-day money vs long-term savings. Kept separate by law. |
| **Reserve Study** | Professional report saying how much to save for future big repairs. |
| **CC&Rs** | The community rulebook. |
| **Lien** | Legal claim on a house for unpaid dues — blocks a sale. |
| **Dunning** | Automated escalating reminder letters for late payment. |
| **COA (Chart of Accounts)** | The numbered list of every account money can go into. |
| **KFF (Key Flexfield)** | Oracle's configurable account-code structure. |
| **Segments** | Parts of an account code, e.g. `10-100-1000` = Fund-Department-Account. |
| **Value Set** | The allowed values for one segment. |
| **Code Combination** | One valid full account code. |
| **GL (General Ledger)** | The master book of all financial transactions. |
| **Subledger** | A detailed book (AR, AP) that summarises into the GL. |
| **AR / AP** | Money owed **to** the HOA / money owed **by** the HOA. |
| **PO (Purchase Order)** | Approved commitment to buy something from a vendor. |
| **3-way match** | Invoice must agree with the PO and the goods receipt before paying. |
| **Encumbrance** | Money reserved by a PO but not yet spent. |
| **Period Close** | Locking a month so its numbers can't change. |
| **Distribution Set** | A saved rule for splitting a cost across accounts. |
