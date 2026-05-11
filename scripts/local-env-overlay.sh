#!/usr/bin/env bash
# ============================================================================
# Overlay local-supabase + local-stack values onto an existing backend/.env
# and frontend/.env, preserving everything else (GitHub OAuth credentials,
# Anthropic key, E2B key, etc.).
#
# Why we don't just use scripts/setup.sh's blanket regeneration:
#   That script writes a fresh .env from scratch, dropping the GitHub OAuth
#   credentials the user has manually configured (and any other third-party
#   keys). This overlay surgically replaces only the values that change
#   between local and remote: SUPABASE_URL/KEYS/JWT, S3 endpoint, Redis URL.
#   GITHUB_REDIRECT_URI also flips because the OAuth callback host is
#   different.
#
# Idempotent: re-running picks up fresh keys from `supabase status` and
# preserves whatever non-local fields are currently in .env.
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── 1. Pull local Supabase credentials ─────────────────────────────────────
# Use ``-o env`` so we get parseable ``KEY="value"`` pairs instead of the
# pretty-printed box that mixes Unicode borders into the output.
env_dump=$(npx supabase status -o env 2>/dev/null) || {
  echo "✖ supabase is not running — start it first with 'npx supabase start'"
  exit 1
}

# Strip stray prefix lines the CLI prints before the env block
# (e.g. "Stopped services: [...]"). ``grep '^[A-Z]'`` keeps only env lines.
env_clean=$(echo "$env_dump" | grep -E '^[A-Z][A-Z0-9_]*=')

# Source into local vars without polluting the parent shell's env.
# Each line is ``NAME="value"``; use ``eval`` inside a subshell-safe form.
get_env() {
  echo "$env_clean" | awk -F= -v k="$1" '$1==k {sub(/^[^=]+=/,""); gsub(/^"|"$/,""); print; exit}'
}

