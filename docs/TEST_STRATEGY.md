# Casa Harmony AI — Test Strategy

Version 1.0 · Owner: QA / Engineering · Applies to MVP (Grok Prompts 1–3)

> For current deploy specifics see [`docs/RAILWAY.md`](RAILWAY.md) +
> [`docs/DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md). The live frontend is
> **`frontend-mock/`** — `frontend/` is the dead client-delivered original.

## 1. Purpose & scope

This document defines how Casa Harmony AI — a multi-tenant HOA Service Desk + ERP
modeled on Oracle EBS — is tested, end to end: **configuration → master data →
transactional processes → period-end posting → reports & dashboards**, plus the
cross-cutting **security, multi-tenant isolation, and compliance** controls.

**In scope (MVP):**
- Platform & tenant configuration (HOAs, users, roles/RBAC).
- Key Flexfield Chart of Accounts (structures, segments, value sets, cross-validation, code combinations).
- Approval hierarchies.
- Master data: vendors, banks/bank accounts, homeowners.
- Procure-to-Pay: Purchase Orders → AP invoices (PO matching) → approval.
- Order-to-Cash: AR assessments (bulk billing), receipts.
- Subledger Accounting → GL journal batches → posting to GL balances.
- Service Desk tickets and the ticket→PO expense hook.
- Reports (trial balance, fund-based financial statements, batch summary, homeowner ledger, COA export).
- Dashboard (COA stats, finance KPIs, compliance posture).
- Security: auth, MFA, RBAC, RLS tenant isolation, encryption at rest, PCI tokenization, CCPA.

**Out of scope (MVP):** live payment-gateway settlement, bank reconciliation,
multi-currency (system is USD-only by design), formal SOC 2/ISO certification audits
(controls are implemented; certification is an external process), load testing beyond
the smoke-level performance checks defined here.

## 2. Quality objectives

| # | Objective | How verified |
|---|---|---|
| Q1 | **Tenant isolation is absolute** — no tenant can read/write another's data | RLS negative tests (API + DB), automated `test_api.py` |
| Q2 | **Books always balance** — every posted journal nets debits = credits, per fund | GL posting tests + control-total checks |
| Q3 | **Fund accounting is enforced** — no distribution without a Fund segment | `test_approvals.py::test_fund_is_mandatory_on_distributions` |
| Q4 | **Approvals gate financial effect** — accounting only happens after final approval | P2P scripts + workflow tests |
| Q5 | **Sensitive data is protected** — PII/financial encrypted at rest; cards tokenized; access controlled | security scripts, `test_gaps.py`, raw-ciphertext check |
| Q6 | **Auditability** — who-columns + before/after history on changes | audit assertions in API tests |
| Q7 | **Reports reconcile** to the underlying ledger | report scripts cross-check totals |

## 3. Test levels

1. **Unit / service** — domain logic in isolation (KFF validation, approval state machine, SLA per-fund offsets, balance roll-forward). Location: `backend/tests/` service-level tests.
2. **API / integration** — FastAPI endpoints against a real PostgreSQL with RLS active (`fastapi.testclient` + Docker Postgres).
3. **End-to-end (manual UAT)** — the per-flow scripts in `docs/test-scripts/`, executed through the UI by a tester.
4. **Security & isolation** — RLS, RBAC, auth/MFA, encryption, compliance (mix of automated + manual).
5. **Smoke performance** — bulk assessment run for ~1000 homeowners; index-backed list queries respond promptly.

## 4. Test types

- **Functional** (happy path + negative/validation).
- **Security/compliance** (authZ, isolation, encryption, PCI, CCPA).
- **Regression** — the automated suite (`pytest`) runs on every change; target **green before every push**.
- **Exploratory / UAT** — guided by the scripts, with freedom to probe edges.

## 5. Environments

| Env | Backend | DB | Frontend | Purpose |
|---|---|---|---|---|
| Local | uvicorn / `docker compose up` | Docker Postgres (local, per AGENTS.md) | `next dev` / build | Dev + automated tests |
| Staging | Railway service (see `docs/RAILWAY.md`) | Neon (RLS-enforced) | Railway service | UAT, joint testing |

DB connects as the restricted `casa_app` role so **RLS is always enforced**; migrations
run as the owner via `MIGRATION_DB_URL` (see `docs/DEPLOY_RUNBOOK.md`).

## 6. Test data (seed baseline)

`python -m scripts.seed` is idempotent and provisions:
- **SUPERADMIN** `superadmin@casaharmony.ai` / `ChangeMe!Superadmin1`
- **SYSADMIN** `sysadmin@casaharmony.ai` / `ChangeMe!Sysadmin1`
- Demo HOA **"Casa Harmony Master Association"** (slug `casa-harmony`) with a 6-segment COA,
  standard code combinations (cash 1000/1010, receivable 1100, AP 2000, income 4000, expenses 5000/5100),
  fund value set (OPER/RESV/SPEC), demo vendor **V-0001**, a bank + operating account,
  an **AP_INVOICE approval hierarchy** (1 level → SYSADMIN), and 3 demo homeowners (H-0001..H-0003).

A second HOA should be created during testing to exercise cross-tenant isolation.

## 7. Roles & responsibilities

| Role | Responsibility |
|---|---|
| Engineer | Keep `pytest` green; add coverage with each change. |
| QA / Tester | Execute UAT scripts, log defects, sign off exit criteria. |
| Product/Architect (Grok) | Confirm scenarios map to Prompts 1–3; UAT acceptance. |

## 8. Entry / exit criteria

**Entry:** build deployed to the target env; migrations + seed applied; automated suite green.
**Exit (per cycle):** all P1 (critical) and P2 (high) scripts **Pass**; no open P1/P2 defects;
isolation (Q1) and balancing (Q2) checks pass 100%; reports reconcile to the ledger.

## 9. Defect management

Severity: **P1 Critical** (data leak across tenants, books don't balance, auth bypass) →
**P2 High** (a flow blocked, wrong totals) → **P3 Medium** (validation/UX) → **P4 Low** (cosmetic).
Log: ID, title, severity, steps, expected vs actual, environment, screenshot/log. P1/P2 block release.

## 10. Test scripts (per flow)

Detailed step-by-step scripts live in `docs/test-scripts/`:

| # | Area | File |
|---|---|---|
| 1 | Configuration (tenants, RBAC, COA/KFF, approval hierarchies, masters) | [`01-configuration.md`](test-scripts/01-configuration.md) |
| 2 | Security, isolation & compliance (auth, MFA, RLS, encryption, PCI, CCPA) | [`02-security-compliance.md`](test-scripts/02-security-compliance.md) |
| 3 | Procure-to-Pay (PO → AP → approval → draft GL) | [`03-procure-to-pay.md`](test-scripts/03-procure-to-pay.md) |
| 4 | Order-to-Cash (assessments, receipts) | [`04-order-to-cash.md`](test-scripts/04-order-to-cash.md) |
| 5 | GL batch review & posting (control totals, nightly run, balances) | [`05-gl-posting.md`](test-scripts/05-gl-posting.md) |
| 6 | Service Desk (tickets → PO expense hook) | [`06-service-desk.md`](test-scripts/06-service-desk.md) |
| 7 | Reports (trial balance, financial statements, batch, ledger, COA) | [`07-reports.md`](test-scripts/07-reports.md) |
| 8 | Dashboard (COA stats, finance KPIs, compliance posture) | [`08-dashboard.md`](test-scripts/08-dashboard.md) |
| 9 | Resident portal (owner/renter logins, multi-unit, pay, isolation) | [`09-resident-portal.md`](test-scripts/09-resident-portal.md) |

Each script row: **ID · Priority · Role · Preconditions · Steps · Expected result · Automated coverage**.

## 11. Traceability (Grok prompts → scripts)

| Requirement | Scripts |
|---|---|
| Multi-tenant + RLS isolation | 01, 02 |
| SUPERADMIN / SYSADMIN, RBAC | 01, 02 |
| KFF COA (segments, qualifiers, value sets, cross-validation, combinations) | 01, 07 |
| Single currency (USD) | 01 (config), 05 (posting) |
| PO / AP / PO matching / distributions (fund mandatory) | 03 |
| AR assessments / receipts | 04 |
| GL batches / balances / nightly posting | 05 |
| Multi-level approvals | 01, 03 |
| Encryption, audit, PCI, CCPA | 02 |
| xlsx/docx reports + dashboards | 07, 08 |
| Service Desk integration hook | 06 |

## 12. Automated regression — how to run

```bash
# Postgres (test): docker compose up postgres (see AGENTS.md), local, not Neon.
cd backend
DATABASE_URL="postgresql+psycopg://casa_app:casa_app_pwd@localhost:5432/casa_harmony" \
MIGRATION_DB_URL="postgresql+psycopg://postgres:postgres@localhost:5432/casa_harmony" \
./.venv/bin/python -m pytest tests/ -v
# tests/conftest.py disables the OTP resend cooldown and the login rate
# limiter for the test process — both would otherwise trip across a run this
# size; production behavior is unaffected.
# Frontend type/build check (frontend-mock/, not frontend/ — see banner above)
cd ../frontend-mock && ./node_modules/.bin/tsc --noEmit && npm run build
```

Current baseline: **backend 150/150 passing**. Treat exact counts as a
point-in-time snapshot — confirm against a live run, not this document.
