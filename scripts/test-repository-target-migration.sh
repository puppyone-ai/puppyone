#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_rel="supabase/migrations/20260715000000_project_owned_repository_targets_contract_cutover.sql"
contract_path="$repository_root/$contract_rel"
saved_contract="$(mktemp "${TMPDIR:-/tmp}/issue039-contract.XXXXXX.sql")"
database_url="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
export DATA_MIGRATION_DATABASE_URL="${DATA_MIGRATION_DATABASE_URL:-$database_url}"

contract_is_saved=false
restore_contract() {
    if [[ "$contract_is_saved" == true && -f "$saved_contract" ]]; then
        mv "$saved_contract" "$contract_path"
        contract_is_saved=false
    fi
}
cleanup() {
    restore_contract
    rm -f "$saved_contract"
}
trap cleanup EXIT

save_contract() {
    mv "$contract_path" "$saved_contract"
    contract_is_saved=true
}

run_data_migration() {
    local migration_id="$1"
    (
        cd "$repository_root/backend"
        uv run puppyone-db run "$migration_id"
    )
}

save_contract
(
    cd "$repository_root"
    supabase db reset --no-seed
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -f supabase/tests/fixtures/repository_target_legacy_upgrade.sql
)

run_data_migration 20260712_repo_user_permissions_to_project_members
run_data_migration 20260712_repo_user_permissions_to_project_members
run_data_migration 20260715_project_owned_repository_targets_preflight
run_data_migration 20260715_project_owned_repository_targets_preflight

restore_contract
(
    cd "$repository_root"
    supabase migration up --local

    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "INSERT INTO public.repository_scopes (id, project_id, name, path, exclude, max_mode) VALUES ('issue039-concurrent-scope', 'issue039-project', 'Concurrent Scope', 'concurrent/scope', '[]', 'rw')"

    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "SELECT count(*) FROM public.ensure_repository_target_access_surfaces('issue039-project', 'issue039-concurrent-scope', '00000000-0000-0000-0000-000000039001'::uuid, NULL, NULL)" &
    first_pid=$!
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "SELECT count(*) FROM public.ensure_repository_target_access_surfaces('issue039-project', 'issue039-concurrent-scope', '00000000-0000-0000-0000-000000039001'::uuid, NULL, NULL)" &
    second_pid=$!
    wait "$first_pid"
    wait "$second_pid"

    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "DO \$\$ BEGIN IF (SELECT count(*) FROM public.access_surfaces WHERE project_id = 'issue039-project' AND scope_id = 'issue039-concurrent-scope' AND kind IN ('git_remote', 'cli')) <> 2 THEN RAISE EXCEPTION 'concurrent enable did not converge'; END IF; END \$\$"
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -f supabase/tests/fixtures/repository_target_upgrade_assert.sql
)

# A non-empty installation cannot bypass the immutable data-preflight receipt.
save_contract
(
    cd "$repository_root"
    supabase db reset --no-seed
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -f supabase/tests/fixtures/repository_target_legacy_upgrade.sql
)
restore_contract
if (
    cd "$repository_root"
    supabase migration up --local
); then
    echo "expected contract migration to reject a missing preflight receipt" >&2
    exit 1
fi
(
    cd "$repository_root"
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "DO \$\$ BEGIN IF to_regclass('public.repo_scopes') IS NULL OR to_regclass('public.repository_scopes') IS NOT NULL THEN RAISE EXCEPTION 'receipt gate failure mutated the schema'; END IF; END \$\$"
)

save_contract
(
    cd "$repository_root"
    supabase db reset --no-seed
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -f supabase/tests/fixtures/repository_target_corrupt_missing_root.sql
)

if run_data_migration 20260715_project_owned_repository_targets_preflight; then
    echo "expected repository target preflight to reject a missing root" >&2
    exit 1
fi

(
    cd "$repository_root"
    psql "$database_url" -X -v ON_ERROR_STOP=1 \
        -c "DO \$\$ BEGIN IF to_regclass('public.repo_scopes') IS NULL THEN RAISE EXCEPTION 'failed preflight mutated the schema'; END IF; IF EXISTS (SELECT 1 FROM public.migration_log WHERE name = '20260715_project_owned_repository_targets_preflight') THEN RAISE EXCEPTION 'failed preflight wrote a receipt'; END IF; END \$\$"
)

restore_contract
