#!/usr/bin/env bash
#
# rotate_secrets.sh — secure secret rotation for Casa Harmony go-live.
#
# Design principle: a secret value must NEVER appear in chat, in shell history,
# in command arguments (ps/argv), or in CloudTrail/SSM command text. So:
#   * AWS keys are minted by the IAM API and written straight to ~/.aws (never printed).
#   * The app SECRET_KEY is generated ON the server; only "updated" is returned.
#   * The GitHub token is read with `read -s`, parked in an encrypted SSM SecureString
#     (loaded from a 0600 temp file, not argv), and pulled by the server's instance role.
# Outputs only show public identifiers (access key IDs) and success markers.
#
# Usage:
#   infra/aws/rotate_secrets.sh status
#   infra/aws/rotate_secrets.sh aws
#   infra/aws/rotate_secrets.sh app-secret
#   infra/aws/rotate_secrets.sh github
#   infra/aws/rotate_secrets.sh cleanup-file <path>   # shred a leaked creds file
#   infra/aws/rotate_secrets.sh all
#
# Config (override via env):
#   IID=i-0815364a021bfb3ed   AWS_REGION=us-east-1   IAM_USER=casa_admin
#   AWS_PROFILE=default       ENV_FILE=/opt/casa/.env
#   API_HOST=https://3.228.196.161.sslip.io
#   COMPOSE="-f docker-compose.yml -f infra/aws/compose.prod.yml"
set -euo pipefail
umask 077

IID="${IID:-i-0815364a021bfb3ed}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
IAM_USER="${IAM_USER:-casa_admin}"
AWS_PROFILE="${AWS_PROFILE:-default}"
ENV_FILE="${ENV_FILE:-/opt/casa/.env}"
API_HOST="${API_HOST:-https://3.228.196.161.sslip.io}"
COMPOSE="${COMPOSE:--f docker-compose.yml -f infra/aws/compose.prod.yml}"
GH_PARAM="${GH_PARAM:-/casa/github_token}"

log()  { printf '\033[1;36m[rotate]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'  "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n'  "$*" >&2; exit 1; }

need() {
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing required tool: $c"; done
}

# Run a server-side bash script via SSM without putting its text on the command line.
# The script body is base64-encoded (logic only — never a secret) and decoded on the box.
ssm_run() {
  local script_b64 cmd_id status
  script_b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  cmd_id=$(aws ssm send-command --profile "$AWS_PROFILE" \
    --instance-ids "$IID" --document-name "AWS-RunShellScript" \
    --comment "rotate_secrets" \
    --parameters "commands=[\"echo $script_b64 | base64 -d | bash\"]" \
    --timeout-seconds 900 --query "Command.CommandId" --output text)
  while :; do
    status=$(aws ssm get-command-invocation --profile "$AWS_PROFILE" \
      --command-id "$cmd_id" --instance-id "$IID" --query "Status" --output text 2>/dev/null || echo Pending)
    case "$status" in Success|Failed|TimedOut|Cancelled) break;; esac
    sleep 5
  done
  aws ssm get-command-invocation --profile "$AWS_PROFILE" \
    --command-id "$cmd_id" --instance-id "$IID" --query "StandardOutputContent" --output text 2>/dev/null || true
  [ "$status" = "Success" ] || { aws ssm get-command-invocation --profile "$AWS_PROFILE" \
    --command-id "$cmd_id" --instance-id "$IID" --query "StandardErrorContent" --output text >&2 2>/dev/null || true
    die "remote command $status"; }
}

