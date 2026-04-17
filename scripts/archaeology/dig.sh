#!/bin/bash
# ============================================================
# DB Archaeology Script
# ============================================================
# Compares the actual schema of qubits (staging) and main (production)
# branches against what the migration files in supabase/migrations/
# would produce on a fresh database.
#
# Output: docs/archaeology/<TIMESTAMP>/
#
# Required env vars (set before running):
#   QUBITS_DB_PASSWORD        Password for qubits branch DB
#   PROD_DB_PASSWORD          Password for production branch DB
#
# Optional:
#   QUBITS_PROJECT_REF        Default: qextonmjqbhxgokmjbio
#   PROD_PROJECT_REF          Default: vxhyuctgfyxxlhobdpca
#   PG_BACKEND                "host" (default) — uses brew postgresql@17 via pg_ctl
#                             "docker" — uses docker postgres:17 image
#   SKIP_LOCAL                If "1", skip "expected schema" build entirely
#
# Prerequisites:
#   - libpq (for psql/pg_dump):    brew install libpq
#   - For host backend:            brew install postgresql@17
#   - For docker backend:          Docker Desktop running, no proxy issues
# ============================================================

set -euo pipefail

# ---- Resolve paths ----
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="$REPO_ROOT/docs/archaeology/$TIMESTAMP"
mkdir -p "$OUTPUT_DIR"

# ---- Defaults ----
QUBITS_PROJECT_REF="${QUBITS_PROJECT_REF:-qextonmjqbhxgokmjbio}"
PROD_PROJECT_REF="${PROD_PROJECT_REF:-vxhyuctgfyxxlhobdpca}"
SKIP_LOCAL="${SKIP_LOCAL:-0}"

# ---- Make psql available ----
PSQL_PATH="/opt/homebrew/opt/libpq/bin/psql"
if ! command -v psql >/dev/null 2>&1; then
  if [ -x "$PSQL_PATH" ]; then
    export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
  else
    echo "ERROR: psql not found. Install with: brew install libpq"
    exit 1
  fi
fi

