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

## Running it in the terminal

Any of these work; all read `AGENTS.md` and run locally:

| Tool | Notes |
|---|---|
| [OpenCode](https://github.com/sst/opencode) | Terminal agent, provider-agnostic, has a subagent concept |
| [Aider](https://aider.chat) | Strong git integration; pairs well with local models |
| [Goose](https://github.com/block/goose) | Extensible, MCP-native |
| [Cline](https://github.com/cline/cline) | Editor-based rather than terminal |

Model hosting, cheapest first:

- **Ollama** or **llama.cpp** — fully local, no per-token cost, no data leaves
  the machine. Practical coding models at time of writing: Qwen3-Coder,
  DeepSeek-V3, GLM-4.6, Devstral. A 30B-class model quantised to 4-bit needs
  roughly 24 GB of RAM to be usable.
- **OpenRouter free tier** — no local hardware needed, but prompts leave your
  machine. Do not point it at `.env` or customer data.

> Before committing to a local setup, check what the machine can actually hold.
> A model too large to run well produces plausible-looking wiring with subtly
> wrong field names, which costs more to review than it saved.

## The loop

1. **Plan** (frontier) — break work into single-screen or single-module tasks
   with a stated mechanical check.
2. **Execute** (local/free) — one task per agent run, one commit each.
3. **Verify** (mechanical) — `tsc --noEmit`, pytest, and
   `scripts/check_tenant_isolation.py` when data access changed.
4. **Review** (frontier) — every diff, against the hard rules.
5. **Merge** into `develop`.

Steps 3 and 4 are not optional. Delegation is only cheaper than doing the work
directly if the verification is real.
