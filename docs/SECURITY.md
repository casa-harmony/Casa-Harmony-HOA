# Security & TLS (Encryption in Transit)

## Defense in depth

1. **Authentication** — JWT (HS256) bearer tokens, bcrypt password hashing, and
   optional **TOTP MFA** enforced at login.
2. **Authorization** — RBAC permission checks (`require_permission`) plus tenant
   membership validation on every request.
3. **Tenant isolation** — PostgreSQL **Row-Level Security**; the app connects as a
   restricted, non-`BYPASSRLS` role, so a bug in application code cannot leak data
   across tenants.
4. **Encryption at rest** — Fernet (`EncryptedString`) for sensitive columns
   (`ar_homeowners.bank_account`, `users.mfa_secret`). Card PANs are **tokenized**,
   never stored.
5. **Audit** — append-only `audit_logs` (insert-only RLS; updates/deletes denied).

## Encryption in transit (TLS) — deployment

TLS is terminated at the edge (reverse proxy / load balancer), not in the app
process. A reference nginx config is provided at
[`infra/nginx/casa-harmony.conf.example`](../infra/nginx/casa-harmony.conf.example):

- Terminates HTTPS (TLS 1.2/1.3), redirects HTTP → HTTPS.
- Sets HSTS and common security headers.
- Proxies `/api` to the backend and everything else to the Next.js frontend.

In managed environments use the platform's TLS (AWS ALB/ACM, GCP LB, Cloudflare).
**Postgres connections** should also use TLS in production (`sslmode=require` in
the connection string).

## Secrets

- `SECRET_KEY` (JWT signing) and `FIELD_ENCRYPTION_KEY` (Fernet) must be generated
  per environment and stored in a secrets manager (AWS Secrets Manager, GCP Secret
  Manager, HashiCorp Vault) — never committed.
- Rotate `FIELD_ENCRYPTION_KEY` with a re-encryption migration; rotate `SECRET_KEY`
  to invalidate outstanding tokens.

## Hardening checklist for production

- [ ] Real `SECRET_KEY` and `FIELD_ENCRYPTION_KEY` from a secrets manager
- [ ] TLS at the edge + `sslmode=require` to Postgres
- [ ] Restrict `BACKEND_CORS_ORIGINS` to known frontend origins
- [ ] Full-disk / TDE encryption on the database volume
- [ ] Backups encrypted; access logged
- [ ] Rate limiting / WAF at the edge
- [ ] Per-tenant MFA enforcement policy

## Resident MFA (email / SMS one-time codes)

Residents (owners & renters) are not tech-savvy, so the portal uses **emailed or
texted one-time codes** — never authenticator apps (TOTP/Okta).

Controls:
- 6-digit codes from a CSPRNG (`secrets`); **only an HMAC-SHA256 hash** (keyed by
  `SECRET_KEY`, bound to the resident id) is stored — the plaintext code is never persisted.
- Two-step login: password first, then the code. The code is delivered out-of-band
  (email via SendGrid or SMS via Twilio; logged in dev if no provider).
- Challenges are **single-use**, **expire** (`OTP_TTL_MINUTES`, default 10), are
  **attempt-capped** (`OTP_MAX_ATTEMPTS`, default 5), and **resend-throttled**
  (`OTP_RESEND_SECONDS`, default 30). Verification is constant-time.
- `mfa_enabled` defaults **on** for every resident; channel is `EMAIL` or `SMS`.
- Resident tokens are scoped (`scope=resident`) and carry their HOA, so they bind
  RLS to that tenant and cannot be used on staff routes or to switch HOAs.
- In `ENVIRONMENT=development` only, the login response includes `dev_otp` so UAT
  works without a provider; this field is omitted outside development.
