#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# PuppyOne CLI Integration Tests
#
# Prerequisites:
#   1. Backend running at localhost:9090
#   2. CLI logged in:  node bin/puppyone.js auth login -e <email> -p <pass>
#   3. Active project:  node bin/puppyone.js project use <name>
#
# Usage:
#   bash cli/tests/run.sh            # run all tests
#   bash cli/tests/run.sh sync       # run only sync tests
#   bash cli/tests/run.sh --verbose  # show command output
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $CLI_DIR/bin/puppyone.js"

VERBOSE=false
FILTER=""
PASSED=0
FAILED=0
SKIPPED=0
FAILURES=""

for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=true ;;
    *) FILTER="$arg" ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run() {
  if $VERBOSE; then
    "$@" 2>&1
  else
    "$@" > /dev/null 2>&1
  fi
}

assert_exit() {
  local expected=$1; shift
  local desc="$1"; shift
  local actual=0
  "$@" > /tmp/puppyone_test_out 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $desc"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} $desc (expected exit=$expected, got=$actual)"
    if $VERBOSE; then
      cat /tmp/puppyone_test_out | head -5 | sed 's/^/    /'
    fi
    FAILED=$((FAILED + 1))
    FAILURES="$FAILURES\n  - $desc"
  fi
}

assert_output_contains() {
  local pattern="$1"; shift
  local desc="$1"; shift
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -qi "$pattern"; then
    echo -e "  ${GREEN}✓${NC} $desc"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} $desc (output missing: \"$pattern\")"
    if $VERBOSE; then
      echo "$output" | head -5 | sed 's/^/    /'
    fi
    FAILED=$((FAILED + 1))
    FAILURES="$FAILURES\n  - $desc"
  fi
}

assert_json_success() {
  local desc="$1"; shift
  local output
  output=$("$@" --json 2>&1) || true
  if echo "$output" | grep -q '"success": true'; then
    echo -e "  ${GREEN}✓${NC} $desc"
    PASSED=$((PASSED + 1))
  else
    echo -e "  ${RED}✗${NC} $desc (JSON response not success)"
    if $VERBOSE; then
      echo "$output" | head -10 | sed 's/^/    /'
    fi
    FAILED=$((FAILED + 1))
    FAILURES="$FAILURES\n  - $desc"
  fi
}

skip() {
  local desc="$1"
  echo -e "  ${YELLOW}○${NC} $desc (skipped)"
  SKIPPED=$((SKIPPED + 1))
}

section() {
  local name="$1"
  if [ -n "$FILTER" ] && [ "$FILTER" != "$name" ]; then
    return 1
  fi
  echo -e "\n${CYAN}━━━ $name ━━━${NC}"
  return 0
}

# ── Pre-flight checks ───────────────────────────────────────

echo -e "${CYAN}PuppyOne CLI Integration Tests${NC}"
echo "CLI: $CLI"

# Check backend is reachable (health may return 503 if MCP remote is down, but that's OK)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:9090/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
  echo -e "${RED}ERROR: Backend not running at localhost:9090${NC}"
  echo "Start it: cd backend && uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload"
  exit 1
fi
echo -e "${GREEN}✓${NC} Backend reachable (HTTP $HTTP_CODE)"

# Check CLI can execute
if ! $CLI --version > /dev/null 2>&1; then
  echo -e "${RED}ERROR: CLI cannot execute${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} CLI executable (v$($CLI --version 2>&1))"

# Check auth state
AUTH_OUT=$($CLI auth whoami 2>&1) || true
if echo "$AUTH_OUT" | grep -q "Not logged in"; then
  LOGGED_IN=false
  echo -e "${YELLOW}!${NC} Not logged in — auth-required tests will be skipped"
else
  LOGGED_IN=true
  echo -e "${GREEN}✓${NC} Authenticated"
fi

# ═══════════════════════════════════════════════════════════
# Test Suites
# ═══════════════════════════════════════════════════════════

