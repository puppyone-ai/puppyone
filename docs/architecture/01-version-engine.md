# PuppyOne Version Engine

PuppyOne is now Git-native at the version layer. Product features such as
scope boundaries, optimistic merge, hosted conflict review, audit, projection,
and outbox repair live above Git in the Version Engine. The server does not
maintain a second version-control protocol.

## Architecture

```text
                         Product Write Surfaces
                         ======================

  Web editor / uploads      Puppyone CLI FS        Git smart HTTP
  sync connectors           agent/sandbox writes   clone/fetch/push
        |                         |                     |
        v                         v                     v
  +------------------+     +------------------+   +-------------------+
  | Content routers  |     | ProductOperation |   | Git transport     |
  | ingest/finalize  | --> | Adapter          |   | upload/receive    |
  | connector jobs   |     |                  |   | pack + quarantine |
  +---------+--------+     +---------+--------+   +---------+---------+
            |                        |                      |
            | OperationWriteIntent   | OperationWriteIntent | VersionSubmissionIntent
            +------------------------+----------------------+
                                     |
                                     v
  +------------------------------------------------------------------+
  | Version Engine: application/transaction_engine.py                 |
  |                                                                  |
  | - validates actor, access point, scope, excludes, and base state  |
  | - applies product splices or accepted Git trees                   |
  | - retries with per-scope SQL CAS                                  |
  | - runs merge policy: auto merge, LWW, manual review, reject       |
  | - creates canonical Git commit/tree/blob facts                    |
  | - atomically publishes refs, history, audit, transaction, outbox  |
  +-------------------------------+----------------------------------+
                                  |
              +-------------------+-------------------+
              |                                       |
              v                                       v
  +---------------------------+       +-------------------------------+
  | Git object storage        |       | Supabase control plane        |
  |                           |       |                               |
  | version/<project>/objects |       | repo_scopes                   |
  | version/<project>/bundles |       | projects root column          |
  | blob/tree/commit bytes    |       | scope-state and commit rows   |
  | object-location index     |       | conflicts, transactions       |
  | transport cache           |       | audit logs, durable outbox    |
  +-------------+-------------+       +---------------+---------------+
                |                                     |
                v                                     v
  +---------------------------------------------------------------+
  | Read / derived consumers                                      |
  |                                                               |
  | Web tree/history/diff, Git clone/fetch, search indexing,      |
  | notifications, conflict dashboard, object GC, sync exports.   |
  +---------------------------------------------------------------+
```

## Canonical Layered Flow Map

This is the best-practice routing map. Protocol surfaces stay separate, while
command construction, transaction semantics, object storage, audit, conflict,
and derived views converge below the protocol boundary.

