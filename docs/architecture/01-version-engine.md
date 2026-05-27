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
  | - applies product splices or accepted Git trees to root           |
  | - retries with root CAS and path-conflict checks                  |
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
  | version/<project>/bundles |       | canonical projects root column|
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
construction, transaction semantics, audit, conflict, write-system follow-up, and
physical object storage converge below the protocol boundary.

## Source Of Truth

The Version Engine's long-term invariant is root-first:

```text
Project canonical root = the single source of truth.
Scopes = path-bounded access wrappers over that root.
Scope-state rows = derived/cache/compatibility state, never authority.
```

Concretely, the project root hash column (`projects.mut_root_hash`, later
`projects.version_root_hash`) is the canonical tree for the project. Product
writes, Access Point writes, Git pushes, CLI FS writes, and connector writes all
land by applying a path-scoped patch to that root and conditionally publishing a
new root. `repo_scopes` defines who can touch which path; it does not define a
separate project truth.

This is the same architectural shape as Git-backed systems: one repository view
has one current root tree, while permissions, remotes, branch views, search
indexes, and UI caches are wrappers or derived views around that root. A derived
view may lag or be rebuilt, but it must never make the project appear empty or
replace the canonical root as truth.

### Legacy Scope-State Compatibility

Existing deployments still contain `mut_scope_state` and older scoped heads. That
state is compatibility data during migration and may be used to rebuild or repair
the canonical root for legacy projects, but new root-first writes must not treat
per-scope heads as independent sources of truth.

Allowed uses for scope-state after the root-first cutover:

- fast lookup of the subtree hash under a scope path;
- compatibility reads for old projects until they are migrated;
- read-repair input when a legacy projection is missing or damaged;
- migration tooling that folds historical scope heads into one canonical root.

Forbidden uses:

- deciding that the project is empty because a derived/root projection is empty;
- publishing one scope head as authoritative without updating the canonical
  project root;
- letting a scope cache override a newer project root;
- treating multiple scope heads as the steady-state data model for new projects.

