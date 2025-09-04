#!/usr/bin/env bash
set -euo pipefail

# One-click start: Storage (8002), Engine (8001), Flow (4000)
# Prerequisites: Python 3.10+, Node.js 18+, pip, npm

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONUNBUFFERED=1

# Defaults
export DEPLOYMENT_TYPE=${DEPLOYMENT_TYPE:-local}
export USER_SYSTEM_URL=${USER_SYSTEM_URL:-http://localhost:8000}
export STORAGE_SERVER_URL=${STORAGE_SERVER_URL:-http://localhost:8002}

# Colors
c_green='\033[0;32m'; c_yellow='\033[0;33m'; c_red='\033[0;31m'; c_reset='\033[0m'
log() { echo -e "${c_green}[run-all]${c_reset} $*"; }
warn() { echo -e "${c_yellow}[run-all]${c_reset} $*"; }
err() { echo -e "${c_red}[run-all]${c_reset} $*"; }

# Install Python deps if needed
install_python() {
  local dir="$1"
  if [ -f "$dir/requirements.txt" ]; then
    log "Installing Python deps in $dir ..."
    ( cd "$dir" && python3 -m venv .venv && source .venv/bin/activate && pip install -U pip && pip install -r requirements.txt )
  else
    warn "No requirements.txt in $dir; skipping"
  fi
}

# Run a service in a new Terminal tab (macOS) or background
run_service() {
  local name="$1"; shift
  local cwd="$1"; shift
  local cmd=("$@")

  if command -v osascript >/dev/null 2>&1; then
    osascript <<OSA >/dev/null 2>&1 || true
      tell application "Terminal"
        do script "cd ${cwd} && ${cmd[*]}"
      end tell
OSA
    log "launched ${name} in new Terminal tab"
  else
    (cd "${cwd}" && nohup bash -lc "${cmd[*]}" >/tmp/${name}.log 2>&1 & disown)
    log "launched ${name} in background (logs: /tmp/${name}.log)"
  fi
}

# 0) Ensure env files exist (copy from .env.example if missing)
copy_env_if_missing() {
  local dir="$1"
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "Created $dir/.env from .env.example (edit values as needed)"
  fi
}

copy_env_if_missing "${ROOT_DIR}/PuppyEngine"
copy_env_if_missing "${ROOT_DIR}/PuppyStorage"
copy_env_if_missing "${ROOT_DIR}/PuppyFlow"

# 1) Frontend deps
log "Installing frontend deps ..."
( cd "${ROOT_DIR}/PuppyFlow" && npm install )

# 2) Storage
install_python "${ROOT_DIR}/PuppyStorage"
log "Starting PuppyStorage on 8002 ..."
run_service storage "${ROOT_DIR}/PuppyStorage" "bash -lc 'source .venv/bin/activate && python -m server.storage_server'"

# 3) Engine
install_python "${ROOT_DIR}/PuppyEngine"
log "Starting PuppyEngine on 8001 ..."
run_service engine "${ROOT_DIR}/PuppyEngine" "bash -lc 'source .venv/bin/activate && python -m Server.EngineServer'"

# 4) Flow (Next.js)
log "Starting PuppyFlow on 4000 ..."
run_service flow "${ROOT_DIR}/PuppyFlow" "npm run dev"

log "All services launched. Open http://localhost:4000"
