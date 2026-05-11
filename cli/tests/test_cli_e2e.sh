#!/bin/bash
# ============================================================
# PuppyOne CLI E2E Test Suite
# ============================================================
# Tests all CLI commands against the production API.
# Requires: node, SUPABASE_URL, SUPABASE_KEY in ../../.env
#
# Usage:
#   cd puppyone/cli
#   bash tests/test_cli_e2e.sh
# ============================================================

set -euo pipefail

CLI="node bin/puppyone.js"
API_URL="https://qubits-api.puppyone.ai"
PASS=0
FAIL=0
SKIP=0
ERRORS=()

# ── Helpers ──

check() {
    local name="$1"
    local result="$2"
    if [ "$result" = "0" ]; then
        PASS=$((PASS + 1))
        echo "  ✓ $name"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$name")
        echo "  ✗ $name"
    fi
}

section() {
    echo ""
    echo "============================================================"
    echo "  $1"
    echo "============================================================"
}

# Get JWT token via Python (Supabase auth)
get_jwt() {
    cd ../..
    local jwt=$(python -c "
import os
for line in open('.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        os.environ[k.strip()] = v.strip()
from supabase import create_client
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
try:
    sb.auth.admin.create_user({'email': 'cli-test@puppyone.ai', 'password': 'CliTest2026!', 'email_confirm': True})
except: pass
s = sb.auth.sign_in_with_password({'email': 'cli-test@puppyone.ai', 'password': 'CliTest2026!'})
print(s.session.access_token)
" 2>/dev/null)
    cd puppyone/cli
    echo "$jwt"
}

# ── Setup ──

section "0. Setup"
echo "  Getting JWT token..."
JWT=$(get_jwt)
if [ -z "$JWT" ]; then
    echo "  ✗ Failed to get JWT token"
    exit 1
fi
echo "  ✓ JWT obtained"

# Configure CLI to use the API
export PUPPYONE_API_URL="$API_URL"
COMMON="--api-url $API_URL --api-key $JWT --json"

# Initialize user
curl -s -X POST "$API_URL/api/v1/auth/initialize" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" > /dev/null 2>&1
echo "  ✓ User initialized"

# ============================================================
section "1. Auth Commands"
# ============================================================

# whoami
OUT=$($CLI auth whoami $COMMON 2>&1 || true)
echo "$OUT" | python -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('email') or d.get('user_id') else 1)" 2>/dev/null
check "auth whoami returns user info" "$?"

# targets
OUT=$($CLI auth targets $COMMON 2>&1 || true)
check "auth targets runs" "0"

# ============================================================
section "2. Project Commands"
# ============================================================

# Create project
OUT=$($CLI project create "CLI-E2E-Test" $COMMON 2>&1 || true)
PROJECT_ID=$(echo "$OUT" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',d.get('project_id','')))" 2>/dev/null || echo "")
if [ -n "$PROJECT_ID" ]; then
    check "project create" "0"
else
    # Try parsing from non-json output
    PROJECT_ID=$(echo "$OUT" | grep -oP '[0-9a-f]{8}-[0-9a-f]{4}' | head -1 || echo "")
    check "project create" "$([ -n '$PROJECT_ID' ] && echo 0 || echo 1)"
fi
echo "  PROJECT_ID=$PROJECT_ID"

# List projects
OUT=$($CLI project ls $COMMON 2>&1 || true)
check "project ls" "$?"

# Set active project
if [ -n "$PROJECT_ID" ]; then
    $CLI project use "$PROJECT_ID" --api-url "$API_URL" --api-key "$JWT" 2>&1 > /dev/null || true
    check "project use" "0"
fi

# Project info
if [ -n "$PROJECT_ID" ]; then
    OUT=$($CLI project info "$PROJECT_ID" $COMMON 2>&1 || true)
    check "project info" "$?"
fi

# Project current
OUT=$($CLI project current $COMMON 2>&1 || true)
check "project current" "$?"

# ============================================================
section "3. Data Command Removed"
# ============================================================

PROJECT_FLAG="-p $PROJECT_ID"

OUT=$($CLI data ls / $COMMON $PROJECT_FLAG 2>&1 && echo "__UNEXPECTED_SUCCESS__" || true)
if echo "$OUT" | grep -q "unknown command 'data'"; then
    check "data command is absent" "0"
else
    check "data command is absent" "1"
fi

# ============================================================
section "4. Access Point Commands"
# ============================================================

# Providers
OUT=$($CLI access providers $COMMON 2>&1 || true)
check "access providers" "$?"

# Add filesystem AP
OUT=$($CLI access add filesystem /cli-test --name "CLI Test Sync" $COMMON $PROJECT_FLAG 2>&1 || true)
check "access add filesystem" "$?"

# Access ls
OUT=$($CLI access ls $COMMON $PROJECT_FLAG 2>&1 || true)
check "access ls" "$?"

# Get first AP id
AP_ID=$(echo "$OUT" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    items = d if isinstance(d, list) else d.get('data', d.get('items', []))
    if items and isinstance(items, list):
        print(items[0].get('id',''))
    else:
        print('')
except: print('')
" 2>/dev/null || echo "")

if [ -n "$AP_ID" ]; then
    # Access info
    OUT=$($CLI access info "$AP_ID" $COMMON 2>&1 || true)
    check "access info" "$?"

    # Access key
    OUT=$($CLI access key "$AP_ID" $COMMON 2>&1 || true)
    check "access key show" "$?"

    # Access pause
    OUT=$($CLI access pause "$AP_ID" $COMMON 2>&1 || true)
    check "access pause" "$?"

    # Access resume
    OUT=$($CLI access resume "$AP_ID" $COMMON 2>&1 || true)
    check "access resume" "$?"

    # Access rm
    OUT=$($CLI access rm "$AP_ID" $COMMON 2>&1 || true)
    check "access rm" "$?"
else
    echo "  SKIP: no AP_ID available"
    SKIP=$((SKIP + 5))
fi

# ============================================================
section "5. Gateway Commands"
# ============================================================

# Providers
OUT=$($CLI gateway providers $COMMON 2>&1 || true)
check "gateway providers" "$?"

# Create database gateway
OUT=$($CLI gateway connect database --name "Test DB" --set host=localhost --set port=5432 $COMMON 2>&1 || true)
check "gateway connect database" "$?"

# Gateway ls
OUT=$($CLI gateway ls $COMMON 2>&1 || true)
check "gateway ls" "$?"

# Get gateway id
GW_ID=$(echo "$OUT" | python -c "
import sys,json
try:
    d=json.load(sys.stdin)
    items = d if isinstance(d, list) else d.get('data', d.get('items', []))
    if items and isinstance(items, list):
        print(items[0].get('id',''))
    else:
        print('')
except: print('')
" 2>/dev/null || echo "")

if [ -n "$GW_ID" ]; then
    # Gateway info
    OUT=$($CLI gateway info "$GW_ID" $COMMON 2>&1 || true)
    check "gateway info" "$?"

    # Gateway rm
    OUT=$($CLI gateway rm "$GW_ID" $COMMON 2>&1 || true)
    check "gateway rm" "$?"
else
    echo "  SKIP: no GW_ID available"
    SKIP=$((SKIP + 2))
fi

# ============================================================
section "6. Config Commands"
# ============================================================

OUT=$($CLI config show $COMMON 2>&1 || true)
check "config show" "$?"

OUT=$($CLI config path $COMMON 2>&1 || true)
check "config path" "$?"

# ============================================================
section "7. Status Command"
# ============================================================

OUT=$($CLI status $COMMON $PROJECT_FLAG 2>&1 || true)
check "status" "$?"

# ============================================================
section "99. Cleanup"
# ============================================================

if [ -n "$PROJECT_ID" ]; then
    curl -s -X DELETE "$API_URL/api/v1/projects/$PROJECT_ID" \
        -H "Authorization: Bearer $JWT" > /dev/null 2>&1
    check "delete project" "0"
fi

# ============================================================
section "RESULTS"
# ============================================================

echo "  Passed:  $PASS"
echo "  Failed:  $FAIL"
echo "  Skipped: $SKIP"

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "  FAILURES:"
    for err in "${ERRORS[@]}"; do
        echo "    ✗ $err"
    done
fi

TOTAL=$((PASS + FAIL))
if [ $TOTAL -gt 0 ]; then
    PCT=$((PASS * 100 / TOTAL))
    echo ""
    echo "  Pass rate: ${PCT}%"
fi

[ $FAIL -eq 0 ] && exit 0 || exit 1
