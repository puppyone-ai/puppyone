# mut_* → version_* SQL migration plan

**Status:** Phase 1 shipped (additive views). Phase 2 + Phase 3 deferred pending DB review.

The runtime architecture is "Version Engine"; the SQL layer still
carries the legacy `mut_*` prefix from a previous rename. This doc
captures the safe phasing for finishing the rename without an
outage.

## Phase 1 — Additive views (shipped)

File: [`supabase/migrations/20260525000000_version_table_aliases_phase1.sql`](../../supabase/migrations/20260525000000_version_table_aliases_phase1.sql)

- Creates `version_*` views over the current `mut_*` tables.
- Auto-updatable, so SELECT/INSERT/UPDATE/DELETE all pass through.
- RLS continues to fire on the base tables.
- Reversible: `DROP VIEW` to undo.

## Phase 2 — Rename tables and recreate compat in the other direction (deferred)

Pre-deploy work:

1. Run the following query and capture exact signatures for the
   active RPCs that need renaming:
   ```sql
   SELECT n.nspname || '.' || p.proname AS name,
          pg_get_function_arguments(p.oid) AS args,
          pg_get_function_result(p.oid) AS result
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname IN (
     'publish_mut_project_update',
     'get_mut_project_write_state',
     'claim_mut_version_outbox_batch',
     'complete_mut_version_outbox',
     'fail_mut_version_outbox'
   );
   ```
2. Use the captured signatures to write the rename + wrapper SQL.

Phase 2 SQL outline:

```sql
BEGIN;
-- 1. Drop Phase 1 forward views (they'd block table rename).
DROP VIEW IF EXISTS public.version_commits;
-- ...repeat for each version_* view created in Phase 1...

-- 2. Rename mut_* tables to version_*.
ALTER TABLE IF EXISTS public.mut_commits          RENAME TO version_commits;
ALTER TABLE IF EXISTS public.mut_scope_state      RENAME TO version_scope_state;
ALTER TABLE IF EXISTS public.mut_version_index    RENAME TO version_view_commits;
ALTER TABLE IF EXISTS public.mut_version_outbox   RENAME TO version_outbox;
ALTER TABLE IF EXISTS public.mut_conflicts        RENAME TO version_conflicts;
ALTER TABLE IF EXISTS public.mut_object_locations RENAME TO version_object_locations;

-- 3. Recreate compat views in the reverse direction.
CREATE OR REPLACE VIEW public.mut_commits AS SELECT * FROM public.version_commits;
-- ...repeat for the others...

-- 4. ALTER FUNCTION ... RENAME for the six RPCs, using the
--    captured signatures from the pre-deploy query. After each
--    rename, declare a thin SQL wrapper at the old name that
--    forwards arguments to the renamed function.

-- 5. NOTIFY pgrst, 'reload schema';
COMMIT;
```

Backend code change (lands together with the SQL):

- `backend/src/version_engine/infrastructure/supabase/db_names.py` —
  flip every constant from `"mut_*"` to `"version_*"` and the RPC
  constants likewise.

## Phase 3 — Drop compat views (deferred indefinitely)

Once dashboards / cron jobs / analytics / external readers have
been verified to use the new names, drop:

- The `mut_*` compat views from Phase 2.
- The `*_mut_*` RPC wrappers from Phase 2.

## Column renames (out of scope for the table-rename phases)

Two `mut_*` prefixed columns also need attention; rename them in a
separate migration so the table rename doesn't bundle row-level
data manipulation risk:

- `projects.mut_root_hash` → `projects.version_root_hash`
- `github_sync_log.mut_commit_id` → `github_sync_log.version_commit_id`

Each is a straight `ALTER TABLE ... RENAME COLUMN`. Backend code
change: update `PROJECT_ROOT_HASH_COLUMN` and
`GITHUB_SYNC_VERSION_COLUMN` constants in `db_names.py`.
