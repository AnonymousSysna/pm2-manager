#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/AnonymousSysna/pm2-manager.git"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
TARGET_DIR="${1:-${PM2_MANAGER_DIR:-$HOME/pm2-manager}}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd npm

if [ -f "package.json" ] && grep -q '"name": "pm2-dashboard"' package.json 2>/dev/null; then
  APP_DIR="$(pwd)"
else
  APP_DIR="$TARGET_DIR"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
  elif [ -e "$APP_DIR" ] && [ "$(ls -A "$APP_DIR" 2>/dev/null || true)" != "" ]; then
    echo "Target directory exists and is not empty: $APP_DIR" >&2
    exit 1
  else
    git clone "$REPO_URL" "$APP_DIR"
  fi
  cd "$APP_DIR"
fi

echo "Installing dependencies..."
npm install
npm --prefix server install
npm --prefix client install

echo "Building client..."
npm run build

if [ ! -f ".env" ]; then
  echo "Generating .env with random credentials..."
  cp .env.example .env

  PM2_USER="admin_$(node -e 'process.stdout.write(require("crypto").randomBytes(3).toString("hex"))')"
  PM2_PASS="$(node -e 'process.stdout.write(require("crypto").randomBytes(12).toString("base64url"))')"
  JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  METRICS_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

  {
    echo ""
    echo "# one-tap generated credentials"
    echo "PM2_USER=$PM2_USER"
    echo "PM2_PASS=$PM2_PASS"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "METRICS_TOKEN=$METRICS_TOKEN"
    echo "CORS_ALLOWED_ORIGINS=http://localhost:8000"
  } >> .env

  echo "Created .env"
  echo "Login user: $PM2_USER"
  echo "Login pass: $PM2_PASS"
fi

if npm --prefix server exec pm2 -- describe pm2-dashboard >/dev/null 2>&1; then
  echo "Restarting existing pm2-dashboard..."
  npm run pm2:restart
else
  echo "Starting pm2-dashboard..."
  npm run pm2:start
fi

echo "Done. Open http://localhost:8000"
npm run pm2:logs
