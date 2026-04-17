# Schema Alignment Complete (2026-04-18)

> Status: ✅ qubits ≡ prod ≡ expected (functionally identical)
>
> To reproduce the verification, run `./scripts/archaeology/dig.sh` (writes to a gitignored `docs/archaeology/<timestamp>/`).

## TL;DR

Three databases that diverged for months are now provably equivalent.

| Pair | Diff size | What's left |
|------|-----------|-------------|
| `qubits` ↔ `expected` | 21 lines | 100% pg_dump cosmetic noise (`\restrict` session ids, `17.6` vs `17.9` server version) |
| `prod` ↔ `expected` | 64 lines | Cosmetic noise + 3 column physical-position swaps |
| `qubits` ↔ `prod` | 61 lines | Same 3 column physical-position swaps (no FK / type / constraint diffs) |
| `qubits.schema_migrations` ↔ `prod.schema_migrations` | **0 lines** | Identical migration sets |

The only "real" remaining noise is **column physical ordering** in three tables (`access_points`, `profiles`, `projects`). That's because some columns were added to prod via `ALTER TABLE` over time so they sit at the physical end of the row, while a freshly-built schema lays them out in the order the original `CREATE TABLE` declared. PostgreSQL queries reference columns by name — physical ordering has zero impact on indexes, constraints, foreign keys, RLS policies, behavior, or query plans. We accept this.

**Both envs are now safe to drive via `supabase db push` from `main`.**

## Object counts (all three states agree)

```
tables: 40
functions: 7
triggers: 2
views: 2
indexes: 127
```

## What it took

### Phase 1 — Build the truth (`scripts/archaeology/dig.sh`)

Spin a transient `pg_ctl` Postgres on host (port 54399), stub out Supabase-only objects (`auth.uid()`, `pg_net`, `pg_graphql`, `supabase_vault`, `extensions`, `graphql`, `vault`, `supabase_realtime` publication, `authenticated`/`anon`/`service_role`/`supabase_auth_admin` roles), apply every `supabase/migrations/*.sql` in order, dump the result. That dump _is_ the canonical schema.

Three-way diff against live `qubits` and `prod` dumps located the drift.

### Phase 2 — Diagnose the drift

A throw-away `diagnose-null-orgs-deep.sh` script (preserved in git history if needed) cataloged the actual gap. Found:
- 26 abandoned NULL-org projects (all empty: 0 commits / 0 audit logs — leftovers from pre-org-required era)
- 11 orphan tools (all tied to those abandoned projects)
- 1 system `etl_rule` (`global_default_etl_rule`) that legitimately needs `org_id` nullable
- 4 stale constraint names (`agent_tool_*`, `connections_*`) from rename in [`20251202000000_rename_to_unified_access.sql`](../../supabase/migrations/20251202000000_rename_to_unified_access.sql) that didn't propagate
- 10 missing FK constraints (manually deleted in prod over the months)
- `syncs_user_id_fkey` on `prod` had been hand-changed `CASCADE` → `SET NULL` via SQL Editor

### Phase 3 — One-shot reconciliation

Two new migrations land the fix:

- **[`20260418040000_align_legacy_drift.sql`](../../supabase/migrations/20260418040000_align_legacy_drift.sql)** — the bulk of the cleanup
  - `DELETE` 26 abandoned NULL-org projects (cascades cleaned 11 orphan tools, ~10 access_points)
  - `DROP NOT NULL` on 4 spurious `created_by` columns
  - `SET NOT NULL` on `projects.org_id` and `tools.org_id`
  - `DROP NOT NULL` on `etl_rules.org_id` (system default needs it)
  - `RENAME` 3 stale `connections_*` → `syncs_*` constraints
  - `ADD` 10 missing FKs with per-FK orphan cleanup (cleared 73 + 61 + 15 orphan agent_id rows in `access_logs`, `agent_logs`, `chat_sessions`)

- **[`20260418050000_soften_access_points_user_fk.sql`](../../supabase/migrations/20260418050000_soften_access_points_user_fk.sql)** — codifies the `CASCADE` → `SET NULL` decision
  - Drops `syncs_user_id_fkey` and re-adds with `ON DELETE SET NULL`
  - Rationale: multi-tenant safety. Deleting a user account should not cascade-delete every agent / MCP / sync the org owns.
  - Production was already `SET NULL` (from the SQL Editor change), so this was a no-op there. Qubits gets the real change.

Both migrations are idempotent (`IF EXISTS` / `IF NOT EXISTS` guards) and atomic (`BEGIN…COMMIT`), and end with `RAISE EXCEPTION` self-checks that abort the txn if the post-state is wrong.

### Phase 4 — Test before deploy

- **[`scripts/archaeology/test-align-migration.sh`](../../scripts/archaeology/test-align-migration.sh)** — three local scenarios:
  1. Fresh DB + all 23 migrations → passes
  2. Fresh DB + 21 migrations + injected drift + alignment + soften FK → passes
  3. Re-apply both alignment + soften FK on already-aligned DB → passes (idempotent)

### Phase 5 — Apply to live envs

Two throw-away orchestrator scripts (`apply-alignment.sh` and `apply-soften-fk.sh`, preserved in git history) ran the migrations against `qubits` then `prod` with pre/post drift snapshots and a confirmation prompt. Both finished in seconds. Final `dig.sh` run confirmed convergence.

Going forward, this is the job of CI — see `.github/workflows/migrate-staging.yml` and `migrate-production.yml`. The hand-rolled apply scripts existed only because we needed to bootstrap the alignment before CI was trustworthy.

## Net schema delta on prod (real, functional changes)

```
26 NULL-org projects                   → DELETED  (verified empty: 0 commits, 0 audit logs)
11 NULL-org tools                      → CASCADE-DELETED with their projects
73 orphan access_logs.agent_id rows    → SET NULL
61 orphan agent_logs.agent_id rows     → SET NULL
15 orphan chat_sessions.agent_id rows  → SET NULL
4 spurious NOT NULL on *.created_by    → DROPPED
2 NULLable org_id on projects/tools    → SET NOT NULL
1 NOT NULL on etl_rules.org_id         → DROPPED  (system default needs NULL)
3 stale constraint names               → RENAMED  (connections_* → syncs_*)
10 missing FKs                         → ADDED    (with per-FK orphan cleanup first)
1 ON DELETE rule on syncs_user_id_fkey → unchanged on prod (was already SET NULL)
```

## What's next

Now that all three states are aligned, we can proceed to **Phase 4 of the original plan: enable Supabase Branching**. The `qubits` branch will become a proper preview branch driven by GitHub Actions on push to `main`, and prod will follow on tag/release. The original P0 trigger (signup 500 from `handle_new_user`) was fixed long ago in [`20260416000000_fix_handle_new_user_trigger.sql`](../../supabase/migrations/20260416000000_fix_handle_new_user_trigger.sql); this archaeology effort exists so future triggers like that don't ever get a chance to silently rot the schema again.