```text
Legend:
  [P] Product root write/read        [A] Access Point scoped write/read
  [G] Git-native transport          [B] Batch/internal tool write
  ---> synchronous request path      - - > post-commit follow-up

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
       | canonical root     | connector status   | fetch/push allowed | batch policy       |
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

                                          L5 Write System
       +------------------------------------------------------------+----------------------+
       | L5 Core Write Engine                                      | L5 Follow-up / Repair |
       |                                                            |                      |
       | Goal: land one admitted write as durable Git-native        | Consumes committed   |
       | version facts.                                             | facts from L5 Core.  |
       |                                                            |                      |
       | Inputs from L4:                                            | - hooks and durable  |
       |   Product/AP/batch -> OperationWriteIntent +               |   outbox consumers   |
       |     TreePatch/splice_fn                                    | - scope caches and   |
       |   Git push -> VersionSubmissionIntent + proposed Git tree  |   root->AP derived   |
       |                                                            |   refs/views         |
       | Main path:                                                 | - Git view cache     |
       |   Read current head/root                                   |   warming/repair     |
       |     -> Build candidate version                             | - path/search        |
       |     -> Store immutable blob/tree/commit objects            |   indexes            |
       |     -> Try conditional root publish                        | - websocket/read     |
       |                                                            |   model refresh      |
       | Conditional publish result:                                | - search event       |
       |   accepted:                                                |   dispatch           |
       |     write history/audit/ledger/outbox; return status=ok    | - object GC          |
       |   rejected because head/root moved:                        | - committed-version  |
       |     read latest; resolve conflicts; loop to Main path      |   repair             |
       |   conflicts cannot be resolved synchronously:              |                      |
       |     write pending conflict; return status=pending          | Must not publish     |
       |   rejected because caller supplied stale expected head:    | refs or decide       |
       |     return status=conflict/409                             | merge policy.        |
       |   rejected after retry budget is exhausted:                |                      |
       |     fail loud                                              |                      |
       | Conflict facts are created here, before any derived         |                      |
       | UI/index work.                                             |                      |
       |                                                            |                      |
       | Object-store calls and publish gate are write-engine        |                      |
       | internals on this path. Physical bytes live in L6.           |                      |
       | Transport cache is protocol cache only, not source of truth. |                      |
       +-----------------------------+------------------------------+----------+-----------+
                                     |                                         |
                                     | object bytes + object-location index    | may read/repair/GC
                                     +---------------------------+-------------+
                                                                 |
                                                                 v

                                  L6 Storage Substrate
       +-----------------------------------------------------------------------------------+
       | ObjectStore abstraction, S3/Supabase physical backends, bundle/chunk layout,      |
       | object-location index, hash verification, storage compatibility shims, raw bytes. |
       | L6 has no product policy, merge policy, ref authority, or protocol semantics.     |
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
- Git object writes and conditional root publish are shown inside L5 Core because
  they are part of the write loop. There is no separate downstream publish stage
  that can "return" to the engine; a moved head/root loops back to the Main
  path with the latest state, while unresolved conflicts return `pending`.
- L5 is now the write system, with L5 Core on the left and L5 Follow-up / Repair
  on the right. The left side remains the semantic write authority; the right
  side consumes committed facts and performs repairable follow-up work.
- Conflicts belong to L5. The Write Engine compares base/current/incoming
  trees, reaches a `resolve conflicts` checkpoint, and either produces a new
  candidate tree or writes a pending-conflict fact. L5 Follow-up may surface,
  notify, index, and repair those committed facts, but it must not decide merge
  policy or advance refs.
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
- L6 is the storage substrate below the write system. ObjectStore backends,
  S3/Supabase physical layout, object-location indexes, bundle/chunk storage,
  hash verification, and storage compatibility shims live here. L6 does not
  perform auth, permission, merge/conflict policy, or ref publication.
- The canonical project root is the only source of truth for new writes. Scoped
  heads and scope-state rows are compatibility/cache material and must be
  rebuildable from the root, not the other way around.
- Git smart HTTP must expose exactly one Git-visible ref state per Access Point
  view. Clone/fetch, receive-pack advertisement, receive quarantine, and push
  fast-forward checks all use the same `GitViewHead` resolver. If current content
  is healthy but old history is damaged, the view is `history_degraded` and Git
  exposes a projected boundary commit. If current content is damaged, the view is
  `current_corrupt` and Git rejects until the current tree is repaired/restored.

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
  worker, or MCP tool may publish refs, history, audit, conflicts, or outbox rows
  outside the Write Engine.
- L6 owns object bytes and object-location persistence as a substrate for L5.
  Callers above L5 must not treat L6 as a write-authority bypass.
- Conflict decisions must be made in L5. Read surfaces may display conflicts,
  and async jobs may notify or repair conflict views, but they must not decide
  merge policy or advance refs.
- The `resolve conflicts` checkpoint may use policy-driven last-write-wins,
  agent-assisted merge, or manual human resolution. The architecture diagram
  intentionally treats these as strategies behind one checkpoint.
- L5 Follow-up / Repair is the final write-system follow-up area. It may lag
  briefly, but every derived view must be repairable from committed version
  facts. Read APIs and frontend screens are consumers outside the write pipeline.
- The root-first invariant is a correctness boundary, not a performance
  optimization. If a scope cache, Git view cache, path index, or projection is
  empty or stale, reads must repair it from the canonical root or fail loud; they
  must not translate derived failure into an empty project.

## L5 Scope And Branch Convergence

L5 is the only place where different product views, Access Point views, and
Git-visible heads converge into one project history. A scope may look like a
small repository to a user, but it is not an independent source of truth.

```text
Canonical project state
=======================

  root head R10
  root tree T10
      |
      +-- docs/                 subtree D10
      +-- product/              subtree P10
      +-- New Folder (2)/       subtree N10

