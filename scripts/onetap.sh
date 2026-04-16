#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/AnonymousSysna/pm2-manager.git"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
TARGET_DIR="${PM2_MANAGER_DIR:-$HOME/pm2-manager}"
FORWARD_ARGS=()
POSITIONAL_TARGET=""

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="$2"
      FORWARD_ARGS+=("$1" "$2")
      shift 2
      ;;
    --target-dir=*)
      TARGET_DIR="${1#*=}"
      FORWARD_ARGS+=("$1")
      shift
      ;;
    --repo-url)
      REPO_URL="$2"
      FORWARD_ARGS+=("$1" "$2")
      shift 2
      ;;
    --repo-url=*)
      REPO_URL="${1#*=}"
      FORWARD_ARGS+=("$1")
      shift
      ;;
    *)
      if [ -z "$POSITIONAL_TARGET" ] && [[ "$1" != -* ]]; then
        POSITIONAL_TARGET="$1"
        TARGET_DIR="$1"
      fi
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

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

exec node "$APP_DIR/scripts/onetap.js" --app-dir "$APP_DIR" "${FORWARD_ARGS[@]}"
