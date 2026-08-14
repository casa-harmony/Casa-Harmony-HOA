# Casa Harmony

Working notes for coding agents live in **[AGENTS.md](AGENTS.md)** — read that
first. Delegation rules and session budgeting are in
[docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

Three rules worth repeating here, because getting them wrong is silent:

1. The app connects to Postgres as `casa_app` (`NOBYPASSRLS`), never as the
   database owner. The owner bypasses Row-Level Security, which would let one
   homeowner association read another's ledger with no error raised.
2. New tenant-scoped tables need `ENABLE ROW LEVEL SECURITY` and a policy in
   the same migration.
3. Permissions are enforced server-side. `lib/rbac.ts` drives navigation only
   and is not an authorisation boundary.

Never read or paste `.env` files, connection strings, or resident data into an
agent prompt.
