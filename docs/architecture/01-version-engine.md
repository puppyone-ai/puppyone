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
  | Version Engine: write_engine/engine.py                             |
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

This is the current routing map. Protocol surfaces stay separate, while command
construction, transaction semantics, object storage, audit, conflict, and
derived views converge below the protocol boundary.

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

                           L2 Auth / Identity Resolution
       +--------------------+--------------------+--------------------+--------------------+
       | Product user auth  | AP/CLI key auth    | Git credential     | Connector/job auth |
       | JWT/session        | scope access key   | Basic/Bearer/key   | MCP/service key    |
       | membership         | revoke check       | user/scope binding | connector binding  |
       +--------------------+--------------------+--------------------+--------------------+
       | Output: AuthContext = actor + credential + project/scope/connector binding        |
       +-----------------------------------------------------------------------------------+
                                               |
                                               v

                              L3 Permission
       +--------------------+--------------------+--------------------+--------------------+
       | Product root       | AP/CLI scope       | Git remote scope   | Connector/job      |
       | role/can_write     | mode/excludes      | mode/excludes/ref  | target scope       |
       | root hash/head     | connector status   | fetch/push allowed | batch policy       |
       +--------------------+--------------------+--------------------+--------------------+
       | Output: TargetAdmission = AuthContext + allowed target/actions/snapshot           |
       +-----------------------------------------------------------------------------------+
                            |                                         |
                            v                                         v

                                        L4 Intent Adapters
       +-----------------------------------------+-----------------------------------------+
       | Product / AP / batch adapter            | Git submission adapter                  |
       | from Product root + AP/CLI scope        | from Git remote + connector/job         |
       | VersionWriteCommandService helper       | receive-pack + quarantine               |
       | op command + TreePatch/splice_fn        | proposed tree + submission intent       |
       +-----------------------------------------+-----------------------------------------+
                            |                                         |
                            +--------------------+--------------------+
                                                 |
                                                 v

                                          L5 Write Engine
       +-----------------------------------------------------------------------------------+
       | Goal: land one admitted write as durable Git-native version facts.                |
       |                                                                                   |
       | Inputs from L4:                                                                   |
       |   Product/AP/batch -> OperationWriteIntent + TreePatch/splice_fn                  |
       |   Git push         -> VersionSubmissionIntent + proposed Git tree                 |
       |                                                                                   |
       | Main path:                                                                        |
       |   Read current head/root                                                          |
       |     -> Build candidate version                                                    |
       |     -> Store immutable blob/tree/commit objects                                   |
       |     -> Try conditional publish                                                    |
       |                                                                                   |
       | Conditional publish result:                                                       |
       |   accepted:                                                                       |
       |     write history/audit/ledger/outbox; return status=ok                           |
       |   rejected because head/root moved:                                               |
       |     read latest; resolve conflicts; loop to Main path                             |
       |   conflicts cannot be resolved synchronously:                                     |
       |     write pending conflict; return status=pending                                 |
       |   rejected because caller supplied stale expected head:                           |
       |     return status=conflict/409                                                    |
       |   rejected after retry budget is exhausted:                                       |
       |     fail loud                                                                     |
       | Conflict facts are created here, before any derived UI/index work.                |
       |                                                                                   |
       | Object store and publish gate are write-engine internals on this path.            |
       | Transport cache is protocol cache only, not source of truth.                      |
       +-----------------------------------------------------------------------------------+
                                                 |
                                                 | published facts drive derived work
                                                 v

                                  L6 Async Derived Work / Repair
       +-----------------------------------------------------------------------------------+
       | hooks, durable outbox, scope->root projection, root->AP derived refs              |
       | path/search indexes, search event dispatch, websocket/read-model refresh          |
       | object GC and committed-version repair                                            |
       +-----------------------------------------------------------------------------------+