Derived Git-visible scope state
===============================

  /docs scope head S10
      tree(S10) == D10

  /New Folder (2) scope head G10
      tree(G10) == N10

Invariant
=========

  root is authority.
  scope heads are view heads.
  tree(scope head) must match subtree(root tree, scope_path)
  when the view is healthy.
```

The word "branch" in this section means a user-visible write lane or Git-visible
view lane. Puppyone scope remotes currently expose a single normal Git branch
for the view, while L5 keeps the semantic merge point at the project root.

### Root Write Affecting Child Scopes

When a product/root write changes files under one or more child scopes, the
write belongs to the root lane. The child scopes do not claim ownership of the
write; they receive refreshed derived views.

```text
Root write changes:
  docs/a.md
  docs/b.md
  product/pricing.md

L5 Core:
  T10 + root patch
    -> T11
    -> root commit R11
    -> root CAS publish

L5 Follow-up / Repair:
  changed paths select affected scopes: docs, product
  docs    D10 -> D11 -> derived scope-view head S11
  product P10 -> P11 -> derived scope-view head P11
```

This refresh happens once per affected scope, not once per file. If five changed
files all live under `/docs`, L5 Follow-up computes one target `/docs` subtree
and one new `/docs` scope-view head.

Root-originated changes are parent-authoritative for overlapping paths inside
child views: when the root write and a child view touch the same relative path,
the root version wins. Independent child paths are preserved during repair or
stale follow-up so a delayed projection does not erase a newer scoped write.

### Scoped Write Grafted Back To Root

When a scoped Access Point or Git remote receives a write, L5 treats the incoming
tree as a candidate replacement for that scope subtree, then grafts it back into
the canonical project root.

```text
User clones /docs at scope head S10
User commits S11
  tree(S11) == D11

L5 Core:
  read current root T10
  read current /docs subtree D10 from T10
  validate base/head/excludes/path bounds
  graft /docs := D11 into T10
    -> T11
  create root commit R11 with tree T11
  root CAS publish

Published result:
  root head  = R11
  /docs head = S11 for native Git pushes
             = generated scope-view commit for non-Git scoped writes
```

For native Git remotes, the source scope keeps the user's Git client commit as
the scope head when that commit tree is the accepted scope subtree. L5 Follow-up
must not re-derive that source scope head after the transaction; doing so would
replace a normal Git fast-forward chain with a synthetic view commit.

Other affected scopes are still refreshed from the new root. For example, a
write to `/docs/api` may refresh `/docs` and `/docs/api`, but it must not refresh
unrelated scopes.

### Root CAS And Merge Loop

All lanes meet at the root CAS publish boundary.

```text
attempt:
  latest root = Rn / Tn
  scope base  = subtree(Tn, scope_path)
  incoming    = proposed scope tree or root patch
  candidate   = graft/patch result
  publish     = CAS(root_hash == Tn, new_root_hash = candidate)

CAS accepted:
  write commit/history/audit/transaction/outbox

CAS lost:
  read newer root
  recompute candidate
  auto merge if safe
  write pending conflict if unsafe
  retry until budget exhausted
