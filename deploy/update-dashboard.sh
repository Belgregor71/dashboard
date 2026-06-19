#!/bin/bash
# Auto-deploy: pulls origin/main if it has moved, rebuilds, and restarts
# the dashboard service. Run periodically by dashboard-deploy.timer.
set -euo pipefail

REPO_DIR="/home/dashboard/dashboard"
LOG_FILE="/home/dashboard/dashboard-deploy.log"
SERVICE="dashboard.service"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

cd "$REPO_DIR"

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
