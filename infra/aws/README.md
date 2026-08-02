# AWS deploy (cheapest: one EC2 box + Docker Compose + Caddy)

Stands up the whole stack on a single **Free‑Tier `t3.micro`**: Postgres + backend +
frontend (the repo's `docker compose`) behind **Caddy** for automatic HTTPS. Uses the
default VPC and an Elastic IP — no NAT/ALB/RDS charges.

**Cost:** ~$0 for the first 12 months on a new account (Free Tier), ~$8–10/mo after.

## Prerequisites (on your machine)
1. **Terraform** ≥ 1.5 — https://developer.hashicorp.com/terraform/install
2. **AWS CLI** configured with your `casa_admin` keys:
   ```bash
   aws configure          # paste Access Key ID + Secret, region e.g. us-east-1
   ```
3. If the repo is **private**, a GitHub read token (Fine‑grained PAT → Contents: Read).

## Deploy (≈5 min)
```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars   # then edit it
terraform init
terraform apply                                # review plan, type "yes"
```
Terraform prints `app_url` (e.g. `https://<eip>.sslip.io`). First boot installs Docker,
clones the repo, builds images, and starts everything — give it **3–5 min** after apply,
then open the URL. (Watch progress: `aws ssm start-session --target <id>` →
`sudo tail -f /var/log/casa-bootstrap.log`.)

## After it's up
- Sign in at `https://<host>/` (staff) and `https://<host>/portal/login` (residents).
- Load demo data — connect (SSM or SSH) and run:
  ```bash
  cd /opt/casa
  docker compose -f docker-compose.yml -f infra/aws/compose.prod.yml --env-file .env \
    exec backend python -m scripts.seed_demo
  docker compose -f docker-compose.yml -f infra/aws/compose.prod.yml --env-file .env \
    exec backend python -m scripts.seed_maple_transactions
  ```
- **Change the SUPERADMIN password** after first login.

## Notes
- **HTTPS on sslip.io:** the default host `<eip>.sslip.io` resolves to your IP, so Caddy
  gets a real Let's Encrypt cert with no DNS setup. For a custom domain, point an A record
  at the Elastic IP and set `domain` in `terraform.tfvars`.
- **Connect without SSH:** an SSM role is attached, so
  `aws ssm start-session --target <instance-id>` works even with no SSH key.
- **Secrets:** `SECRET_KEY` and `FIELD_ENCRYPTION_KEY` are generated on first boot and
  written to `/opt/casa/.env`. Don't lose `FIELD_ENCRYPTION_KEY` (it decrypts stored PII).
- **`development` mode** is on by default so testers can see resident OTP codes; set
  `environment = "production"` (and configure SendGrid/Twilio) for real use.

## Tear down (stop all charges)
```bash
terraform destroy
```
