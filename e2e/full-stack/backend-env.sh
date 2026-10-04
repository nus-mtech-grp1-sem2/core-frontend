#!/usr/bin/env bash
# Writes a local-only .env for the backend so the full-stack e2e tests can start it.
#
#   bash e2e/full-stack/backend-env.sh ../backend-repo
#
# Everything is generated or non-secret: random service secrets, the public Cognito pool ids, the
# local MySQL container, empty queue URLs (payment and ticket issuance then run in-process) and an
# empty AWS config directory, so no AWS credentials ever reach the containers. SMTP uses dummy
# values so nothing touches the real Gmail sender. Automatic waiting-room admission is switched
# off so the tests decide when customers are admitted (through the organiser's "Admit next
# customer"); with it on, a scheduler would admit them about a second after they join.
# An existing .env is never overwritten.
set -euo pipefail

backend_dir="${1:?usage: backend-env.sh <path to backend-repo>}"
example="$backend_dir/.env.example"
target="$backend_dir/.env"

[[ -f "$example" ]] || { echo "Missing $example" >&2; exit 1; }
if [[ -e "$target" ]]; then
  echo "$target already exists; leaving it alone."
  exit 0
fi

empty_aws="${XDG_CACHE_HOME:-$HOME/.cache}/onestage-e2e/empty-aws"
mkdir -p "$empty_aws"

umask 077
sed \
  -e 's/^DB_NAME=.*/DB_NAME=event_inventory/' \
  -e 's/^DB_USER=.*/DB_USER=root/' \
  -e 's/^DB_PASSWORD=.*/DB_PASSWORD=rootpassword/' \
  -e 's/^MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=rootpassword/' \
  -e 's/^DB_SSL=.*/DB_SSL=false/' \
  -e 's/^AUTO_ADMISSION_ENABLED=.*/AUTO_ADMISSION_ENABLED=false/' \
  -e "s/^SCANNER_SESSION_SECRET=.*/SCANNER_SESSION_SECRET=$(openssl rand -hex 24)/" \
  -e "s/^TICKET_INTERNAL_SHARED_SECRET=.*/TICKET_INTERNAL_SHARED_SECRET=$(openssl rand -hex 24)/" \
  -e "s/^INTERNAL_API_TOKEN=.*/INTERNAL_API_TOKEN=$(openssl rand -hex 24)/" \
  -e 's/^COGNITO_USER_POOL_ID=.*/COGNITO_USER_POOL_ID=ap-southeast-1_cgmx4fpO2/' \
  -e 's/^COGNITO_CLIENT_ID=.*/COGNITO_CLIENT_ID=gh94lqsterju3qoffje1grep8/' \
  -e "s#^AWS_SHARED_CONFIG_DIR=.*#AWS_SHARED_CONFIG_DIR=$empty_aws#" \
  -e 's/^SMTP_USER=.*/SMTP_USER=e2e-disabled@example.invalid/' \
  -e 's/^SMTP_APP_PASSWORD=.*/SMTP_APP_PASSWORD=e2e-disabled-not-a-real-password/' \
  "$example" > "$target"

# Older templates have no SMTP lines; compose refuses to start without a password.
grep -q '^SMTP_APP_PASSWORD=' "$target" || printf '%s\n' \
  'SMTP_USER=e2e-disabled@example.invalid' \
  'SMTP_APP_PASSWORD=e2e-disabled-not-a-real-password' >> "$target"

echo "Wrote $target (mode $(stat -c %a "$target" 2>/dev/null || stat -f %Lp "$target"))."