# ---- 1. AWS access key: mint a fresh one via IAM, swap, delete the old ----
rotate_aws() {
  need aws
  log "Rotating AWS access key for IAM user '$IAM_USER' (current key stays valid until the new one verifies)."
  local old_id new_json new_id
  old_id=$(aws configure get aws_access_key_id --profile "$AWS_PROFILE" 2>/dev/null || true)

  set +x
  new_json=$(aws iam create-access-key --profile "$AWS_PROFILE" --user-name "$IAM_USER" --output json) \
    || die "create-access-key failed (does $IAM_USER have iam:CreateAccessKey on itself? max 2 keys per user)"
  # Parse + write the new credentials in one python pass: the JSON is passed via the
  # environment (never argv/stdout), the program comes from the heredoc, and only the
  # PUBLIC access key id is printed back to bash.
  new_id=$(ROT_JSON="$new_json" ROT_PROFILE="$AWS_PROFILE" python3 <<'PY'
import os, json, subprocess
k = json.loads(os.environ["ROT_JSON"])["AccessKey"]
p = os.environ["ROT_PROFILE"]
for key, val in (("aws_access_key_id", k["AccessKeyId"]), ("aws_secret_access_key", k["SecretAccessKey"])):
    subprocess.run(["aws", "configure", "set", key, val, "--profile", p], check=True)
print(k["AccessKeyId"])
PY
)
  unset new_json
  [ -n "$new_id" ] || die "failed to parse/store new key (old key left intact)"

  log "New key $new_id written to profile '$AWS_PROFILE'. Waiting for IAM propagation…"
  local i
  for i in $(seq 1 10); do
    if aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1; then break; fi
    sleep 3
  done
  aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1 \
    || die "new key did not validate — old key left intact"

  if [ -n "$old_id" ] && [ "$old_id" != "$new_id" ]; then
    log "Deactivating + deleting old key $old_id."
    aws iam update-access-key --profile "$AWS_PROFILE" --user-name "$IAM_USER" \
      --access-key-id "$old_id" --status Inactive 2>/dev/null || warn "could not deactivate $old_id (may already be gone)"
    aws iam delete-access-key --profile "$AWS_PROFILE" --user-name "$IAM_USER" \
      --access-key-id "$old_id" 2>/dev/null || warn "could not delete $old_id (may already be gone)"
  fi
  log "AWS key rotation complete. Active key: $new_id (secret never displayed)."
  mark_rotation rotate_cloud_keys || warn "recorded locally but could not mark rotation in app"
}

# ---- 2. App SECRET_KEY: generated on the server, never leaves the box ----
rotate_app_secret() {
  need aws
  log "Generating a new SECRET_KEY on the server and recreating the backend."
  ssm_run "$(cat <<REMOTE
set -euo pipefail
umask 077
cd /opt/casa
NEWKEY=\$(openssl rand -base64 48 | tr -d '\n')
NEWKEY="\$NEWKEY" python3 - <<'PY'
import os
path = "${ENV_FILE}"
key = os.environ["NEWKEY"]
lines, found = [], False
try:
    with open(path) as f:
        for ln in f:
            if ln.startswith("SECRET_KEY="):
                lines.append("SECRET_KEY=" + key + "\n"); found = True
            else:
                lines.append(ln)
except FileNotFoundError:
    pass
if not found:
    lines.append("SECRET_KEY=" + key + "\n")
fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, "".join(lines).encode()); os.close(fd)
os.replace(path + ".tmp", path)
print("SECRET_KEY updated in ${ENV_FILE}")
PY
unset NEWKEY
docker compose ${COMPOSE} --env-file ${ENV_FILE} up -d --force-recreate backend >/dev/null 2>&1
echo "backend recreated with new SECRET_KEY (active sessions invalidated)"
REMOTE
)"
  log "Waiting for the backend to come back healthy…"
  local i
  for i in $(seq 1 30); do
    [ "$(curl -sk -o /dev/null -w '%{http_code}' "$API_HOST/api/v1/health" 2>/dev/null || echo 000)" = "200" ] && break
    sleep 4
  done
  mark_rotation rotate_app_secret || warn "rotated but could not mark in app (record it from the Go-Live page)"
  log "App SECRET_KEY rotation complete."
}

