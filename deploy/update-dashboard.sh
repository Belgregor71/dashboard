#!/bin/bash
# Auto-deploy: pulls origin/main if it has moved, rebuilds, and restarts
# the dashboard service. Run periodically by dashboard-deploy.timer.
set -euo pipefail

REPO_DIR="/home/dashboard/dashboard"
VAULT_DIR="$REPO_DIR/data/vault"
LOG_FILE="/home/dashboard/dashboard-deploy.log"
SERVICE="dashboard.service"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

cd "$REPO_DIR"

# House knowledge base (docs/design/VAULT.md), if it has been cloned.
#
# BEFORE the unchanged-code early exit below, deliberately: the vault moves on
# its own schedule, so notes must reach the glass whether or not the dashboard
# code has changed. Put this after the exit and notes would only ever sync on a
# code push.
#
# NON-FATAL, also deliberately: `set -e` is on, so an unreachable or diverged
# vault would otherwise abort the whole script and silently stop code deploys.
# A broken notes repo must never be able to do that.
#
# No service restart: the server re-indexes the vault every 10 minutes on its
# own, so a pulled note appears without touching the running dashboard.
if [ -d "$VAULT_DIR/.git" ]; then
  if git -C "$VAULT_DIR" pull --ff-only --quiet >> "$LOG_FILE" 2>&1; then
    log "Vault up to date at $(git -C "$VAULT_DIR" rev-parse --short HEAD)"
  else
    log "WARN: vault pull failed — continuing with the code deploy"
  fi
fi

git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Deploying $LOCAL -> $REMOTE"

CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")

# Discard any local drift (regenerated lockfile, runtime caches) so the
# fast-forward pull never gets blocked by uncommitted changes.
git checkout -- .
git pull --ff-only origin main >> "$LOG_FILE" 2>&1

if echo "$CHANGED_FILES" | grep -qE '^package(-lock)?\.json$'; then
  log "package.json changed, running npm install"
  npm install >> "$LOG_FILE" 2>&1
fi

npm run build >> "$LOG_FILE" 2>&1

sudo systemctl restart "$SERVICE"

log "Deploy complete, now at $(git rev-parse HEAD)"
