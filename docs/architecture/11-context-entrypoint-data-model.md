# Context Entry Point Data Model

This is the target data model for the four ways context enters, changes, or is
exposed from a PuppyOne workspace:

- Upload: local bytes enter once.
- Import: an external snapshot enters once.
- Connect: a durable external relationship is created.
- Access: a scoped workspace surface is exposed to a person, tool, or runtime.

The additive target migration is:

```text
supabase/migrations/20260602010000_context_entrypoint_target_tables.sql
```

It does not drop legacy tables. Runtime code should migrate onto these tables
in stages while old rows remain readable.

## Final Tables

| Product concept | Table | Purpose |
| --- | --- | --- |
| Upload | `upload_jobs` | One local upload task and its lifecycle |
| Upload | `upload_items` | Per-file state for an upload task |
| Import | `import_jobs` | Existing canonical one-shot external import task |
| Connect | `connections` | Durable external relationship and sync configuration |
| Connect | `sync_runs` | One execution of a connection |
| Access | `access_surfaces` | Scope-bound workspace entry points |
| Activity | `context_activity_items` | Read-only aggregation of upload, import, and sync history |

## Upload

`upload_jobs` replaces the overloaded use of the legacy `uploads` table for
local file and folder ingestion.

Required properties:

- `project_id`, `created_by`, and `target_path` identify the destination.
- `source_kind` is `browser`, `desktop`, or `cli`.
- `mode` is `raw`, `ocr_parse`, or `structured`.
- `status`, `phase`, `progress`, `message`, and `error_message` are owned by
  the upload pipeline.
- `result_commit_id` records the Version Engine write that finalized the job.

`upload_items` holds per-file upload and processing state. This keeps upload
policy decisions, skipped files, object-storage staging, and ETL failures out of
the higher-level job row.

Upload jobs have no provider, no OAuth binding, no schedule, and no durable
external relationship.

## Import

`import_jobs` remains the canonical table for one-shot external snapshots.

The target migration adds:

- `source_kind`: repository, URL, website, template, document, or other.
- `source_ref`: structured provider-specific source identity.
- `idempotency_key`: optional key for preventing duplicate user-triggered
  imports.

Import jobs own task lifecycle. Providers only supply capabilities such as
parse, fetch, list, verify, or push. A provider must not create job rows or mark
task status directly.

## Connect

`connections` is the final table for durable external relationships.

A connection stores:

- Provider and external resource identity.
- Optional OAuth or credential reference.
- Direction: inbound, outbound, or bidirectional.
- Trigger type and trigger config.
- Cursor, watermark, remote hash, external version, and last sync result.
- Lifecycle status: active, paused, syncing, error, or disabled.

A connection is configuration plus durable state. It is not a run and it is not
an import.

`sync_runs` is the final table for connection executions. Each row records:

- The connection and project.
- Trigger source: manual, scheduled, webhook, realtime, initial, or push.
- Optional user who triggered the run.
- Direction, status, phase, progress, and worker job id.
- Result path, Version Engine commit id, and changed-file summary.

The legacy `connector_runs` table is migration input for historical run
backfill. Runtime durable source synchronization uses `connections` and
`sync_runs`.

## Access

`access_surfaces` is the final table for workspace entry points.

Access surfaces are scope-bound and permissioned. They include:

- `git_remote`
- `cli`
- `filesystem`
- `agent`
- `mcp`
- `sandbox`

Access is about how a person, tool, or runtime can operate on workspace context.
It is not an external-source import mechanism.

The target migration backfills `access_surfaces` from existing `repo_scopes` and
built-in legacy connector rows. Runtime code reads `access_surfaces`; legacy
rows are migration input and compatibility-facade history, not the target
runtime model.

Built-in access surfaces that should be unique per scope are constrained by a
partial unique index for `git_remote`, `cli`, and `filesystem`. Agent, MCP, and
sandbox surfaces may have more than one instance per scope when the product
requires it.

## Activity View

`context_activity_items` is a read-only aggregation view for the frontend. It
normalizes upload jobs, import jobs, and sync runs into a shared activity shape:

```text
id
kind: upload | import | sync_run
project_id
created_by
label
status
phase
progress
message
error_message
result_path
result_commit_id
created_at
completed_at
```

The view is an activity surface only. It must not become a write model or force
Upload, Import, and SyncRun into one lifecycle.

## Migration Rules

1. Do not create new `import_once` sync bindings.
2. One-shot external sources create `import_jobs`.
3. Local files and folders create `upload_jobs` and `upload_items`.
4. Durable external source relationships create `connections`.
5. Every connection execution creates a `sync_runs` row.
6. Access surfaces create `access_surfaces`, not import jobs.
7. Long-running upload, import, and sync work must run through worker queues.
8. All final content writes must go through the Version Engine.
