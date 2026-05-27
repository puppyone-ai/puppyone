# Physical DB rename: `mut_*` → `version_*`

Tracked in [07-version-engine-todo.md](07-version-engine-todo.md) and listed as P2 in the V2 audit. The doc says "intentionally deferred"; this file is the deploy-sequencing plan when we're ready.

## Why not done yet

- 17 existing migrations reference `mut_*` tables/columns
- 6 RPC functions (`publish_mut_*`, `get_mut_*`, `claim/complete/fail_mut_*`) have bodies that ALSO reference `mut_*` tables
- Single-statement rename would freeze writes for the ALTER duration
- All current runtime code routes through [`db_names.py`](../../backend/src/version_engine/infrastructure/supabase/db_names.py) — the cutover is purely operational, no code-shape change required

## Cutover protocol (expand-and-contract)

### Phase 1 — Compat views

```sql
-- Each mut_* table gets a same-data view that future code can read.
CREATE VIEW public.version_commits AS SELECT * FROM public.mut_commits;
CREATE VIEW public.version_scope_state AS SELECT * FROM public.mut_scope_state;
CREATE VIEW public.version_outbox AS SELECT * FROM public.mut_version_outbox;
CREATE VIEW public.version_object_locations AS SELECT * FROM public.mut_object_locations;
CREATE VIEW public.version_conflicts AS SELECT * FROM public.mut_conflicts;
CREATE VIEW public.version_index AS SELECT * FROM public.mut_version_index;
```

Views are read-only by default in PG, but the application only WRITES through RPC functions and the explicit Supabase `client.table()` paths — both can be flipped to `version_*` names atomically in Phase 3.

### Phase 2 — Renamed RPC wrappers

For `publish_mut_project_update`, project-write-state, and
`claim/complete/fail_mut_*`:

```sql
-- Wrapper that calls the old RPC. Keep old RPC alive until Phase 4.
CREATE OR REPLACE FUNCTION public.publish_version_project_update(...)
RETURNS ... AS $$
  SELECT * FROM public.publish_mut_project_update(...);
$$ LANGUAGE sql;
```

### Phase 3 — Code cutover (single deploy)

Update `db_names.py`:

```python
COMMIT_HISTORY_TABLE = "version_commits"
SCOPE_STATE_TABLE = "version_scope_state"
VERSION_INDEX_TABLE = "version_index"
VERSION_OUTBOX_TABLE = "version_outbox"
OBJECT_LOCATIONS_TABLE = "version_object_locations"
CONFLICTS_TABLE = "version_conflicts"

PROJECT_ROOT_HASH_COLUMN = "version_root_hash"
GITHUB_SYNC_VERSION_COLUMN = "version_commit_id"

PUBLISH_PROJECT_UPDATE_RPC = "publish_version_project_update"
PROJECT_WRITE_STATE_RPC = "get_version_project_write_state"
CLAIM_OUTBOX_RPC = "claim_version_outbox_batch"
COMPLETE_OUTBOX_RPC = "complete_version_outbox"
FAIL_OUTBOX_RPC = "fail_version_outbox"
```

Plus the columns `projects.mut_root_hash` → `projects.version_root_hash` and `github_sync_log.mut_commit_id` → `github_sync_log.version_commit_id` need explicit column renames:

```sql
ALTER TABLE public.projects RENAME COLUMN mut_root_hash TO version_root_hash;
ALTER TABLE public.github_sync_log RENAME COLUMN mut_commit_id TO version_commit_id;
```

Column renames don't need a view alias because the views above hide them in the table-view layer.

### Phase 4 — Drop legacy

After one stable release on the new names:

```sql
DROP FUNCTION public.publish_mut_project_update;
DROP FUNCTION public.get_mut_project_write_state;
DROP FUNCTION public.claim_mut_version_outbox_batch;
DROP FUNCTION public.complete_mut_version_outbox;
DROP FUNCTION public.fail_mut_version_outbox;

-- Tables: ALTER RENAME so any in-flight references via VIEW collapse cleanly.
ALTER TABLE public.mut_commits RENAME TO version_commits_real;
DROP VIEW public.version_commits;
ALTER TABLE public.version_commits_real RENAME TO version_commits;
-- (repeat for each table)
```

## Why this isn't a single-shot migration

- The current ``publish_mut_*`` RPCs are called from multiple deployed worker processes (api, file_worker, mcp_server). A straight `ALTER TABLE` would break in-flight transactions until everyone redeploys.
- Phase 1+2 buys backwards compat. Phase 3 is the actual switch (single coordinated deploy). Phase 4 is cleanup after observability confirms no `mut_*` references remain.

## Estimated effort

- Phase 1+2 migration: 1 hour to write, 5 minutes to apply
- Phase 3 deploy: same as any production deploy — staging + canary + monitor
- Phase 4 cleanup: 1 hour to write, applied after ≥1 week of soak time

Total: ~1 day spread across 2 weeks.
