# Agent workflow — splitting work across models

The goal: do the high-volume, well-specified work with **free or open-weight
models running in a terminal agent**, and spend expensive frontier-model budget
only where a mistake is costly. This document says which is which, and why.

Read [`../AGENTS.md`](../AGENTS.md) first — every agent, on every tier, follows it.

---

## The dividing line

This is a financial system with per-association data isolation. The cost of an
error is not "the build breaks" — it is "one HOA sees another HOA's ledger" or
"the general ledger no longer balances", and neither necessarily fails loudly.

So the split is **not** by difficulty. It is by *blast radius*:

| | Delegate to a cheap/local model | Keep on a frontier model |
|---|---|---|
| **Nature** | Mechanical, verifiable, reversible | Judgement, security, correctness-critical |
| **Check** | A type-checker or test proves it | Needs reasoning about an adversary |
| **Examples** | Wiring a page to an endpoint, docstrings, table components, fixtures | RLS policies, auth, GL posting, migrations |

A task qualifies for delegation when you can state, in advance, a mechanical
check that proves it worked. "tsc passes and the page renders the same fields
the endpoint returns" qualifies. "the permission check is correct" does not.

---

## Delegate freely

**Endpoint wiring.** Each of the 45 screens needs its `apiFetch` paths matched
to the real API. The contract is fully specified — the running backend publishes
OpenAPI at `/openapi.json`, and `tsc --noEmit` catches shape mismatches. Highly
mechanical, one screen at a time.

**Response-shape adapters.** Where the mock's shape differs from the server's,
write the mapping. Verifiable by types.

**Tests for existing behaviour.** Characterisation tests over services that
already work.

**Docstrings, comments, dead-code removal, dependency bumps.**

**Draft migrations for non-tenant tables** — lookup/reference tables with no
`tenant_id`. Still reviewed before applying.

## Never delegate

**Anything under `app/core/`** — `database.py` (the RLS session), `deps.py`,
`security.py`, `permissions.py`, `middleware.py`. This is the isolation
boundary.

**RLS policies in migrations.** A missing or subtly wrong `USING` clause is a
silent cross-tenant leak that no type-checker or passing test will catch.

**Auth**: login, JWT handling, MFA, password reset, the resident portal.

**GL posting and anything that moves money** — `services/gl_posting.py`,
payables approval, receipts, the assessment run. Double-entry must balance and
periods must be respected.

**Permission definitions** — what each role may do.

**Any migration that runs against a database holding real data.**

---

## Subagent roles

Define these as named agents in whichever terminal tool you use. Each gets the
same `AGENTS.md`, plus its own brief and its own definition of done. Keep them
narrow — a subagent with a vague brief burns more tokens than it saves.

### `wire-screen` — connect one screen to the real API
- **Input:** one route under `frontend-mock/app/(app)/`.
- **Brief:** replace mock paths with real ones from `/openapi.json`; adapt
  response shapes; leave the UI untouched.
- **Done when:** `tsc --noEmit` is clean and every field rendered maps to a
  field the endpoint actually returns.
- **Must not:** edit `lib/api.ts`, `providers.tsx`, or anything in `backend/`.

### `test-writer` — cover an existing service
- **Input:** one module under `backend/app/services/`.
- **Brief:** pytest tests describing current behaviour. Do not change the
  module to make a test pass — report the mismatch instead.
- **Done when:** tests pass against local Postgres.

### `schema-scribe` — keep docs true
- **Brief:** reconcile `docs/SCHEMA.md` with the models; list drift.
- **Done when:** every table in `app/models/` appears, with its RLS status.

### `isolation-auditor` — read-only, reports only
- **Brief:** for each tenant-scoped table, confirm RLS is enabled and a policy
  exists; for each route, confirm tenant scoping. **Report findings; change
  nothing.**
- Worth running on a cheap model precisely because it only produces a list a
  human then verifies.

### `reviewer` — frontier model, final gate
- Reviews every delegated diff before merge, against the "Rules that must not
  be broken" in `AGENTS.md`. This role is what makes the rest safe to delegate.

---

## Running it: Freebuff

[Freebuff](https://freebuff.com/cli) (CodebuffAI) is the free terminal agent
this project delegates to. Node 18+:

```bash
npm install -g freebuff
cd <repo>
freebuff
```

No API key. It runs open-weight models (DeepSeek V4, MiMo 2.5, MiniMax M3) and
is ad-funded, with ads between agent turns.

### The budget is sessions, not tokens

Roughly **5–6 sessions per day, one hour each**. That single fact should shape
how work is handed to it:

- **One task per session, sized to finish inside an hour.** A session that ends
  mid-task is a session wasted — there is no partial credit.
- **Write the brief before starting the session.** Exploration burns the clock
  at the same rate as editing. Name the files, the endpoint, and the check.
- **Front-load context.** `AGENTS.md` plus the exact paths beat "figure out how
  this works."
- **Batch by theme.** Four screens in the same module share context; four
  unrelated screens re-derive it four times.

Freebuff descends from Codebuff, which reads a repo-root `knowledge.md` — this
repo has one, pointing at `AGENTS.md`, so the hard rules load either way.

### Never paste credentials into it

Prompts and file contents go to a third-party service running third-party
models, and the product is ad-funded. This repo is a financial system holding
resident PII under CCPA obligations. So:

- **Never** let it read `backend/.env`, `frontend-mock/.env.local`, Neon
  connection strings, the Cloudinary secret, `SECRET_KEY`, or
  `FIELD_ENCRYPTION_KEY`.
- **Never** paste a production database dump, resident records, or real
  homeowner data into a prompt.
- Keep it to source code, schemas, and synthetic fixtures. All of that is
  already safe to share — the secrets are what is not.

If a task genuinely needs a live database, it is not a task to delegate.

## The loop

1. **Plan** (frontier) — break work into single-session tasks with a stated
   mechanical check.
2. **Execute** (Freebuff) — one task per session, one commit each.
3. **Verify** (mechanical) — `tsc --noEmit`,
   `node scripts/check-endpoints.mjs`, pytest, and
   `scripts/check_tenant_isolation.py` when data access changed.
4. **Review** (frontier) — every diff, against the hard rules in `AGENTS.md`.
5. **Merge** into `develop`.

Steps 3 and 4 are not optional. Delegation is only cheaper than doing the work
directly if the verification is real — and with a session budget, a diff that
has to be redone costs a whole hour, not a few cents.
