#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/AnonymousSysna/pm2-manager.git"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
TARGET_DIR="${PM2_MANAGER_DIR:-$HOME/pm2-manager}"
FORWARD_ARGS=()
POSITIONAL_TARGET=""
FORCE_CLEAN="${PM2_MANAGER_FORCE_CLEAN:-0}"

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
    --force-clean)
      FORCE_CLEAN="1"
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
    echo "Updating existing pm2-manager checkout: $APP_DIR"
    if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
      echo "Local changes were detected in $APP_DIR."
      git -C "$APP_DIR" status --short
      if [ "$FORCE_CLEAN" = "1" ]; then
        echo "--force-clean enabled. Stashing local changes before update."
        git -C "$APP_DIR" stash push -u -m "pm2-manager onetap auto-stash before update $(date -Iseconds)" >/dev/null || true
      elif [ -r /dev/tty ]; then
        printf "Accept update and stash local changes first? [y/N] " > /dev/tty
        read -r ACCEPT_UPDATE < /dev/tty || ACCEPT_UPDATE=""
        case "$ACCEPT_UPDATE" in
          y|Y|yes|YES)
            git -C "$APP_DIR" stash push -u -m "pm2-manager onetap auto-stash before update $(date -Iseconds)" >/dev/null || true
            ;;
          *)
            echo "Update cancelled. Re-run with --force-clean to stash automatically." >&2
            exit 1
            ;;
        esac
      else
        echo "Update cancelled because local changes need confirmation." >&2
        echo "Run again from a terminal, or use --force-clean to stash automatically." >&2
        exit 1
      fi
    fi
    git -C "$APP_DIR" pull --ff-only
  elif [ -e "$APP_DIR" ] && [ "$(ls -A "$APP_DIR" 2>/dev/null || true)" != "" ]; then
    if [ "$FORCE_CLEAN" = "1" ]; then
      BACKUP_DIR="${APP_DIR}.backup.$(date +%Y%m%d%H%M%S)"
      echo "Target directory is not empty. Moving it to: $BACKUP_DIR"
      mv "$APP_DIR" "$BACKUP_DIR"
      git clone "$REPO_URL" "$APP_DIR"
    else
      echo "Target directory exists and is not empty: $APP_DIR" >&2
      echo "Use --force-clean to move it aside and reinstall cleanly." >&2
      exit 1
    fi
  else
    echo "Cloning pm2-manager into: $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  fi
  cd "$APP_DIR"
fi

# Native dependencies (node-pty) compile through node-gyp, so make, a C/C++
# compiler and python3 must exist before npm runs. Install them automatically
# when we are privileged; otherwise stop with a paste-ready command instead of
# an npm gyp stack trace.
if [ "${PM2_MANAGER_SKIP_BUILD_TOOLS:-0}" != "1" ]; then
  node "$APP_DIR/scripts/build-tools.js" --ensure --dir "$APP_DIR/server"
fi

# When launched as `curl ... | bash`, stdin belongs to the downloaded script,
# not the user's terminal. Reopen /dev/tty so the Node installer can safely ask
# for the public HTTPS domain during interactive installs.
if [ -t 0 ]; then
  exec node "$APP_DIR/scripts/onetap.js" --app-dir "$APP_DIR" "${FORWARD_ARGS[@]}"
elif [ -r /dev/tty ]; then
  exec node "$APP_DIR/scripts/onetap.js" --app-dir "$APP_DIR" "${FORWARD_ARGS[@]}" < /dev/tty
else
  exec node "$APP_DIR/scripts/onetap.js" --app-dir "$APP_DIR" "${FORWARD_ARGS[@]}"
fi
