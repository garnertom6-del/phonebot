#!/usr/bin/env bash
# Idempotent Cloud Agent setup for both apps in this repo:
#   1. Flask phone assistant at the repo root (app.py)
#   2. Next.js "Smart Intake" app in smart-intake/
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "== Python phone assistant (Flask) =="
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

echo "== Node Smart Intake app (Next.js) =="
cd "$repo_root/smart-intake"

# Local dev runs on SQLite with no external services. Real secrets
# (ANTHROPIC_API_KEY, DocuSign, Twilio, SendGrid, NC Tracks) are optional and
# only enable extra features; the app is fully usable without them.
if [ ! -f .env ]; then
  cat > .env <<'ENV'
DATABASE_URL="file:./dev.db"
SESSION_SECRET="dev-local-secret-not-for-production-use-000000000000"
APP_BASE_URL="http://localhost:3000"
CLIENT_LINK_EXPIRY_DAYS="7"
ENV
  echo "Wrote smart-intake/.env for local development."
fi

npm install
npm run db:push
npm run seed

echo "Setup complete."