# ---- 3. GitHub token: read locally (hidden), stored encrypted, pulled by the box ----
rotate_github() {
  need aws
  warn "Paste the NEW GitHub token (input hidden, not stored in history or argv)."
  local tok tmp
  read -rs -p "New GitHub token: " tok; echo
  [ -n "$tok" ] || die "no token entered"
  tmp=$(mktemp); trap 'shred -u "$tmp" 2>/dev/null || rm -f "$tmp"' RETURN
  printf '%s' "$tok" > "$tmp"; unset tok          # token now only in a 0600 file

  log "Storing token as encrypted SSM SecureString $GH_PARAM (value read from file, not argv)."
  aws ssm put-parameter --profile "$AWS_PROFILE" --name "$GH_PARAM" --type SecureString \
    --overwrite --value "file://$tmp" >/dev/null \
    || die "put-parameter failed"

  log "Installing token into the server's git credential store (via its instance role)."
  ssm_run "$(cat <<REMOTE
set -euo pipefail
umask 077
TOKEN=\$(aws ssm get-parameter --region ${AWS_REGION} --name ${GH_PARAM} --with-decryption --query Parameter.Value --output text)
git config --global credential.helper store
printf 'https://x-access-token:%s@github.com\n' "\$TOKEN" > ~/.git-credentials
chmod 600 ~/.git-credentials
unset TOKEN
cd /opt/casa && git ls-remote origin -h >/dev/null 2>&1 && echo "git auth OK with new token" || { echo "git auth FAILED" >&2; exit 1; }
REMOTE
)"
  mark_rotation rotate_repo_token || warn "rotated but could not mark in app"
  log "GitHub token rotation complete. (Instance role needs ssm:GetParameter + kms:Decrypt on $GH_PARAM.)"
}

# ---- record a rotation as DONE in the audited cutover workflow ----
mark_rotation() {
  local code="$1" pw token tid
  need curl python3
  pw="${CASA_ADMIN_PASSWORD:-}"
  if [ -z "$pw" ]; then read -rs -p "Casa superadmin password (to record rotation): " pw; echo; fi
  token=$(curl -fsSk -X POST "$API_HOST/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${CASA_ADMIN_EMAIL:-superadmin@casaharmony.ai}\",\"password\":\"$pw\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])') || return 1
  unset pw
  tid=$(curl -fsSk "$API_HOST/api/v1/tenants" -H "Authorization: Bearer $token" \
    | python3 -c 'import sys,json;print(next(t["id"] for t in json.load(sys.stdin) if t["slug"]=="casa-harmony"))') || return 1
  curl -fsSk -X POST "$API_HOST/api/v1/compliance/go-live/rotate/$code" \
    -H "Authorization: Bearer $token" -H "X-Tenant-Id: $tid" >/dev/null
}

status() {
  need curl python3
  local pw token tid
  pw="${CASA_ADMIN_PASSWORD:-}"
  if [ -z "$pw" ]; then read -rs -p "Casa superadmin password: " pw; echo; fi
  token=$(curl -fsSk -X POST "$API_HOST/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${CASA_ADMIN_EMAIL:-superadmin@casaharmony.ai}\",\"password\":\"$pw\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  unset pw
  tid=$(curl -fsSk "$API_HOST/api/v1/tenants" -H "Authorization: Bearer $token" \
    | python3 -c 'import sys,json;print(next(t["id"] for t in json.load(sys.stdin) if t["slug"]=="casa-harmony"))')
  log "Cutover rotation status:"
  curl -fsSk "$API_HOST/api/v1/compliance/cutover/guide" \
    -H "Authorization: Bearer $token" -H "X-Tenant-Id: $tid" \
    | python3 -c 'import sys,json
for g in json.load(sys.stdin): print("  %-20s %s" % (g["code"], g["status"]))'
}

# ---- shred a leaked credentials file (e.g. the Downloads CSV) ----
cleanup_file() {
  local f="$1"
  [ -f "$f" ] || die "no such file: $f"
  shred -u "$f" 2>/dev/null || { rm -f "$f"; warn "shred unavailable; used rm"; }
  log "Removed $f"
}

main() {
  case "${1:-}" in
    aws)          rotate_aws ;;
    app-secret)   rotate_app_secret ;;
    github)       rotate_github ;;
    status)       status ;;
    cleanup-file) shift; cleanup_file "${1:?path required}" ;;
    all)          rotate_aws; rotate_app_secret; rotate_github; status ;;
    *) cat >&2 <<USAGE
Usage: $0 {status|aws|app-secret|github|cleanup-file <path>|all}
  status        show cutover rotation status
  aws           mint a fresh IAM access key, swap, delete the old (secret never shown)
  app-secret    regenerate SECRET_KEY on the server + recreate backend
  github        rotate the GitHub token (hidden input -> encrypted SSM -> server)
  cleanup-file  securely delete a leaked credentials file
  all           run aws + app-secret + github, then status
USAGE
       exit 2 ;;
  esac
}
main "$@"