SUPABASE_API_URL=$(get_env API_URL)
SUPABASE_S3_URL=$(get_env STORAGE_S3_URL)
SUPABASE_ANON_KEY=$(get_env ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(get_env SERVICE_ROLE_KEY)
SUPABASE_JWT_SECRET=$(get_env JWT_SECRET)
SUPABASE_S3_ACCESS_KEY=$(get_env S3_PROTOCOL_ACCESS_KEY_ID)
SUPABASE_S3_SECRET_KEY=$(get_env S3_PROTOCOL_ACCESS_KEY_SECRET)

if [ -z "$SUPABASE_API_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "✖ Could not parse 'supabase status' output. Try: npx supabase status"
  exit 1
fi

echo "▶ Local Supabase API: $SUPABASE_API_URL"

# ── 2. Helper: replace-or-append a single KEY=VALUE in a file ─────────────
#
# Bash + awk based so it works in MSYS / Git-Bash on Windows.
# Handles the case where ``KEY=`` appears multiple times in the file
# (the original puppyone backend/.env had a duplicate SUPABASE_KEY /
# SUPABASE_URL pair near the top and another near the bottom — Python's
# ``load_dotenv(override=True)`` uses whichever line python-dotenv parses
# last, so we have to delete every prior occurrence and then append the
# fresh value to guarantee backend reads the new one).
upsert_env() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    echo "$key=$value" > "$file"
    return
  fi
  # 1. Delete every existing line that starts with KEY=
  awk -v k="$key" -F= '$1!=k {print}' "$file" > "${file}.tmp"
  mv "${file}.tmp" "$file"
  # 2. Append the canonical value at the end
  printf '%s=%s\n' "$key" "$value" >> "$file"
}

# ── 3. Backend .env overlay ────────────────────────────────────────────────
BACKEND_ENV="$ROOT_DIR/backend/.env"
if [ -f "$BACKEND_ENV" ]; then
  cp "$BACKEND_ENV" "$BACKEND_ENV.backup.$(date +%s)"
fi
touch "$BACKEND_ENV"

upsert_env "$BACKEND_ENV" "SUPABASE_URL"       "$SUPABASE_API_URL"
upsert_env "$BACKEND_ENV" "SUPABASE_KEY"       "$SUPABASE_SERVICE_ROLE_KEY"
upsert_env "$BACKEND_ENV" "SUPABASE_ANON_KEY"  "$SUPABASE_ANON_KEY"
upsert_env "$BACKEND_ENV" "JWT_SECRET"         "$SUPABASE_JWT_SECRET"

# Storage — we use the Supabase CLI's built-in storage (S3 protocol on its
# own port). MinIO from the root docker-compose is an alternative; the
# Supabase-built-in keeps everything in one place and makes Studio's
# storage browser work. Fall back to URL-munging if `S3 Storage URL` line
# isn't present in older CLI versions.
if [ -z "${SUPABASE_S3_URL:-}" ]; then
  SUPABASE_S3_URL="$(echo "$SUPABASE_API_URL" | sed 's#:54321#:54321/storage/v1/s3#')"
fi
upsert_env "$BACKEND_ENV" "S3_ENDPOINT_URL"      "$SUPABASE_S3_URL"
upsert_env "$BACKEND_ENV" "S3_BUCKET_NAME"       "contextbase"
upsert_env "$BACKEND_ENV" "S3_REGION"            "local"
upsert_env "$BACKEND_ENV" "S3_ACCESS_KEY_ID"     "${SUPABASE_S3_ACCESS_KEY:-625729a08b95bf1b6ff96d27f4c8ce4f}"
upsert_env "$BACKEND_ENV" "S3_SECRET_ACCESS_KEY" "${SUPABASE_S3_SECRET_KEY:-850181e4652dd023b7a98c0d6f3e5c5d2c5ceb1c12d7e22b7db4ee03ec1baa75}"
upsert_env "$BACKEND_ENV" "USE_REAL_S3"          "false"

# Redis — local docker-compose
upsert_env "$BACKEND_ENV" "ETL_REDIS_URL"    "redis://localhost:6379"
upsert_env "$BACKEND_ENV" "IMPORT_REDIS_URL" "redis://localhost:6379"

# Backend listens on 9090 by default
upsert_env "$BACKEND_ENV" "PORT"       "9090"
upsert_env "$BACKEND_ENV" "PUBLIC_URL" "http://localhost:9090"

# GitHub Integration — point at LOCAL frontend so the OAuth callback lands on
# our running Next.js dev server. The OAuth app you registered for local
# dev (see docs/local-mut-git-testing.md §2) must have this exact URL on
# the GitHub side.
upsert_env "$BACKEND_ENV" "GITHUB_REDIRECT_URI" "http://localhost:3000/oauth/github/callback"

# Skip auth not enabled by default — we want to exercise real Supabase Auth
# (signup + login). To bypass for quick smoke tests, set SKIP_AUTH=true.
upsert_env "$BACKEND_ENV" "SKIP_AUTH" "false"
upsert_env "$BACKEND_ENV" "APP_ENV"   "development"

echo "▶ backend/.env updated"

# ── 4. Frontend .env overlay ───────────────────────────────────────────────
FRONTEND_ENV="$ROOT_DIR/frontend/.env"
if [ -f "$FRONTEND_ENV" ]; then
  cp "$FRONTEND_ENV" "$FRONTEND_ENV.backup.$(date +%s)"
fi
touch "$FRONTEND_ENV"

upsert_env "$FRONTEND_ENV" "NEXT_PUBLIC_SUPABASE_URL"      "$SUPABASE_API_URL"
upsert_env "$FRONTEND_ENV" "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY"
upsert_env "$FRONTEND_ENV" "NEXT_PUBLIC_API_URL"           "http://localhost:9090"
upsert_env "$FRONTEND_ENV" "NEXT_PUBLIC_DEV_MODE"          "true"

echo "▶ frontend/.env updated"

# ── 5. Reminder ────────────────────────────────────────────────────────────

echo ""
echo "✔ Overlay applied. Backups created with .backup.<timestamp> suffix."
echo ""
echo "  Don't forget to set in backend/.env:"
echo "    GITHUB_CLIENT_ID=<your local OAuth app's client id>"
echo "    GITHUB_CLIENT_SECRET=<the secret you generated>"
echo ""
echo "  See docs/local-mut-git-testing.md §2 for how to register a local"
echo "  GitHub OAuth app."
