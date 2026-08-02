# Casa Harmony AI

Secure, **multi-tenant SaaS Service Desk + ERP for Homeowner Associations (HOAs)**,
modeled rigorously on **Oracle E-Business Suite** table architecture — in particular
the **Key Flexfield (KFF) Chart of Accounts** and `GL_CODE_COMBINATIONS`.

- **Multi-tenant** with strict isolation: `tenant_id` on every tenant table **plus
  PostgreSQL Row-Level Security (RLS)** enforced at the database layer.
- **One global SUPERADMIN**; a **SYSADMIN** can administer one or many HOAs.
- **Single functional currency (USD)** — no multi-currency logic anywhere.
- **Oracle-style KFF COA**: configurable segments (6 default → 15), qualifiers,
  value sets, cross-validation rules, and validated code combinations.
- **Security & compliance scaffolding**: RBAC, JWT + bcrypt, **TOTP MFA**,
  **field-level encryption at rest**, immutable **audit logging**, **PCI DSS card
  tokenization**, and **CCPA** data-subject (access / portability / erasure) flows.
- **Modular subledgers**: an **Accounts Receivable** subledger posts balanced,
  double-entry **GL journals** against the COA — the pattern future subledgers (AP,
  Cash, Fixed Assets) follow.

> Architect: Grok · Build: full-stack implementation. See [`docs/`](docs/) for
> schema notes, the compliance control map, and security/TLS guidance.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 |
| Database | PostgreSQL 16 (Row-Level Security) |
| Auth | JWT (HS256) + bcrypt, TOTP MFA (pyotp) |
| Crypto | Fernet (cryptography) column encryption |
| Reporting | openpyxl (xlsx COA export) |

## Repository layout

```
casa-harmony/
├── backend/
│   ├── app/
│   │   ├── core/          # config, db engine + RLS session, security, crypto, deps, middleware, permissions
│   │   ├── models/        # SQLAlchemy: identity, kff, audit, compliance, subledger
│   │   ├── schemas/       # Pydantic request/response models
│   │   ├── services/      # kff, gl_posting, tokenization, mfa, audit, export, coa_bootstrap
│   │   ├── api/v1/         # auth, tenants, rbac, coa, subledger, payments, privacy
│   │   └── main.py        # FastAPI app
│   ├── alembic/           # migrations (schema + RLS policies + grants)
│   ├── scripts/seed.py    # idempotent seed (superadmin, demo HOA + COA)
│   ├── tests/             # pytest (RLS isolation, KFF, MFA, PCI, CCPA, subledger)
│   └── requirements.txt
├── frontend/              # Next.js 15 app (login, tenant switch, dashboard, COA config UI)
├── infra/                 # Postgres init (restricted role), nginx TLS sample
├── docker-compose.yml     # Postgres + backend + frontend
└── docs/                  # SCHEMA.md, COMPLIANCE.md, SECURITY.md
```

---

## Quick start (Docker — recommended)

```bash
docker compose up --build
```

This brings up PostgreSQL, runs migrations (as the DB owner) + seed (as the
restricted app role), and starts both services:

- **API**  → http://localhost:8000/docs  (interactive OpenAPI)
- **Web UI** → http://localhost:3000

**Demo credentials** (seeded):

| Role | Email | Password |
|---|---|---|
| SUPERADMIN | `superadmin@casaharmony.ai` | `ChangeMe!Superadmin1` |
| SYSADMIN | `sysadmin@casaharmony.ai` | `ChangeMe!Sysadmin1` |

A demo HOA (“Casa Harmony Master Association”) is provisioned with a default
6-segment Chart of Accounts and sample code combinations.

---

## Local development (without Docker)

**Prerequisites:** Python 3.12+, Node 20+, a PostgreSQL 16 you can reach.

### 1. Database roles

Run migrations as a DDL-privileged role (e.g. `postgres`); the app connects as a
**restricted, non-`BYPASSRLS`** role so RLS is always enforced:

```sql
CREATE ROLE casa_app LOGIN PASSWORD 'casa_app_pwd' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE casa_harmony TO casa_app;
GRANT USAGE ON SCHEMA public TO casa_app;
```

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit SECRET_KEY, FIELD_ENCRYPTION_KEY, DB creds

# migrate as the owner, then seed as the app role:
DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/casa_harmony" alembic upgrade head
python -m scripts.seed

uvicorn app.main:app --reload    # http://localhost:8000/docs
```

Generate real secrets for production:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"          # SECRET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # FIELD_ENCRYPTION_KEY
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local       # NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1
npm run dev                      # http://localhost:3000
```

### 4. Tests

```bash
cd backend && source .venv/bin/activate
# point POSTGRES_* at a migrated+seeded database, then:
pytest -q
```

The suite verifies cross-tenant RLS isolation, KFF validation, MFA, PCI
tokenization, CCPA erasure, and balanced GL posting.

---

## API surface (selected)

| Area | Endpoints |
|---|---|
| Auth / MFA | `POST /auth/login`, `GET /auth/me`, `POST /auth/mfa/enroll`, `POST /auth/mfa/verify` |
| Tenants (HOAs) | `GET/POST /tenants`, `GET/PATCH /tenants/{id}` |
| RBAC | `GET /permissions`, `GET/POST /roles`, `GET/POST /users`, `POST /memberships` |
| COA / KFF | `…/coa/structures`, `…/segments`, `…/value-sets`, `…/cross-validation-rules`, `…/combinations`, `…/export` |
| Subledger / GL | `…/subledger/homeowners`, `…/subledger/invoices`, `…/subledger/journals` |
| Payments (PCI) | `POST /payments/methods` (tokenize) |
| Privacy (CCPA) | `POST /privacy/requests`, `GET /privacy/export`, `POST /privacy/requests/{id}/erase` |
| Vendors / Banks | `…/vendors`, `…/banks`, `…/banks/routing-lookup/{rn}`, `…/banks/accounts` |
| Purchasing (PO) | `…/purchasing`, `…/purchasing/{id}/submit`, `…/purchasing/{id}/approve` |
| Payables (AP) | `…/payables`, `…/payables/{id}/submit`, `…/payables/{id}/approve` (2-way PO match) |
| Receivables (AR) | `…/subledger/receipts`, `…/subledger/assessment-run`, `…/subledger/homeowners/{id}/ledger/export` |
| Approvals | `…/approvals/hierarchies`, `…/approvals/requests` |
| Residents (admin) | `…/residents`, `…/residents/{id}/units` (owner/renter logins, multi-unit) |
| Resident portal | `POST /portal/login` (HOA + username + password), `…/portal/me`, `…/portal/units`, `…/portal/units/{id}/{invoices,receipts,ledger/export}`, `POST /portal/pay` |
| General Ledger | `…/gl/batches`, `…/gl/batches/{id}/{submit,approve,post,export}`, `…/gl/posting-runs`, `…/gl/balances`, `…/gl/trial-balance/export` |

Authenticated requests send `Authorization: Bearer <jwt>` and select the active
HOA with the `X-Tenant-Id: <uuid>` header.

See [`docs/SCHEMA.md`](docs/SCHEMA.md), [`docs/FINANCIALS.md`](docs/FINANCIALS.md)
(Oracle EBS P2P/O2C/GL + fund accounting), [`docs/SCHEDULING.md`](docs/SCHEDULING.md)
(nightly posting / Celery / cron), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
(hosting + env vars), [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md),
[`docs/SECURITY.md`](docs/SECURITY.md), and the
[`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) with per-flow
[test scripts](docs/test-scripts/) (configuration → processes → reports → dashboard).
