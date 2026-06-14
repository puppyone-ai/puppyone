#!/usr/bin/env bash
# Build + register the PuppyOne scope-sandbox E2B template (roadmap #6).
#
# Stages the sync sidecar into this build context (Dockerfile COPYs it), then
# runs `e2b template build`. Requires the E2B CLI (`npm i -g @e2b/cli`) and
# `e2b auth login` (or E2B_ACCESS_TOKEN set). After it prints a template id,
# put it in the backend env: SCOPE_SANDBOX_E2B_TEMPLATE=<id>.
set -euo pipefail
cd "$(dirname "$0")"

cp ../scope-sync-sidecar/sync_sidecar.py ./sync_sidecar.py
trap 'rm -f ./sync_sidecar.py' EXIT

echo "Building E2B template 'puppyone-scope-sandbox'…"
e2b template build --name puppyone-scope-sandbox --dockerfile e2b.Dockerfile

echo
echo "Done. Copy the printed template id into SCOPE_SANDBOX_E2B_TEMPLATE and redeploy."