# ── 1. Basic CLI structure ──────────────────────────────────
if section "basic"; then
  assert_exit 0 "puppyone --version" $CLI --version
  assert_exit 0 "puppyone --help" $CLI --help
  assert_output_contains "Usage" "help output contains Usage" $CLI --help

  assert_exit 0 "puppyone auth --help" $CLI auth --help
  assert_exit 0 "puppyone sync --help" $CLI sync --help
  assert_exit 0 "puppyone fs --help" $CLI fs --help
  assert_exit 0 "puppyone project --help" $CLI project --help
  assert_exit 0 "puppyone org --help" $CLI org --help
  assert_exit 0 "puppyone conn --help" $CLI conn --help
  assert_exit 0 "puppyone agent --help" $CLI agent --help
  assert_exit 0 "puppyone table --help" $CLI table --help
  assert_exit 0 "puppyone tool --help" $CLI tool --help
  assert_exit 0 "puppyone ingest --help" $CLI ingest --help
fi

# ── 2. Auth ──────────────────────────────────────────────────
if section "auth"; then
  if $LOGGED_IN; then
    assert_exit 0 "auth whoami succeeds when logged in" $CLI auth whoami
    assert_output_contains "email" "whoami shows email" $CLI auth whoami
  else
    assert_exit 1 "auth whoami fails when not logged in" $CLI auth whoami
    assert_output_contains "Not logged in" "whoami shows login hint" $CLI auth whoami
  fi
fi

# ── 3. Sync ──────────────────────────────────────────────────
if section "sync"; then
  assert_exit 0 "sync providers --help" $CLI sync providers --help

  if $LOGGED_IN; then
    assert_exit 0 "sync providers lists providers" $CLI sync providers
    assert_output_contains "gmail\|notion\|github" "providers output contains known providers" $CLI sync providers

    # Check auth-status for a provider (should not crash)
    assert_exit 0 "sync auth-status gmail does not crash" $CLI sync auth-status gmail

    # List syncs (may be empty, but should not crash)
    assert_exit 0 "sync ls does not crash" $CLI sync ls
  else
    skip "sync providers (not logged in)"
    skip "sync auth-status (not logged in)"
    skip "sync ls (not logged in)"
  fi
fi

# ── 4. Project ───────────────────────────────────────────────
if section "project"; then
  if $LOGGED_IN; then
    assert_exit 0 "project ls does not crash" $CLI project ls
    assert_exit 0 "project current does not crash" $CLI project current
  else
    skip "project ls (not logged in)"
    skip "project current (not logged in)"
  fi
fi

# ── 5. Filesystem ────────────────────────────────────────────
if section "fs"; then
  if $LOGGED_IN; then
    assert_exit 0 "fs ls does not crash" $CLI fs ls
  else
    skip "fs ls (not logged in)"
  fi
fi

# ── 6. Connection ────────────────────────────────────────────
if section "conn"; then
  if $LOGGED_IN; then
    assert_exit 0 "conn ls does not crash" $CLI conn ls
  else
    skip "conn ls (not logged in)"
  fi
fi

# ── 7. Error handling ────────────────────────────────────────
if section "errors"; then
  assert_exit 1 "unknown command exits non-zero" $CLI this-does-not-exist
  assert_exit 1 "sync add without args exits non-zero" $CLI sync add

  if $LOGGED_IN; then
    assert_exit 1 "sync info with bad ID exits non-zero" $CLI sync info nonexistent-id-12345
    assert_exit 1 "sync rm with bad ID exits non-zero" $CLI sync rm nonexistent-id-12345
  else
    skip "sync info error handling (not logged in)"
    skip "sync rm error handling (not logged in)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}━━━ Results ━━━${NC}"
echo -e "  ${GREEN}Passed:  $PASSED${NC}"
if [ "$FAILED" -gt 0 ]; then
  echo -e "  ${RED}Failed:  $FAILED${NC}"
  echo -e "${RED}Failures:${NC}$FAILURES"
fi
if [ "$SKIPPED" -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped: $SKIPPED${NC}"
fi
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}FAIL${NC}"
  exit 1
else
  echo -e "${GREEN}PASS${NC}"
  exit 0
fi