```text
Legend:
  [P] Product root write/read        [A] Access Point scoped write/read
  [G] Git-native transport          [B] Batch/internal tool write
  ---> synchronous request path      - - > async derived path

                                      L0 Client / Caller
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
       | [P] Frontend Data  |     | [A] Puppyone CLI   |     | [G] Git CLI/native |     | [B] Ingest/MCP/    |
       | Page / Product UI  |     | fs write/rm/mv     |     | clone/fetch/push   |     | Sync jobs/tools    |
       +---------+----------+     +---------+----------+     +---------+----------+     +---------+----------+
                 |                          |                          |                          |
                 v                          v                          v                          v

                                    L1 Protocol Entry
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
       | /api/v1/content    |     | /api/v1/ap-fs      |     | /git/*.git         |     | internal router /  |
       | content routers    |     | AP-FS router       |     | Smart HTTP         |     | ingest workers     |
       +---------+----------+     +---------+----------+     +---------+----------+     +---------+----------+
                 |                          |                          |                          |
                 v                          v                          v                          v

                              L2 Admission / Target Resolution
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
       | ProjectWriteState  |     | AccessPoint auth   |     | Git remote facade  |     | service actor +    |
       | role/can_write     |     | scope/excludes     |     | read_only/ref rule |     | project/scope      |
       | root hash/head     |     | writable check     |     | scope/excludes     |     | batch policy       |
       +---------+----------+     +---------+----------+     +---------+----------+     +---------+----------+
                 |                          |                          |                          |
                 v                          v                          v                          v

                             L3 VersionWriteCommandService
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
       | Product command    |     | AP scoped command  |     | Git pack command   |     | Bulk/import        |
       | normalize/validate |     | rel path/excludes  |     | quarantine pack    |     | BlobRef/staged S3  |
       | target=root        |     | target=AP scope    |     | proposed tree      |     | target=root/scope  |
       +---------+----------+     +---------+----------+     +---------+----------+     +---------+----------+
                 |                          |                          |                          |
                 |                          |                          |                          |
                 +------------+-------------+                          +------------+-------------+
                              |                                                     |
                              v                                                     v

                         L4 Product Operation Adapter                     L4 Git Submission Adapter
                    +----------------------------------+             +----------------------------------+
                    | ProductOperationAdapter          |             | receive-pack / submission        |
                    | OperationWriteIntent + splice_fn |             | VersionSubmissionIntent          |
                    | write/mkdir/mv/rm/bulk_write     |             | promote quarantined objects      |
                    +----------------+-----------------+             +----------------+-----------------+
                                     |                                                |
                                     +----------------------+-------------------------+
                                                            |
                                                            v

                                             L5 Transaction Engine
                    +--------------------------------------------------------------------------+
                    | GitNativeTransactionEngine                                               |
                    |                                                                          |
                    | [P] apply_project_operation(): root CAS, one product commit/history/audit|
                    | [A/B] apply_operation(): per-scope CAS, CAS retry merge, pending conflict|
                    | [G] submit_version(): validate proposed tree, changed paths, quarantine  |
                    | [UI] resolve(): accept/reject pending conflict through the same pipeline  |
                    +-------------+------------------------------+-----------------------------+
                                  |                              |
                                  | writes immutable Git objects |
                                  v                              |

                                             L7 Git Object Store
                    +--------------------------------------------------------------------------+
                    | blob/tree/commit ids, stage_object_writes(), object bundle .pob          |
                    | object_locations index, pack-location-first reads                        |
                    +-------------+------------------------------------------------------------+
                                  |
                                  | after required objects exist
                                  v

                                             L6 Publish Boundary
                    +----------------------------------+     +----------------------------------+
                    | [P] publish_project_update()     |     | [A/G/B] publish_scope_update()   |
                    | project root CAS                 |     | scope head CAS                   |
                    | root history/audit               |     | scope history/audit              |
                    +----------------+-----------------+     +----------------+-----------------+
                                     |                                      |
                                     +------------------+-------------------+
                                                        |
                                                        v

                                         L8 Async Derived Work / Repair
                    +--------------------------------------------------------------------------+
                    | hooks, durable outbox, scope->root projection, root->AP derived refs      |
                    | path/search indexes, websocket/read-model refresh                         |
                    +-------------+------------------------------+-----------------------------+
                                  |                              |
                                  | committed/derived views      | conflict created / resolved
                                  v                              v

                                                    L9 Read Surfaces
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
       | /content tree, cat |     | /ap-fs ls/tree/raw |     | git upload-pack    |     | search/index/export|
       | history, diff      |     | scoped FS views    |     | fetch/clone views  |     | notifications/ws   |
       | conflict UI        |<----| pending conflict   |<----| push pending IDs   |<----| outbox consumers   |
       +--------------------+     +--------------------+     +--------------------+     +--------------------+
```

Correctness boundaries:

- L1-L2 are intentionally protocol-specific. Do not route the Product UI
  through AP-FS just to share an endpoint; Product root writes and Access Point
  scope writes have different credentials, audit identity, and publish
  semantics.
- L3 stays thin and contains only command normalization. Shared
  path/content/message/audit construction lives in `VersionWriteCommandService`,
  not in four separate routers.
- L4-L8 are the convergence zone. No route, connector, CLI handler, Git adapter,
  worker, or MCP tool may publish refs, history, audit, conflicts, object
  locations, or outbox rows outside the Version Engine pipeline.
- L8-L9 are derived/read surfaces. They may lag briefly, but they must be
  repairable from committed version facts.

## Rules

1. Git owns version facts: objects, trees, commits, refs, clone/fetch/push.
2. PuppyOne owns collaboration policy: scopes, auth, conflict handling, audit,
   projections, and server-side transaction semantics.
3. Frontend and Product API writes always target the root product scope unless
   an explicit access point or connector scope is being used.