```

Updates from the previous diagram:

- There is no standalone "normalization layer." Request cleanup and protocol
  parsing live inside L4 intent adapters. L3 already decided the target and
  permission; L4 must not re-decide root vs scope, excludes, writable mode, or
  ref policy.
- Git-native transport no longer appears under `VersionWriteCommandService`.
  Product, AP-FS, and batch file writes may use that command helper inside the
  Product/AP/batch adapter. Git push has its own adapter path: receive-pack,
  quarantine, proposed tree, and changed-path extraction.
- Git object writes and conditional publish are shown inside L5 because they
  are part of the write loop. There is no separate downstream publish stage
  that can "return" to the engine; a moved head/root loops back to the Main
  path with the latest state, while unresolved conflicts return `pending`.
- Conflicts belong to L5. The Write Engine compares base/current/incoming
  trees, reaches a `resolve conflicts` checkpoint, and either produces a new
  candidate tree or writes a pending-conflict fact. L6 only surfaces, notifies,
  indexes, and repairs those committed facts.
- L2 is one auth/identity layer with four adjacent resolver partitions. Protocol
  adapters still extract different credential shapes, but all of them resolve
  to the same `AuthContext` contract.
- L3 is the permission layer. Product root, AP/CLI scope, Git remote, and
  connector/job targets apply their own permission checks while sharing the
  same permission vocabulary: target scope, mode, excludes, allowed actions,
  connector status, and audit identity.
- "AP scope auth" means the product concept, not the removed historical
  table model. The canonical runtime model is `repo_scopes + connectors`.
- Write side effects are behind `VersionTransactionLedger`. The
  Write Engine decides the lifecycle facts; Supabase persistence lives in
  `version_engine/infrastructure/supabase/transaction_ledger.py`.
- `VersionEngineContainer` is the app/worker bootstrap boundary. Routers depend
  on FastAPI-provided services; workers build an explicit container at
  bootstrap instead of importing hidden singletons.
- L6 is strictly derived work. Search events, path indexes, websocket refresh,
  object GC, and repair run from committed facts and must not publish refs.

Correctness boundaries:

- L1 is intentionally protocol-specific. Do not route the Product UI through
  AP-FS just to share an endpoint; Product root writes, scope access keys, Git
  credentials, MCP keys, and service actors have different request shapes.
- L2 is the single auth/identity decision point. A valid credential gives an actor
  and binding, not write permission.
- L3 is the permission decision point. The authenticated actor must fit inside
  a root/scope target with mode, excludes, connector status, ref policy, and
  audit policy applied.
- L4 is the intent-adapter layer. It converts an already-admitted request into
  `OperationWriteIntent + splice_fn` or `VersionSubmissionIntent`. Syntactic
  cleanup, content serialization, default messages, and Git pack parsing are
  adapter-local implementation details, not a separate architecture layer.
- L5 is the write convergence zone. No route, connector, CLI handler, Git adapter,
  worker, or MCP tool may publish refs, history, audit, conflicts, object
  locations, or outbox rows outside the Write Engine.
- Conflict decisions must be made in L5. Read surfaces may display conflicts,
  and async jobs may notify or repair conflict views, but they must not decide
  merge policy or advance refs.
- The `resolve conflicts` checkpoint may use policy-driven last-write-wins,
  agent-assisted merge, or manual human resolution. The architecture diagram
  intentionally treats these as strategies behind one checkpoint.
- L6 is the final write-system follow-up layer. It may lag briefly, but every
  derived view must be repairable from committed version facts. Read APIs and
  frontend screens are consumers outside the write pipeline.

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
  bootstrap/
    container.py                  # app/worker scoped service graph
    dependencies.py               # FastAPI dependency boundary

  domain/
    conflicts.py                  # conflict data contracts
    errors.py                     # domain/application error types
    intents.py                    # write/submission/resolution intents

  admission/
    identity.py                   # L2 JWT/access-key/service identity
    channel_pause.py              # channel-level pause gate
    permission.py                 # L3 root/scope/ref/action permission
    repo_facade.py                # repo-shaped target facts
    target.py                     # TargetAdmission contract
    validation.py                 # path/content/limit validators

  entrypoints/
    http/
      access_point.py             # access-key resolution route
      access_point_fs.py          # Puppyone CLI scoped FS API
      audit.py
      conflict.py
      content.py                  # frontend content router composition
      content_history.py
      content_read.py
      content_write.py
      download_token.py
      schemas.py
      shadow_snapshot.py
      websocket.py
    git/
      auth.py                     # Git credential extraction
      router.py                   # Git smart-HTTP route shell

  adapters/
    product/
      commands.py                 # Product/AP/batch write command helper
      operation_adapter.py        # typed tree-operation adapter
      tree_patch.py               # splice helpers for tree mutations
    git/
      object_quarantine.py
      protocol.py
      receive_pack.py
      submission.py
      upload_pack.py
      view_projection.py
    batch/
      in_process_client.py

  write_engine/
    engine.py                     # L5 write authority
    conflict_policy.py
    diff.py
    git_commit.py
    git_object_format.py
    hash_utils.py
    ledger.py                     # persistence contract
    merge.py
    object_store.py
    path_utils.py
    scope.py
    trace.py
    tree.py
    tree_objects.py

  derived/
    hooks.py
    notifications.py
    object_gc.py
    object_gc_worker.py
    outbox.py
    parent_scope_promote.py
    path_index.py
    projection.py

  read/
    admin.py
    history_changes.py
    text_detection.py
    tree_reader.py

  infrastructure/
    s3/
      object_storage.py
    supabase/
      __init__.py                 # safe_data helper
      audit_backend.py
      audit_repository.py
      db_names.py                 # isolated persisted DB names
      history_repository.py
      repo_manager.py
      scope_manager.py
      scope_repository.py
      server_repo.py
      transaction_ledger.py       # Supabase implementation of ledger.py
```

## Persistent DB Names

Database renames are intentionally deferred. Runtime code may reference these
names only through `infrastructure/supabase/db_names.py`:

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
  -> ProjectWriteState RPC
  -> VersionWriteCommandService
  -> ProductOperationAdapter
  -> stage Git objects as one batch/bundle
  -> Write Engine (VersionWriteEngine implementation)
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
3. Confirm `infrastructure/supabase/db_names.py` is the only runtime boundary
   that mentions the deferred physical DB names.
4. Run the Version Engine E2E suite against the target branch.

## Conflict Path

```text
CAS lost or unsafe merge
  -> three-way policy over base/current/incoming trees
  -> auto merge, LWW with audit, manual-review pending row, or reject
  -> pending rows are exposed through conflict_router
  -> resolver accept/reject re-enters the Write Engine
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