```

This is why scope remotes can be concurrent without becoming separate truths.
Two scoped writes to unrelated paths can both land by retrying against the newest
root. Two writes to the same path go through L5 conflict policy.

### Performance Shape

Root-first does not require flattening the whole project for every scoped write.
The normal scoped write path works on Git tree hashes:

- extract the current subtree hash at `scope_path`;
- validate changed relative paths against the admitted scope and excludes;
- replace that subtree hash under the root by rebuilding only the ancestor path;
- publish the new root hash with CAS.

In tree terms, replacing `/docs/api` rebuilds `api`, then `docs`, then root. It
does not read and rewrite every file in unrelated root directories.

Follow-up derived work is also bounded by changed paths:

- only scopes intersecting the committed changed paths are candidates;
- each affected scope is refreshed at most once for the commit;
- scope-state rows and Git view caches are materialized views;
- caches may be rebuilt from committed root facts and object storage.

Current implementation note: some child-scope follow-up merge paths materialize
files inside the affected scope to preserve independent child edits. That work is
limited to the affected scope, not the full project. If a single scope becomes
very large, the intended optimization is to replace that flatten/merge step with
tree-diff and path-patch operations behind the same L5 contract.

### Failure And Repair Contract

L5 Core must make the committed root facts durable before returning success. L5
Follow-up / Repair may lag or retry, but it cannot be the only place where the
project truth exists.

If a follow-up step fails:

- the canonical root remains correct;
- source scope heads from the accepted transaction remain owned by that
  transaction;
- affected non-source scope caches may be stale;
- reads may repair or synthesize a Git-visible scope view from the root;
- durable outbox/repair jobs may rebuild scope-state, Git view caches, path
  indexes, and search indexes;
- stale follow-up jobs must use CAS and must not overwrite newer scope heads.

A broken derived view must never become an empty project. If the root is healthy
and a derived cache is missing, stale, or damaged, the system should rebuild from
the root or fail loudly with a repairable error.

## Rules

1. Git owns version facts: objects, trees, commits, refs, clone/fetch/push.
2. PuppyOne owns collaboration policy: scopes, auth, conflict handling, audit,
   projections, and server-side transaction semantics.
3. Frontend and Product API writes always target the root product scope unless
   an explicit access point or connector scope is being used.
4. Access-point and connector scopes are wrappers over the canonical project
   root. A scoped write patches only its admitted path, then publishes a new
   root; it does not create an independent source of truth.
5. Git view caches are protocol caches only. They are not authority. They are
   durable per-view derived resources consumed by L1/L4 Git transport and
   repairable from L5 committed facts by L5 Follow-up / Repair.
   Smart-HTTP fetch is stateless across `info/refs` and `git-upload-pack`, so
   upload-pack may temporarily pin client `want` objects as request-local refs
   when the canonical view advances between those two HTTP requests.
6. Search and indexing consume committed events and views; they never decide
   merge/conflict behavior.
7. L6 storage substrate is a physical persistence boundary, not a product
   policy boundary.
8. Runtime code must not import the old external version package or public old
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
      view_cache.py
      view_projection.py
    batch/
      in_process_client.py

  write_engine/
    engine.py                     # L5 Core facade / intent orchestration
    audit.py                      # shared audit metadata + write logging
    cas_retry.py                  # CAS-retry convergence merge
    conflict_policy.py
    conflict_queue.py             # pending manual-review conflict persistence
    diff.py
    git_commit.py
    git_object_format.py
    hash_utils.py
    ledger.py                     # persistence contract
    merge.py
    path_utils.py
    publisher.py                  # L5 CAS publish boundary + follow-up scheduling
    root_state.py                 # root-first state, repair, and scope grafting
    scope_view.py                 # scoped Git-view commit materialization
    scope.py
    submission_commit.py          # Git submission commit preservation/synthesis
    trace.py
    tree.py
    tree_access.py                # tree lookup, diff expansion, sparse merge
    tree_objects.py

  storage/
    # L6 Storage Substrate
    object_store.py               # L5-facing ObjectStore / StorageBackend boundary
    io_strategy.py                # route logical objects to loose/bundle/chunked IO layouts
    backends/
      s3.py                       # S3/Supabase physical backend and location index

  derived/
    # L5 Follow-up / Repair
    git_transport_cache.py
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
      object_storage.py           # compatibility shim; new code imports storage/backends/s3.py
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
      transaction_ledger.py       # L5 persistence for ledger.py
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
a scoped facade over the canonical project root:

```text
repo_scopes row
  -> RepoFacade(project_id, repo_id, scope_path, excludes, mode, ref)
  -> Git transport / CLI FS scoped view
  -> Version Engine transaction
  -> shared project object store + canonical project root
  -> optional scope-state / Git-view cache refresh
```

This keeps the GitHub-like external product model without creating one physical
Git repository per scope and without creating one source of truth per scope.
