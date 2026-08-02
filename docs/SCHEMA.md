# Schema Notes

All tables use UUID primary keys. Tenant-scoped tables carry `tenant_id` and the
Oracle-style **Who columns** (`created_by`, `created_at`, `updated_by`,
`updated_at`). Single functional currency (USD) — no currency columns.

## Tenancy & identity

| Table | Purpose |
|---|---|
| `tenants` | An HOA (the tenant boundary). Platform registry; `functional_currency` fixed to USD. |
| `users` | Platform-global identity (so a SYSADMIN can span HOAs). `is_superadmin`, `mfa_enabled`, `mfa_secret` (encrypted). |
| `roles` | Permission bundles. `tenant_id IS NULL` ⇒ system role (SUPERADMIN, SYSADMIN, …). |
| `permissions`, `role_permissions` | Capability catalog and role grants. |
| `memberships` | The `(user, tenant, role)` grant — the authorization edge. |
| `audit_logs` | Immutable trail: actor, action, entity, before/after JSON, IP/UA. |

## Key Flexfield — Chart of Accounts (Oracle EBS model)

| Casa Harmony table | Oracle EBS analogue | Purpose |
|---|---|---|
| `kff_structures` | `FND_ID_FLEX_STRUCTURES` | A COA structure (segment layout). |
| `kff_segments` | `FND_ID_FLEX_SEGMENTS` | Ordered segments (`SEGMENT1..15`), each with a qualifier + value set. |
| `kff_value_sets` | `FND_FLEX_VALUE_SETS` | Validation domains (NONE / INDEPENDENT / DEPENDENT / TABLE; CHAR/NUMBER). |
| `kff_value_set_values` | `FND_FLEX_VALUES` | Allowed values; natural-account values carry `account_type` (A/L/O/R/E). |
| `kff_cross_validation_rules` (+`_lines`) | `FND_FLEX_CROSS_VALIDATION_RULES` | INCLUDE/EXCLUDE rules preventing invalid combinations. |
| `gl_code_combinations` | `GL_CODE_COMBINATIONS` | Validated account combinations; discrete `SEGMENT1..15` + concatenated string + denormalized qualifier values + derived `account_type`. |

### Segment qualifiers
`balancing`, `natural_account`, `cost_center`, `fund`, `intercompany`,
`management`, `secondary_tracking`, `none`. The **balancing** segment must net to
zero per value; the **natural_account** segment drives the account type; the
**fund** segment supports fund accounting (Operating / Reserve / Special).

### Default 6-segment HOA COA (auto-provisioned per tenant)
`Association Code [balancing]` · `Fund [fund]` · `Cost Center [cost_center]` ·
`Natural Account [natural_account]` · `Sub-Account` · `Project Code`.
Extensible up to 15 segments.

## Subledgers & General Ledger

| Table | Purpose |
|---|---|
| `gl_journals` / `gl_journal_lines` | Double-entry journals; lines reference `gl_code_combinations`. A journal must balance (Σ debit = Σ credit). |
| `ar_homeowners` | AR subledger accounts; `bank_account` is encrypted at rest. |
| `ar_invoices` | Assessment invoices; posting creates a balanced GL journal (Dr Receivable / Cr Income). |

This is the extensibility seam: new subledgers (AP, Cash, Fixed Assets) post
through the same `services/gl_posting.py` engine.

## Compliance

| Table | Purpose |
|---|---|
| `payment_tokens` | PCI tokenization — stores only vault token + brand + last four; **never the PAN**. |
| `data_subject_requests` | CCPA access / portability / erasure workflow records. |

## Row-Level Security

Every tenant-scoped table has RLS enabled with a policy:

```sql
USING (
  current_setting('app.is_superadmin', true) = 'on'
  OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
)
```

The application sets `app.current_tenant` and `app.is_superadmin` per request
(`app/core/database.py`) and connects as a **non-`BYPASSRLS`** role, so isolation
is enforced by PostgreSQL itself. `roles` additionally exposes system roles
(`tenant_id IS NULL`) to all tenants; `audit_logs` is append-only (insert allowed,
update/delete denied, reads tenant-scoped).

## Transient defaults on get_* singletons (P32)

Per-tenant singletons (`scheduler_config`, `late_fee_rules`, `ap_match_tolerances`,
`encumbrance_settings`, `gateway_configs`, …) expose a `get_*` accessor that returns a
**transient default** object when no row exists yet. SQLAlchemy applies
`mapped_column(default=...)` only on flush, so a transient object's newly-added
columns are `None` until saved — which breaks serialization through a Pydantic
`from_attributes` schema (required field is `None`).

Always build transient defaults with `app.core.model_defaults.make_default(Model, **overrides)`
(or call `hydrate_defaults(obj)`), which fills every `None` column with its Python
column default (scalar or callable, primary keys skipped). When you add a new column
to a singleton, no accessor change is needed — the helper hydrates it automatically.