4. Git transport caches are protocol caches only. They are not authority.
5. Search and indexing consume committed events and views; they never decide
   merge/conflict behavior.
6. Runtime code must not import the old external version package or public old
   wire protocol. Git helpers are PuppyOne-owned.

## Folder Layout

```text
backend/src/version_engine/
  adapters/
    git/                         # Git smart-HTTP protocol boundary
      auth.py
      object_quarantine.py
      protocol.py
      receive_pack.py
      router.py
      submission.py
      upload_pack.py
      view_projection.py
    operations/
      product_operation_adapter.py

  application/
    transaction_engine.py         # write authority
    conflict_policy.py
    diff.py
    errors.py
    git_commit.py
    git_object_format.py
    hash_utils.py
    merge.py
    object_store.py
    parent_scope_promote.py
    path_utils.py
    repo_facade.py
    root_projection.py
    scope.py
    tree.py
    tree_objects.py

  domain/
    conflicts.py
    intents.py

  routers/
    access_point.py               # access-key resolution
    access_point_fs.py            # Puppyone CLI scoped FS API
    audit_router.py
    conflict_router.py
    content_history.py
    content_read.py
    content_router.py
    content_write.py
    shadow_snapshot_router.py
    ws_router.py

  server/
    admin.py
    audit_repository.py
    auth.py
    db_names.py                   # isolated persisted DB names
    notifications.py
    repo_manager.py
    scope_manager.py
    server_repo.py
    validation.py
    backends/
      s3_storage.py
      supabase_audit.py
      supabase_history.py
      supabase_scope.py

  services/
    fs_path_index.py
    hooks.py
    in_process_client.py
    object_gc.py
    object_gc_worker.py
    tree_reader.py
    tree_splice.py
    version_outbox.py
    version_trace.py
```

## Persistent DB Names

Database renames are intentionally deferred. Runtime code may reference these
names only through `server/db_names.py`:

```text
mut_commits
mut_scope_state
mut_version_index
mut_version_outbox
mut_object_locations
mut_conflicts
projects.mut_root_hash
github_sync_log.mut_commit_id
publish_mut_scope_update
publish_mut_project_update
get_mut_project_write_state
claim/complete/fail_mut_version_outbox
```

These names are storage compatibility, not architecture. Product code,
frontend code, CLI code, logs, and API metadata should use Version Engine,
Git Remote, Puppyone CLI, scope, conflict, and audit language.

## Hot Path

```text
Frontend Save
  -> content_write router
  -> ProductOperationAdapter
  -> ProjectWriteState RPC
  -> stage Git objects as one batch/bundle
  -> GitNativeTransactionEngine
  -> publish project update RPC
  -> schedule hooks/outbox
  -> return to user
```

The request path must not:

- clone or materialize a full transport repo;
- walk deep parent history;
- download unchanged blobs;
- run search indexing synchronously;
- silently fall back to scattered DB writes when required RPCs are missing.

## Deployment Cutover

The runtime has no fallback to the old object namespace or removed publish
paths. Before deploying this branch to an environment that already has data:

1. Apply the Supabase SQL migrations in `supabase/migrations/`.
2. Copy or migrate existing object keys into `version/<project>/...`.
3. Confirm `server/db_names.py` is the only runtime boundary that mentions the
   deferred physical DB names.
4. Run the Version Engine E2E suite against the target branch.

## Conflict Path

```text
CAS lost or unsafe merge
  -> three-way policy over base/current/incoming trees
  -> auto merge, LWW with audit, manual-review pending row, or reject
  -> pending rows are exposed through conflict_router
  -> resolver accept/reject re-enters GitNativeTransactionEngine
```

Pending conflict rows do not advance refs. They pin enough object ids and
metadata for a human or hosted resolver to make a later transaction.

## Access Point Model

Each access point behaves externally like a repo endpoint, but internally it is
a scoped facade over the shared project object store:

```text
repo_scopes row
  -> RepoFacade(project_id, repo_id, scope_path, excludes, mode, ref)
  -> Git transport / CLI FS scoped view
  -> Version Engine transaction
  -> shared project object store + scope-state refs
```

This keeps the GitHub-like external product model without creating one physical
Git repository per scope.
