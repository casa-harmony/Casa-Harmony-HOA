# Go‑Live Checklist (Production Hardening)

Work through this **before** exposing Casa Harmony to real HOAs/residents. The test
environment intentionally trades some hardening for convenience — those shortcuts
are flagged below and **must be undone** for production.

## 🔴 Credentials & secrets (do first — some were exposed during test setup)

- [ ] **Rotate the `casa_admin` AWS access key** — it was shared in chat during the
      test deploy (key id `AKIAQ62M5XCSNIU6WVWE`). IAM → Users → casa_admin →
      Security credentials → **deactivate + delete** that key, create a fresh one,
      update `aws configure` locally. *(Exposed 2026‑06‑21.)*
- [ ] **Stop using an admin key for deploys.** Create a least‑privilege IAM user/role
      (or GitHub OIDC role) scoped to just the resources Terraform manages.
- [ ] **Replace the GitHub token baked into the EC2 box.** The instance clones the
      private repo with a token embedded in the git remote / user‑data. Switch to a
      **read‑only deploy key** or fine‑grained PAT, or build images in CI and pull
      from **ECR** (no source on the box). Rotate the token used during test.
- [ ] **Generate fresh `SECRET_KEY` and `FIELD_ENCRYPTION_KEY`** from a secrets store
      (AWS Secrets Manager / SSM Parameter Store), not plain env on the box.
      ⚠️ Persist `FIELD_ENCRYPTION_KEY` safely — losing it makes encrypted columns
      (Tax IDs, bank/MFA secrets) unrecoverable; plan a rotation procedure.
- [ ] **Move all secrets off the instance `.env`** into SSM Parameter Store /
      Secrets Manager and inject at runtime.
- [ ] Rotate **any** secret that ever appeared in a chat, log, or screenshot.

## 🔴 Accounts & demo data

- [ ] **Change the SUPERADMIN password** from the `ChangeMe!…` default.
- [ ] **Remove demo accounts & HOAs** — do NOT run `scripts.seed_demo` or
      `scripts.seed_maple_transactions` in production; purge the demo data
      (`maple-grove`, `oak-ridge`, `pine-valley`, `casademo.ai` logins, `CasaDemo123!`).
- [ ] Confirm admin‑created users/residents are forced to change password on first login.

## 🔴 Config flags

- [ ] **`ENVIRONMENT=production`** — this stops the API from returning resident OTP
      codes (`dev_otp`) in responses. (Test env uses `development`.)
- [ ] Configure a **real OTP delivery provider**: `SENDGRID_API_KEY` (email) and/or
      `TWILIO_*` (SMS). Verify residents actually receive codes.
- [ ] **Restrict `BACKEND_CORS_ORIGINS`** to the real frontend domain only.

## 🟠 Network & access

- [ ] Lock the security group: no `0.0.0.0/0` on SSH; use **SSM Session Manager** only
      (already the default — keep `ssh_public_key` unset).
- [ ] Put a real **domain + TLS** in front (Caddy already issues Let's Encrypt; point
      DNS at the Elastic IP instead of `sslip.io`).
- [ ] Consider an ALB/WAF + rate limiting if internet‑facing at scale.

## 🟠 Data durability

- [ ] Move to **managed Postgres (RDS)** with automated backups + PITR, *or* schedule
      `pg_dump` off the box to S3 (lifecycle‑managed). The single‑box container DB has
      no backups by default.
- [ ] Test a restore.

## 🟠 Operations & compliance

- [ ] MFA on the AWS **root** account and all IAM users; billing/cost **budget alarm**.
- [ ] Enable CloudTrail + basic CloudWatch alarms (CPU, disk, health check).
- [ ] Confirm the nightly GL posting runs (cron or `ENABLE_SCHEDULER=true`) and review
      the audit log.
- [ ] Re‑run the security review and the `docs/test-scripts/` suite against staging.

---

See also: `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/COMPLIANCE.md`.

## Production cutover workflow (P33)

The cutover is driven in-product from the **Go-Live** admin page (`compliance.manage`):

1. **Key rotation** (the standing blocker): work the guided steps under "Production
   Cutover" — rotate the cloud (AWS) access key, the GitHub token, and the app
   `SECRET_KEY`, updating `/opt/casa/.env` and redeploying, then click **Mark rotated**
   for each. (API: `GET /compliance/cutover/guide`, `POST /compliance/go-live/rotate/{code}`.)
2. **Execute cutover** — runs final validation (COA, Retained Earnings per Fund, open
   period, GL integrity, security rotations, gateway config) and takes a fresh backup.
   (API: `POST /compliance/cutover/execute`.)
3. **Activate Go-Live** — once validation passes, toggle Go-Live (Execution panel).
   "Production Ready" = validation passed **and** Go-Live active.
4. **Cutover report** — export `cutover_report.xlsx` (validation + rotation status +
   backups) for the Board/audit file. (API: `GET /compliance/cutover/report/export`.)

Production env to set before real data: rotated AWS/GitHub/app secrets, Stripe
`secret_key`+`webhook_secret`, `SENDGRID_API_KEY`/`MAIL_FROM`, `ENABLE_SCHEDULER`
(or `SCHEDULER_MODE=celery` + Redis), `BACKUP_ENABLED=true`.

## Secret rotation script (`infra/aws/rotate_secrets.sh`)

Automates the cutover rotations without ever exposing a secret in chat, shell history,
argv, or CloudTrail/SSM command text:

- `aws` — mints a fresh IAM access key, writes it straight to `~/.aws` (never printed),
  verifies it, then deactivates + deletes the old one. Self-contained; the new secret
  is generated by AWS and never transits anywhere visible.
- `app-secret` — generates a new `SECRET_KEY` **on the server**, rewrites `/opt/casa/.env`
  atomically (0600), recreates the backend, waits for health, records the rotation.
- `github` — reads the new token with hidden input, parks it in an encrypted SSM
  SecureString (loaded from a 0600 temp file, not argv), and the server's instance role
  pulls it into its git credential store. Needs `ssm:GetParameter` + `kms:Decrypt` on
  the param for the instance role.
- `status` — shows the cutover rotation state. `cleanup-file <path>` shreds a leaked
  credentials file. `all` runs aws + app-secret + github.

Run: `CASA_ADMIN_PASSWORD=… infra/aws/rotate_secrets.sh status`
