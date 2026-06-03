# Change: Refactor Context Entry Points

## Why

PuppyOne currently overloads "connect", "connector", "access", "import", and
"sync" across product flows and backend tables. This causes one-shot GitHub
imports, durable source sync, local uploads, and workspace access surfaces to
share names and execution paths even though they have different lifecycle
guarantees.

## What Changes

- Define four product and backend concepts: Upload, Import, Connect, and Access.
- Keep `import_jobs` as the canonical one-shot external snapshot model.
- Add target tables for `upload_jobs`, `upload_items`, `connections`,
  `sync_runs`, and `access_surfaces`.
- Add `context_activity_items` as a read-only aggregation view for upload,
  import, and sync activity.
- Move long-running upload, import, and sync work onto separate worker queues.
- Stop creating new `import_once` connector or sync bindings for one-shot
  imports.
- Keep legacy tables readable while code migrates in stages.

## Impact

- Affected specs: `context-entrypoints`
- Affected docs:
  - `docs/architecture/10-context-entrypoints.md`
  - `docs/architecture/11-context-entrypoint-data-model.md`
- Affected migrations:
  - `supabase/migrations/20260602010000_context_entrypoint_target_tables.sql`
- Affected backend areas:
  - import jobs
  - upload / ETL pipeline
  - connector service
  - GitHub integration webhook path
  - worker queue configuration
- Affected frontend areas:
  - Add content menu
  - Import status UI
  - Connect source UI
  - Access workspace UI
  - Activity history
