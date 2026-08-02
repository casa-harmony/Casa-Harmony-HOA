# Compliance Control Map (AICPA-ready scaffolding)

This maps implemented technical controls to the target frameworks. Items marked
**Deployment** are infrastructure/process controls completed at deploy time, not
in application code. This is engineering scaffolding to support an audit — it is
not, by itself, a certification.

## SOC 2 Type II

| Criterion | Control | Where |
|---|---|---|
| CC6.1 Logical access | RBAC with least-privilege permissions; JWT auth; bcrypt password hashing | `core/deps.py`, `core/permissions.py`, `core/security.py` |
| CC6.1 Strong auth | TOTP multi-factor authentication | `services/mfa.py`, `api/v1/auth.py` |
| CC6.6 Boundary / isolation | Per-tenant PostgreSQL Row-Level Security; non-`BYPASSRLS` app role | `alembic/.../rls_policies.py`, `core/database.py` |
| CC7.2 Monitoring | Immutable audit log with actor + before/after diffs | `models/audit.py`, `services/audit.py` |
| CC8.1 Change mgmt | Versioned DB migrations (Alembic) | `alembic/` |

## PCI DSS

| Requirement | Control | Where |
|---|---|---|
| Req 3 — Protect stored data | **Tokenization**: PAN exchanged for a vault token; only token + brand + last four stored; PAN never persisted or logged | `services/tokenization.py`, `api/v1/payments.py`, `models/compliance.py` |
| Req 3.5 — Encryption at rest | Fernet column encryption for sensitive PII (bank/ACH, MFA secret) | `core/crypto_types.py`, `core/security.py` |
| Req 4 — Encrypt in transit | TLS termination | **Deployment** — see [SECURITY.md](SECURITY.md) |
| Req 10 — Logging | Audit log of payment-method changes (token + last four only) | `services/audit.py` |

> Replacing the reference vault with a real PCI-compliant gateway (Stripe,
> Braintree, …) keeps the app out of PCI scope: the stored fields and interface
> are unchanged.

## ISO 27001

| Annex A | Control | Where |
|---|---|---|
| A.8 Access control | RBAC + memberships + RLS | `core/deps.py`, migrations |
| A.10 Cryptography | Fernet at rest; TLS in transit (deploy) | `core/crypto_types.py`, [SECURITY.md](SECURITY.md) |
| A.12.4 Logging & monitoring | Immutable audit trail | `models/audit.py` |
| A.18 Compliance | Data-subject request workflow | `api/v1/privacy.py` |

## CCPA

| Right | Control | Where |
|---|---|---|
| Right to Know (access/portability) | `GET /privacy/export` returns a machine-readable export of the subject's data | `api/v1/privacy.py` |
| Right to Delete | `POST /privacy/requests/{id}/erase` anonymizes PII while preserving ledger integrity | `api/v1/privacy.py` |
| Recordkeeping | `data_subject_requests` table logs every request and its disposition | `models/compliance.py` |

## Known gaps / next steps

- TLS, secrets management (KMS/Vault), and full-disk/TDE at-rest encryption are
  **deployment** concerns — see [SECURITY.md](SECURITY.md).
- Formal SOC 2 / ISO evidence collection, data-retention scheduling, and
  penetration testing are process activities beyond this codebase.
- MFA is implemented and enforced at login; org-wide MFA *mandates* are a policy
  toggle to add per tenant.
