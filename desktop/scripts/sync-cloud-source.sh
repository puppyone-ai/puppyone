#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$ROOT_DIR/desktop/cloud-source"

rsync -a --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .turbo \
  --exclude dist \
  --exclude coverage \
  "$ROOT_DIR/frontend/" \
  "$ROOT_DIR/desktop/cloud-source/frontend/"

mkdir -p "$ROOT_DIR/desktop/public"

rsync -a --delete \
  "$ROOT_DIR/frontend/public/" \
  "$ROOT_DIR/desktop/public/"

cp "$ROOT_DIR/frontend/app/globals.css" "$ROOT_DIR/desktop/src/cloud-globals.css"
