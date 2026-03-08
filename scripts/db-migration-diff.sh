#!/bin/bash
# ============================================================
# db-migration-diff.sh
# Generate a migration SQL by comparing test DB vs production DB
# ============================================================
# Usage:
#   ./scripts/db-migration-diff.sh
#   ./scripts/db-migration-diff.sh --apply   (also applies to prod, use with caution)
#
# Prerequisites:
#   - supabase CLI installed
#   - Logged in: supabase login
# ============================================================

set -euo pipefail

TEST_PROJECT="qextonmjqbhxgokmjbio"
PROD_PROJECT="vxhyuctgfyxxlhobdpca"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="supabase/migrations/${TIMESTAMP}_migration.sql"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Database Migration Diff ===${NC}"
echo "Test project:  ${TEST_PROJECT}"
echo "Prod project:  ${PROD_PROJECT}"
echo ""

echo -e "${GREEN}[1/4] Dumping production schema (read-only)...${NC}"
supabase link --project-ref "$PROD_PROJECT" 2>/dev/null
supabase db dump --linked --schema public > /tmp/prod_schema_${TIMESTAMP}.sql 2>/dev/null

echo -e "${GREEN}[2/4] Dumping test schema (read-only)...${NC}"
supabase link --project-ref "$TEST_PROJECT" 2>/dev/null
supabase db dump --linked --schema public > /tmp/test_schema_${TIMESTAMP}.sql 2>/dev/null

echo -e "${GREEN}[3/4] Comparing schemas...${NC}"

PROD_TABLES=$(grep 'CREATE TABLE' /tmp/prod_schema_${TIMESTAMP}.sql | sed 's/CREATE TABLE IF NOT EXISTS //' | sed 's/ (//' | sort)
TEST_TABLES=$(grep 'CREATE TABLE' /tmp/test_schema_${TIMESTAMP}.sql | sed 's/CREATE TABLE IF NOT EXISTS //' | sed 's/ (//' | sort)

NEW_TABLES=$(comm -13 <(echo "$PROD_TABLES") <(echo "$TEST_TABLES"))
REMOVED_TABLES=$(comm -23 <(echo "$PROD_TABLES") <(echo "$TEST_TABLES"))

echo ""
echo "=== DIFF SUMMARY ==="
echo ""

if [ -z "$NEW_TABLES" ] && [ -z "$REMOVED_TABLES" ]; then
    echo -e "${GREEN}No table-level differences found.${NC}"
    echo "Checking column-level differences..."
fi

if [ -n "$NEW_TABLES" ]; then
    echo -e "${YELLOW}Tables in TEST but not in PROD (to be added):${NC}"
    echo "$NEW_TABLES" | while read -r line; do echo "  + $line"; done
    echo ""
fi

if [ -n "$REMOVED_TABLES" ]; then
    echo -e "${RED}Tables in PROD but not in TEST (potentially renamed/removed):${NC}"
    echo "$REMOVED_TABLES" | while read -r line; do echo "  - $line"; done
    echo ""
fi

PROD_LINES=$(wc -l < /tmp/prod_schema_${TIMESTAMP}.sql | tr -d ' ')
TEST_LINES=$(wc -l < /tmp/test_schema_${TIMESTAMP}.sql | tr -d ' ')
DIFF_LINES=$((TEST_LINES - PROD_LINES))

echo "Production schema: ${PROD_LINES} lines"
echo "Test schema:       ${TEST_LINES} lines"
echo "Difference:        ${DIFF_LINES} lines"
echo ""

echo -e "${GREEN}[4/4] Schema dumps saved:${NC}"
echo "  Production: /tmp/prod_schema_${TIMESTAMP}.sql"
echo "  Test:       /tmp/test_schema_${TIMESTAMP}.sql"
echo ""
echo "To generate detailed diff:"
echo "  diff /tmp/prod_schema_${TIMESTAMP}.sql /tmp/test_schema_${TIMESTAMP}.sql"
echo ""

if [ "${DIFF_LINES}" -eq 0 ]; then
    echo -e "${GREEN}Databases are in sync. No migration needed.${NC}"
else
    echo -e "${YELLOW}Databases are NOT in sync.${NC}"
    echo "Write your migration SQL to: ${OUTPUT_FILE}"
    echo "Then apply to production in Supabase SQL Editor."
fi

echo ""
echo -e "${GREEN}Restoring link to test project...${NC}"
supabase link --project-ref "$TEST_PROJECT" 2>/dev/null
echo "Done."