# ---- Color helpers ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
log()    { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()     { echo -e "${GREEN}[OK]${NC} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()   { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
section(){ echo ""; echo -e "${BLUE}========================================${NC}"; echo -e "${BLUE} $* ${NC}"; echo -e "${BLUE}========================================${NC}"; }

# ---- Required env vars ----
[ -n "${QUBITS_DB_PASSWORD:-}" ] || fail "Set QUBITS_DB_PASSWORD env var first"
[ -n "${PROD_DB_PASSWORD:-}" ]   || fail "Set PROD_DB_PASSWORD env var first"

cd "$REPO_ROOT"
log "Repo root:   $REPO_ROOT"
log "Output dir:  $OUTPUT_DIR"
log "Qubits ref:  $QUBITS_PROJECT_REF"
log "Prod ref:    $PROD_PROJECT_REF"

# ============================================================
section "1/5  Dump QUBITS branch (current actual state)"
# ============================================================

# Use direct postgres connection (db.<ref>.supabase.co:5432)
QUBITS_DB_URL="postgresql://postgres.${QUBITS_PROJECT_REF}:${QUBITS_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
# Fallback: direct connection (some projects don't have pooler accessible)
QUBITS_DB_URL_DIRECT="postgresql://postgres:${QUBITS_DB_PASSWORD}@db.${QUBITS_PROJECT_REF}.supabase.co:5432/postgres"

log "Trying pooler connection..."
if psql "$QUBITS_DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  ok "Connected via pooler"
elif psql "$QUBITS_DB_URL_DIRECT" -c "SELECT 1" >/dev/null 2>&1; then
  QUBITS_DB_URL="$QUBITS_DB_URL_DIRECT"
  ok "Connected via direct"
else
  fail "Cannot connect to qubits DB. Check password and network."
fi

log "Dumping qubits public schema..."
pg_dump "$QUBITS_DB_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-acl \
  --no-comments \
  > "$OUTPUT_DIR/01-qubits-schema.sql" 2>"$OUTPUT_DIR/01-qubits-schema.err" \
  || { warn "pg_dump returned non-zero. Check 01-qubits-schema.err"; }

log "Dumping qubits schema_migrations table..."
psql "$QUBITS_DB_URL" -c "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;" \
  > "$OUTPUT_DIR/04-qubits-applied-migrations.txt" 2>&1 \
  || warn "Could not read schema_migrations from qubits"

log "Counting qubits objects..."
psql "$QUBITS_DB_URL" -At -c "
  SELECT 'tables: ' || count(*) FROM pg_tables WHERE schemaname='public'
  UNION ALL SELECT 'functions: ' || count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'
  UNION ALL SELECT 'triggers: ' || count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL SELECT 'views: ' || count(*) FROM pg_views WHERE schemaname='public'
  UNION ALL SELECT 'indexes: ' || count(*) FROM pg_indexes WHERE schemaname='public';
" > "$OUTPUT_DIR/04-qubits-stats.txt" 2>&1 || warn "Could not count qubits objects"

ok "Qubits dump complete"
cat "$OUTPUT_DIR/04-qubits-stats.txt" | head -10

# ============================================================
section "2/5  Dump PRODUCTION branch (current actual state)"
# ============================================================

PROD_DB_URL="postgresql://postgres.${PROD_PROJECT_REF}:${PROD_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
PROD_DB_URL_DIRECT="postgresql://postgres:${PROD_DB_PASSWORD}@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres"

log "Trying pooler connection..."
if psql "$PROD_DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  ok "Connected via pooler"
elif psql "$PROD_DB_URL_DIRECT" -c "SELECT 1" >/dev/null 2>&1; then
  PROD_DB_URL="$PROD_DB_URL_DIRECT"
  ok "Connected via direct"
else
  fail "Cannot connect to production DB. Check password and network."
fi

log "Dumping production public schema..."
pg_dump "$PROD_DB_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-acl \
  --no-comments \
  > "$OUTPUT_DIR/02-prod-schema.sql" 2>"$OUTPUT_DIR/02-prod-schema.err" \
  || warn "pg_dump returned non-zero. Check 02-prod-schema.err"

log "Dumping production schema_migrations table..."
psql "$PROD_DB_URL" -c "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;" \
  > "$OUTPUT_DIR/05-prod-applied-migrations.txt" 2>&1 \
  || warn "Could not read schema_migrations from prod"

log "Counting production objects..."
psql "$PROD_DB_URL" -At -c "
  SELECT 'tables: ' || count(*) FROM pg_tables WHERE schemaname='public'
  UNION ALL SELECT 'functions: ' || count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'
  UNION ALL SELECT 'triggers: ' || count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL SELECT 'views: ' || count(*) FROM pg_views WHERE schemaname='public'
  UNION ALL SELECT 'indexes: ' || count(*) FROM pg_indexes WHERE schemaname='public';
" > "$OUTPUT_DIR/05-prod-stats.txt" 2>&1 || warn "Could not count prod objects"

ok "Production dump complete"
cat "$OUTPUT_DIR/05-prod-stats.txt" | head -10

# ============================================================
section "3/5  Build EXPECTED schema (apply all migrations to fresh local Postgres)"
# ============================================================

if [ "$SKIP_LOCAL" = "1" ]; then
  warn "SKIP_LOCAL=1 — skipping local schema build. Will only do prod-vs-qubits comparison."
else
  log "Listing migration files..."
  ls "$REPO_ROOT/supabase/migrations/" 2>/dev/null | grep -E '\.sql$' | sort \
    > "$OUTPUT_DIR/06-expected-migrations.txt" || true
  cat "$OUTPUT_DIR/06-expected-migrations.txt" | wc -l | xargs echo "Migration file count:"

  # Pick backend: PG_BACKEND=host (default) | docker
  PG_BACKEND="${PG_BACKEND:-host}"

  if [ "$PG_BACKEND" = "docker" ]; then
    log "Using Docker backend..."
    docker rm -f puppyone-archaeology-pg 2>/dev/null || true
    docker run -d \
      --name puppyone-archaeology-pg \
      -e POSTGRES_PASSWORD=archaeology \
      -e POSTGRES_DB=postgres \
      -p 54399:5432 \
      postgres:17 >/dev/null
    for i in {1..30}; do
      if docker exec puppyone-archaeology-pg pg_isready -U postgres >/dev/null 2>&1; then
        ok "Postgres ready"; break
      fi
      sleep 1
    done
    LOCAL_DB_URL="postgresql://postgres:archaeology@localhost:54399/postgres"
    PG_CLEANUP="docker rm -f puppyone-archaeology-pg >/dev/null 2>&1"
  else
    log "Using host Postgres backend (transient pg_ctl-managed instance on port 54399)..."

    # Find pg_ctl + initdb + postgres binaries (try postgresql@17 then any)
    PG_BIN=""
    for v in 17 16 15; do
      if [ -x "/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl" ]; then
        PG_BIN="/opt/homebrew/opt/postgresql@${v}/bin"; break
      fi
    done
    [ -z "$PG_BIN" ] && [ -x "/opt/homebrew/opt/postgresql/bin/pg_ctl" ] && PG_BIN="/opt/homebrew/opt/postgresql/bin"
    [ -z "$PG_BIN" ] && [ -x "/usr/local/opt/postgresql@17/bin/pg_ctl" ] && PG_BIN="/usr/local/opt/postgresql@17/bin"
    [ -z "$PG_BIN" ] && fail "Postgres server not found. Install with: brew install postgresql@17"
    export PATH="$PG_BIN:$PATH"
    log "Using PG bin: $PG_BIN"

    PGDATA_DIR="/tmp/puppyone-archaeology-pgdata-$$"
    PGLOG="/tmp/puppyone-archaeology-pg-$$.log"
    rm -rf "$PGDATA_DIR"

    log "Initializing transient cluster at $PGDATA_DIR ..."
    initdb -D "$PGDATA_DIR" -U postgres --auth-local=trust --auth-host=trust >/dev/null 2>&1 || fail "initdb failed"

    # Listen only on 127.0.0.1:54399, no unix socket conflicts elsewhere
    cat >> "$PGDATA_DIR/postgresql.conf" <<'CONF'
listen_addresses = '127.0.0.1'
port = 54399
unix_socket_directories = ''
CONF

    log "Starting transient Postgres on port 54399 ..."
    pg_ctl -D "$PGDATA_DIR" -l "$PGLOG" -w start >/dev/null 2>&1 || { cat "$PGLOG"; fail "pg_ctl start failed"; }
    ok "Postgres ready (pid: $(cat $PGDATA_DIR/postmaster.pid | head -1))"

    LOCAL_DB_URL="postgresql://postgres@127.0.0.1:54399/postgres"
    PG_CLEANUP="pg_ctl -D '$PGDATA_DIR' -m fast stop >/dev/null 2>&1; rm -rf '$PGDATA_DIR' '$PGLOG'"

    # Ensure cleanup even on script failure
    trap "$PG_CLEANUP" EXIT
  fi

  # Some migrations reference auth.uid() / auth schema / supabase_admin / etc.
  # Stub those minimally so migrations don't blow up.
  log "Installing auth/storage stubs (so migrations referencing auth.* don't fail)..."
  psql "$LOCAL_DB_URL" -c "
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS graphql;
    CREATE SCHEMA IF NOT EXISTS vault;
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;

    -- Stub auth.users (real one has many cols, we only need id for FK)
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      raw_user_meta_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Stub auth.uid() function
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS \$\$
      SELECT NULL::UUID;
    \$\$ LANGUAGE SQL STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS \$\$
      SELECT 'service_role'::TEXT;
    \$\$ LANGUAGE SQL STABLE;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS \$\$
      SELECT '{}'::JSONB;
    \$\$ LANGUAGE SQL STABLE;

    -- Common extensions installed in 'extensions' schema (matches Supabase layout)
    -- so calls like extensions.uuid_generate_v4() in migrations resolve correctly.
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;

    -- Supabase auto-creates this publication for realtime; baseline ALTERs it.
    DO \$\$ BEGIN
      CREATE PUBLICATION supabase_realtime;
      EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;

    -- Roles that Supabase migrations sometimes reference
    DO \$\$ BEGIN
      CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;
    DO \$\$ BEGIN
      CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;
    DO \$\$ BEGIN
      CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;
    DO \$\$ BEGIN
      CREATE ROLE supabase_auth_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL;
    END \$\$;

    -- Track what we apply
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT,
      statements TEXT[]
    );
  " > "$OUTPUT_DIR/07-stubs.log" 2>&1 || warn "Stub setup had warnings (often OK)"

  log "Applying migrations one by one..."
  APPLIED=0
  FAILED=0
  EXPECTED_FAIL=0
  : > "$OUTPUT_DIR/07-migration-apply.log"

  # Preprocessor: skip Supabase-specific CREATE EXTENSION statements that
  # don't have a control file in vanilla Postgres.  Other extensions
  # (pgcrypto, uuid-ossp) are already installed by the stubs section.
  PREPROCESS_SED='
    /CREATE EXTENSION IF NOT EXISTS "pg_net"/         s|^|-- LOCAL_SKIP: |
    /CREATE EXTENSION IF NOT EXISTS "pg_graphql"/     s|^|-- LOCAL_SKIP: |
    /CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"/ s|^|-- LOCAL_SKIP: |
    /CREATE EXTENSION IF NOT EXISTS "supabase_vault"/ s|^|-- LOCAL_SKIP: |
  '

  # Migrations known to NOT be runnable on a fresh DB.
  # These exist as one-time fixups for production state that was already
  # past these changes when baseline was generated.  Their failure here is
  # informational, not a real bug.
  KNOWN_PROD_ONLY="20260308000000_prod_alignment.sql"

  is_known_prod_only() {
    local fn="$1"
    for known in $KNOWN_PROD_ONLY; do
      [ "$fn" = "$known" ] && return 0
    done
    return 1
  }

  for f in "$REPO_ROOT/supabase/migrations/"*.sql; do
    fname=$(basename "$f")
    version=$(echo "$fname" | grep -oE '^[0-9]+' || echo "")
    name=$(echo "$fname" | sed -E 's/^[0-9]+_//; s/\.sql$//')

    echo "----- $fname -----" >> "$OUTPUT_DIR/07-migration-apply.log"
    if sed -E "$PREPROCESS_SED" "$f" \
         | psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
         >> "$OUTPUT_DIR/07-migration-apply.log" 2>&1; then
      APPLIED=$((APPLIED+1))
      echo "  ✓ APPLIED: $fname" >> "$OUTPUT_DIR/07-migration-apply.log"
      psql "$LOCAL_DB_URL" -c "
        INSERT INTO supabase_migrations.schema_migrations (version, name)
        VALUES ('$version', '$name')
        ON CONFLICT DO NOTHING;
      " > /dev/null 2>&1
    elif is_known_prod_only "$fname"; then
      EXPECTED_FAIL=$((EXPECTED_FAIL+1))
      echo "  ⊘ EXPECTED FAIL (production-only fixup): $fname" >> "$OUTPUT_DIR/07-migration-apply.log"
    else
      FAILED=$((FAILED+1))
      echo "  ✗ FAILED: $fname" >> "$OUTPUT_DIR/07-migration-apply.log"
    fi
  done

  ok "Applied: $APPLIED, Failed: $FAILED, Expected-fail (prod-only): $EXPECTED_FAIL"
  if [ "$FAILED" -gt 0 ]; then
    warn "Unexpected migration failures. Check $OUTPUT_DIR/07-migration-apply.log for details."
  fi

  log "Dumping expected schema..."
  pg_dump "$LOCAL_DB_URL" \
    --schema-only \
    --schema=public \
    --no-owner \
    --no-acl \
    --no-comments \
    > "$OUTPUT_DIR/03-expected-schema.sql" 2>"$OUTPUT_DIR/03-expected-schema.err"

  log "Counting expected objects..."
  psql "$LOCAL_DB_URL" -At -c "
    SELECT 'tables: ' || count(*) FROM pg_tables WHERE schemaname='public'
    UNION ALL SELECT 'functions: ' || count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'
    UNION ALL SELECT 'triggers: ' || count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL SELECT 'views: ' || count(*) FROM pg_views WHERE schemaname='public'
    UNION ALL SELECT 'indexes: ' || count(*) FROM pg_indexes WHERE schemaname='public';
  " > "$OUTPUT_DIR/06-expected-stats.txt" 2>&1
  cat "$OUTPUT_DIR/06-expected-stats.txt"

  log "Stopping local Postgres..."
  eval "$PG_CLEANUP"
  trap - EXIT

  ok "Expected schema build complete"
fi

# ============================================================
section "4/5  Three-way diff"
# ============================================================

log "Diffing qubits vs prod..."
diff -u "$OUTPUT_DIR/01-qubits-schema.sql" "$OUTPUT_DIR/02-prod-schema.sql" \
  > "$OUTPUT_DIR/12-qubits-vs-prod.diff" 2>&1 || true
LINES=$(wc -l < "$OUTPUT_DIR/12-qubits-vs-prod.diff" | tr -d ' ')
echo "  qubits-vs-prod.diff: $LINES lines"

if [ -f "$OUTPUT_DIR/03-expected-schema.sql" ]; then
  log "Diffing qubits vs expected..."
  diff -u "$OUTPUT_DIR/03-expected-schema.sql" "$OUTPUT_DIR/01-qubits-schema.sql" \
    > "$OUTPUT_DIR/10-qubits-vs-expected.diff" 2>&1 || true
  LINES=$(wc -l < "$OUTPUT_DIR/10-qubits-vs-expected.diff" | tr -d ' ')
  echo "  qubits-vs-expected.diff: $LINES lines"

  log "Diffing prod vs expected..."
  diff -u "$OUTPUT_DIR/03-expected-schema.sql" "$OUTPUT_DIR/02-prod-schema.sql" \
    > "$OUTPUT_DIR/11-prod-vs-expected.diff" 2>&1 || true
  LINES=$(wc -l < "$OUTPUT_DIR/11-prod-vs-expected.diff" | tr -d ' ')
  echo "  prod-vs-expected.diff: $LINES lines"
fi

log "Diffing schema_migrations tables..."
diff -u "$OUTPUT_DIR/04-qubits-applied-migrations.txt" "$OUTPUT_DIR/05-prod-applied-migrations.txt" \
  > "$OUTPUT_DIR/13-applied-migrations-diff.txt" 2>&1 || true

# ============================================================
section "5/5  Generate summary report"
# ============================================================

cat > "$OUTPUT_DIR/README.md" <<EOF
# DB Archaeology Report — $TIMESTAMP

Generated by \`scripts/archaeology/dig.sh\` on $(date).

## Object Counts

\`\`\`
QUBITS (qextonmjqbhxgokmjbio):
$(cat "$OUTPUT_DIR/04-qubits-stats.txt" 2>/dev/null || echo "  (failed)")

PRODUCTION (vxhyuctgfyxxlhobdpca):
$(cat "$OUTPUT_DIR/05-prod-stats.txt" 2>/dev/null || echo "  (failed)")

EXPECTED (from supabase/migrations/*.sql):
$(cat "$OUTPUT_DIR/06-expected-stats.txt" 2>/dev/null || echo "  (skipped — set SKIP_LOCAL=0)")
\`\`\`

## Files

| File | Purpose |
|---|---|
| \`01-qubits-schema.sql\` | Raw schema dump of qubits (staging) DB |
| \`02-prod-schema.sql\` | Raw schema dump of production DB |
| \`03-expected-schema.sql\` | Schema after applying all migrations to a fresh DB |
| \`04-qubits-applied-migrations.txt\` | What \`schema_migrations\` says was applied to qubits |
| \`05-prod-applied-migrations.txt\` | What \`schema_migrations\` says was applied to prod |
| \`06-expected-migrations.txt\` | All \`*.sql\` files in \`supabase/migrations/\` |
| \`10-qubits-vs-expected.diff\` | What's drifted on qubits vs migration files |
| \`11-prod-vs-expected.diff\` | What's drifted on prod vs migration files |
| \`12-qubits-vs-prod.diff\` | What differs between qubits and prod |
| \`13-applied-migrations-diff.txt\` | Migration registration mismatch between envs |
| \`07-migration-apply.log\` | Errors when applying migrations to local Postgres |

## Next Steps

1. Review \`13-applied-migrations-diff.txt\` first — quickest signal of drift
2. Read \`10-qubits-vs-expected.diff\` and \`11-prod-vs-expected.diff\`
3. Categorize each drift:
   - **Ghost schema** (in DB, not in migrations) → must add migration OR delete object
   - **Missing object** (in migrations, not in DB) → migration didn't apply, must re-run
   - **Modified object** (different in DB vs migrations) → manual edit, decide which is correct

EOF

ok "Report generated: $OUTPUT_DIR/README.md"
echo ""
echo "================================================"
echo "Archaeology complete!"
echo "Output: $OUTPUT_DIR"
echo "================================================"
ls -la "$OUTPUT_DIR"
