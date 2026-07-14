# ISSUE-039 Repository Target Cutover Runbook

Status: implementation-complete runbook; environment execution evidence is
recorded per deployment. Architecture is defined in
[Project-Owned Repository Targets](../architecture/15-project-owned-repository-targets.md).

## Release artifacts

```text
Data preflight
  20260715_project_owned_repository_targets_preflight

Contract migration
  supabase/migrations/
  20260715000000_project_owned_repository_targets_contract_cutover.sql

Upgrade harness
  scripts/test-repository-target-migration.sh
```

The Contract header pins the data artifact checksum. Do not edit a promoted
artifact or migration. A change requires a new timestamped artifact/migration.

## Preconditions

- Exact application and migration source SHA is approved.
- CI fresh reset, previous-schema upgrade, pgTAP, backend, Web, and Desktop
  suites are green for that SHA.
- `puppyone-db lint` and immutable migration policy are green.
- Staging has demonstrated the same preflight checksum and Contract SHA.
- A database restore point has been created and its identifier recorded.
- Scope, Access Surface, credential, and Workspace Binding mutations can be
  paused for the cutover window.
- Legacy Project-root rows in the Scope-only sandbox/sync tables have been
  counted and their lifecycle disposition recorded. Sandbox sessions and sync
  events are transient; the database restore point is the rollback source of truth for
  retired root-only settings.
- Previous application images remain available, but are not deployed alone
  after Contract.

## Plan and preflight

From `backend/` against the target environment:

```bash
DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db plan \
  20260715_project_owned_repository_targets_preflight

DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db run \
  20260715_project_owned_repository_targets_preflight

DATA_MIGRATION_DATABASE_URL='postgresql://...' \
  uv run puppyone-db verify \
  20260715_project_owned_repository_targets_preflight
```

The preflight is read-only apart from its success receipt. It must reject:

- missing or multiple legacy roots per Project;
- noncanonical root or Scope geometry;
- invalid Surface, Binding, Integration, Sandbox, or sync targets;
- cross-tenant or cross-Project credential chains;
- duplicate target/kind Surfaces;
- missing active Project authorization capability;
- unresolved legacy Human permission rows.

Failure is a release stop. Fix data with a separately reviewed artifact; never
weaken the Contract migration.

## Cutover

1. Pause target mutations and drain writers.
2. Record UTC time, source SHA, preflight checksum, restore-point ID, and row
   counts in the deployment ticket.
3. Deploy the exact Contract migration through the protected schema workflow.
4. Deploy backend/Web/Desktop contract-v2 application artifacts for the same
   source SHA.
5. Resume mutations only after postflight passes.

The migration transaction:

- proves the matching preflight receipt on non-empty installs and rechecks the
  live postcondition before its first mutation;
- maps former root target references to `scope_id = NULL`;
- preserves true Scope, Surface, Binding, credential, and connection IDs;
- requires the earlier credential cutover to have removed every Scope
  credential column; credentials remain hash-only Access Surface children;
- retires legacy Project-root sandbox/sync rows from Scope-only tables;
- deletes synthetic root rows;
- renames `repo_scopes` to `repository_scopes`;
- drops `is_root` and `binding_kind`;
- installs final FKs, uniqueness, checks, triggers, and RPCs;
- emits a final invariant report before commit.

## Postflight

Run the environment's schema smoke tests and verify at minimum:

```sql
-- No legacy identity schema remains.
select to_regclass('public.repo_scopes') is null;

select count(*) = 0
from information_schema.columns
where table_schema = 'public'
  and table_name = 'repository_scopes'
  and column_name in ('access_key', 'access_key_hash', 'access_key_revoked_at');

-- Every persisted Scope is a true non-empty path boundary.
select count(*) = 0
from public.repository_scopes
where path = '' or path like '/%' or path like '%/';

-- Nullable target references are either Project root or an exact Scope.
select count(*) = 0
from public.access_surfaces s
left join public.repository_scopes rs
  on rs.id = s.scope_id and rs.project_id = s.project_id
where s.scope_id is not null and rs.id is null;

select count(*) = 0
from public.project_workspace_bindings b
left join public.repository_scopes rs
  on rs.id = b.scope_id and rs.project_id = b.project_id
where b.scope_id is not null and rs.id is null;

-- The immutable receipt is present for the exact checksum.
select name, summary->>'artifact_checksum'
from public.migration_log
where name = '20260715_project_owned_repository_targets_preflight';
```

Functional smoke matrix:

| Case | Expected result |
| --- | --- |
| Project-root canonical clone/fetch/push | one Project repository; success |
| Scope canonical clone/fetch/push | exact path view; descendants excluded |
| Existing Workspace Binding credential | ID/hash continuity; request succeeds |
| Missing canonical remote | content opens with Repair action |
| Deleted Scope binding | typed `SCOPE_NOT_FOUND` |
| Local-only workspace | local-only UI; no error banner |
| Wrong contract header | HTTP 426 |
| Concurrent target enable | exactly Git + CLI, no duplicates |
| Ordinary read/list API | no credential material |

Observe 401/403/404/426/503 rates, binding repair outcomes, credential rotation,
Git push latency, CAS failures, and legacy `/git/ap` use. Logs must contain only
redacted target references and never URLs containing secrets.

## Rollback and forward-fix

Before Contract commit, aborting the transaction is sufficient.

After Contract commit, do not deploy the old application against the new
schema. Choose one of:

1. restore the recorded database restore point and deploy the exact previous
   application image as one coordinated operation; or
2. deploy a reviewed forward-fix migration and matching application from a new
   source SHA.

Credential compromise is handled by rotation/revocation, not database schema
rollback. If restored data predates credential mutations made after the restore
point, revoke/rotate those credentials before reopening traffic.

## Evidence record

Fill this per environment; absence means `NOT_VERIFIED`, never implied success.

```text
Environment:
Source SHA:
Preflight artifact checksum:
Preflight receipt verified at:
Restore point ID:
Contract workflow/run:
Backend/Web/Desktop artifact versions:
Postflight SQL result:
Functional smoke result:
Restore or forward-fix drill result:
Operator:
Reviewer:
```

Local implementation status on 2026-07-15: PostgreSQL/Docker execution evidence
is `NOT_VERIFIED` when the local Docker engine is unavailable. CI owns the
ephemeral previous-schema upgrade and dirty-data blocking run; Staging and
Production evidence must still be attached before promotion.
