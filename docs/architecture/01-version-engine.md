# PuppyOne Version Architecture

> Git-native version control, PuppyOne transaction semantics.
>
> PuppyOne presents version history as Git. Internally, `mut_engine` is
> rebuilt as the Git-native write transaction authority: it decides which
> writes can become Git version facts, how scoped collaboration is
> merged, and how audit records are produced.
>
> This document describes the final architecture and the migration rules
> for reaching it. It does not prescribe low-level implementation diffs.
>
> Previous background: [00-vision.md](00-vision.md),
> [01-mut-engine.md](01-mut-engine.md).

---

## 1. Positioning

PuppyOne's version system has three separate facts:

| Fact | Owner | User-visible? | Responsibility |
|------|-------|---------------|----------------|
| Version fact | Git object model | Yes | commits, trees, blobs, refs, log, diff, checkout |
| Transaction fact | `mut_engine` | No, except through outcomes | write admission, scope boundary, server-side merge, conflict policy, publish |
| Collaboration fact | PuppyOne Audit | Yes, in PuppyOne UI/API | actor, source channel, auth context, policy, conflicts, rejected/pending events |

The important rule:

> Version management is Git-native. Write transaction decisions use
> `mut_engine`. Audit is a PuppyOne collaboration ledger, not a copy of
> Git history.

`mut_engine` is therefore not a second version control system and not a
compatibility wrapper around the old MUT protocol. It is the internal
Version Transaction Engine that produces real Git version facts and
PuppyOne audit facts from the same write transaction.

### 1.1 Scope of This Architecture Change

The product change is deliberately narrow:

> PuppyOne must support both native MUT submissions and standard Git
> submissions, while publishing one Git-native version history.

This does not mean wrapping the existing MUT write path and calling it
Git support. The target is a Git-native write path with PuppyOne
collaboration semantics:

- keep the mature PuppyOne collaboration semantics;
- keep native MUT clients working through a legacy protocol adapter;
- make Git clients the primary submission and read surface;
- make real Git commits, trees, blobs, and refs the version model exposed
  to users and tooling;
- keep `mut_engine` as the transaction authority that decides whether a
  submitted change becomes a version fact.

The version kernel after migration is Git's object/ref model. Native MUT
submission remains supported, but only as a legacy protocol surface over
the same Git-native version store.

In other words:

```
MUT native commit command  ─┐
                            ├─> mut_engine transaction decision
Git commit / push command  ─┘       └─> Git version facts
```

The migration must not erase the existing work that already implements
the hard parts of PuppyOne collaboration. In particular, per-scope CAS,
scope-aware write routing, DB-authoritative subtree grafting, Git-format
object storage, history recording, and audit recording are assets to be
lifted into the final architecture, not rewritten casually.

The distinction is important:

- reuse existing algorithms, invariants, schemas, and proven edge-case
  handling;
- do not preserve old ownership boundaries where routers or MUT protocol
  handlers effectively own publishing;
- do not introduce a temporary facade whose main job is to call the old
  direct-write path;
- build the final write path around Git object quarantine, Git commit/tree
  decisions, scoped refs/heads, projection, audit, and conflict policy
  from the start.

The result should feel like a native Git server from the outside and a
PuppyOne transaction engine from the inside.

---

## 2. System Overview

```
User-visible interfaces
┌──────────────────────────────────────────────────────────────┐
│ Git CLI / VS Code Git                                        │
│ PuppyOne Web / PAPI-1                                        │
│ PuppyOne CLI / filesystem commands                           │
│ Legacy MUT clients                                           │
│ Agents / hosted sandboxes / sync connectors                  │
└───────────────┬─────────────────────┬────────────────────────┘
                │                     │
                ▼                     ▼
       Protocol adapters        Product operation adapters
┌──────────────────────────┐  ┌────────────────────────────────┐
│ Git adapter              │  │ Operation adapter               │
│ - upload-pack/fetch      │  │ - write                         │
│ - receive-pack/push      │  │ - mkdir                         │
│ - pack/ref translation   │  │ - move/copy/delete              │
│                          │  │ - bulk write/upload             │
│ MUT adapter              │  │                                │
│ - legacy clone/pull/push │  │ Connector/agent adapters        │
│ - snapshot translation   │  │ - sync/import/export intents    │
└──────────────┬───────────┘  └──────────────┬─────────────────┘
               └───────────────┬─────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ mut_engine: Version Transaction Engine                       │
│                                                              │
│ - actor and scope authorization                              │
│ - base/current validation                                    │
│ - conflict policy selection                                  │
│ - operation application or server-side merge                 │
│ - canonical Git commit / projection decision                 │
│ - atomic publish to scope/project refs                       │
│ - version index production                                   │
│ - audit event production                                     │
│ - outbox events for notifications and resolver agents         │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Storage / State                                              │
│                                                              │
│ S3: Git-format blob/tree/commit objects                      │
│ PG: repo scopes, refs/scope heads, version index             │
│ PG: version transactions, conflicts, audit logs, outbox       │
└──────────────────────────────────────────────────────────────┘
```

Adapters translate external input into transaction intents. They do not
own publish authority. `mut_engine` is the only component allowed to
advance a scope head, project ref, version index, or audit state.

### 2.1 End-to-End Write Wiring

The most important implementation rule is that PuppyOne has many write
entrances, but one write authority. Frontend actions, PAPI-1/CLI
filesystem commands, Git pushes, and legacy MUT pushes do not publish
their own version facts. They are translated into transaction intents and
then converge in `GitNativeTransactionEngine`.

```
                                      User-visible write entrances
                                      ============================

                          Product operation entrances
        +----------------+     +----------------+     +----------------+
        | Frontend Data  |     | PuppyOne FS CLI|     | Internal PAPI  |
        | page actions   |     | puppyone fs ...|     | / ingest paths |
        +-------+--------+     +-------+--------+     +-------+--------+
                |                      |                      |
                | write/mkdir/mv/rm    | write/rm/mv/upload   | bulk refs
                v                      v                      v
        +---------------+      +---------------+      +---------------+
        | contentTreeApi|      | CLI commands  |      | product API   |
        +-------+-------+      +-------+-------+      +-------+-------+
                |                      |                      |
                v                      v                      v
        +---------------+      +---------------+      +---------------+
        | content_write |      | access_point_ |      | ingest/bulk   |
        | router        |      | fs router     |      | write router  |
        +-------+-------+      +-------+-------+      +-------+-------+
                |                      |                      |
                | user/project auth    | AP auth/scope/exclude| internal auth
                +-----------+----------+----------+-----------+
                            |                     |
                            v                     v
                  +------------------------------------------+
                  | MutOps / Product Operation Adapter       |
                  |                                          |
                  | Translates product file operations:      |
                  | - write_file(path, bytes)                |
                  | - mkdir(path)                            |
                  | - move/copy/delete(paths)                |
                  | - upload / bulk_write / bulk_write_refs  |
                  |                                          |
                  | Output: OperationWriteIntent + splice_fn |
                  +---------------------+--------------------+
                                        |
                                        | OperationWriteIntent
                                        |
        Git submission pillar           |              Legacy MUT submission pillar
        =====================           |              ============================
        +----------------+              |              +----------------+
        | Git CLI        |              |              | Legacy MUT CLI |
        | git push       |              |              | mut push       |
        +-------+--------+              |              +-------+--------+
                |                       |                      |
                | Git pack/protocol     |                      | MUT payload/snapshot
                v                       |                      v
        +---------------+               |              +---------------+
        | Git router    |               |              | MUT router    |
        | /git/*.git    |               |              | legacy API    |
        +-------+-------+               |              +-------+-------+
                |                       |                      |
                | Git auth/scope gate   |                      | MUT auth/protocol
                v                       |                      v
        +---------------+               |              +---------------+
        | receive-pack  |               |              | MUT adapter   |
        | quarantine    |               |              | mapper        |
        +-------+-------+               |              +-------+-------+
                |                       |                      |
                | VersionSubmissionIntent                      | VersionSubmissionIntent
                +-----------------------+----------------------+
                                        |
                                        v
                  +------------------------------------------+
                  | GitNativeTransactionEngine               |
                  |                                          |
                  | Single version transaction authority     |
                  | - validates scope boundary/excludes      |
                  | - reads current scope head               |
                  | - applies operation or server-side merge |
                  | - selects conflict policy                |
                  | - accepts client commit or synthesizes   |
                  |   canonical server commit                |
                  | - builds real Git tree/commit objects    |
                  | - publishes by optimistic CAS            |
                  | - writes history/audit/outbox facts      |
                  +---------------------+--------------------+
                                        |
                                        | publish_scope_update
                                        v
                  +------------------------------------------+
                  | Storage and durable state                |
                  |                                          |
                  | Git Object Store                         |
                  | - blobs / trees / commits                |
                  |                                          |
                  | Postgres / Supabase                      |
                  | - mut_scope_state                        |
                  | - mut_commits                            |
                  | - audit_logs                             |
                  | - mut_version_index                      |
                  | - mut_version_outbox                     |
                  +---------------------+--------------------+
                                        |
                         +--------------+--------------+
                         |                             |
                         v                             v
              +---------------------+       +----------------------+
              | Synchronous project |       | Deferred projection  |
              | view projection     |       | and outbox repair    |
              |                     |       |                      |
              | Used when caller    |       | Used for AP-FS/Git   |
              | needs immediate     |       | write latency and    |
              | project-view reads  |       | durable graft repair |
              +---------------------+       +----------------------+
```

This diagram intentionally shows two different input languages:

- Product-operation language: Frontend, PAPI-1, AP-FS CLI, hosted
  agents, and ingest say "write this path", "rename this path", or
  "delete these paths". `MutOps` is the current implementation of this
  Product Operation Adapter. It translates those operations into
  `OperationWriteIntent` plus a tree splice function. The engine then
  materializes the new Git tree and Git commit.
- Version-submission language: Git CLI and legacy MUT CLI submit a
  proposed tree or commit-like snapshot. Their adapters translate the
  wire/protocol payload into `VersionSubmissionIntent`. The engine then
  decides whether the client commit can be preserved or whether the
  server must synthesize a canonical merge/resolution commit.

The translation boundary is therefore:

```
Frontend / PAPI-1 / AP-FS CLI
  -> MutOps
  -> OperationWriteIntent
  -> GitNativeTransactionEngine.apply_operation
  -> Git commit + history + audit

Git CLI
  -> Git adapter
  -> VersionSubmissionIntent
  -> GitNativeTransactionEngine.submit_version
  -> accepted client commit or canonical server commit
  -> history + audit

Legacy MUT CLI
  -> MUT adapter
  -> VersionSubmissionIntent
  -> GitNativeTransactionEngine.submit_version
  -> canonical Git version fact
  -> legacy response shape
```

`MutOps` should not be understood as the old MUT protocol. In the final
architecture it is either kept under that name for compatibility or
renamed to `ProductOperationAdapter` / `VersionedFsOps`, but its role is
the same: translate product file operations into engine intents. Git
pushes do not need `MutOps` because Git already supplies a proposed
commit/tree; they enter through the Git adapter instead.

No line in this diagram is allowed to bypass `GitNativeTransactionEngine`
for accepted writes. Any route that directly updates Git refs, scope
heads, history rows, audit rows, or project-view indexes is outside the
architecture.

---

## 3. Package Boundary

The backend package name `mut_engine` should remain. The name is useful
for continuity and reflects the original internal engine, but its final
product role changes:

```
Before:
  mut_engine = MUT protocol and Git-like version implementation

After:
  mut_engine = Version Transaction Engine
               + Git-native object/ref publish core
               + Git/MUT/Product adapters
               + storage infrastructure for Git version facts
```

The module is not a thin Git compatibility shim and not a renamed legacy
MUT server. It is the shared Git-native write transaction core behind
Git, legacy MUT, and Product Operations.

Recommended final package shape:

```
backend/src/mut_engine/
  domain/
    intents.py              # operation, submission, resolution, access events
    transactions.py         # transaction state model
    conflicts.py            # conflict records and resolution outcomes
    policies.py             # policy identifiers and selectors
    views.py                # project view, scope view, projection identity

  application/
    transaction_engine.py   # publish authority
    conflict_policy.py      # policy selection and routing
    commit_decider.py       # accept client commit vs synthesize server commit
    root_projection.py      # scope heads -> Git-compatible project view
    audit_service.py        # collaboration event production
    outbox_service.py       # notification/resolver dispatch events

  adapters/
    git/
      router.py             # thin FastAPI route admission only
      auth.py               # Git credential/access-point resolution
      protocol.py           # pkt-line and git subprocess helpers
      upload_pack.py        # clone/fetch service
      receive_pack.py       # push parser and transaction handoff
      object_quarantine.py  # temporary object import before publish
      view_projection.py    # project/scope Git view refs

    mut/
      router.py
      payload_mapper.py

    operations/
      router.py
      ops_adapter.py

  infrastructure/
    object_store.py
    ref_repository.py
    version_repository.py
    transaction_repository.py
    conflict_repository.py
    audit_repository.py
    outbox_repository.py
    scope_repository.py
```

This is a boundary map, not a migration checklist. The important point is
that protocol adapters and product operation adapters converge into the
same application core.

The optimized implementation should keep a small amount of compatibility
surface where tests and harnesses already depend on it, but ownership must
remain clear. For example, `services/hooks.py` may keep legacy helper names
for callers that patch them, while the actual subtree graft algorithm lives
in `application/root_projection.py`. Similarly, `adapters/git/router.py`
may expose an access-point resolver injection point for tests, while Git
auth logic remains a Git adapter responsibility and publishing remains an
engine responsibility.

---

## 4. Adapter Responsibilities

### 4.1 Git Adapter

The Git adapter makes PuppyOne look like a Git remote.

It may:

- parse smart HTTP / SSH Git requests;
- resolve Git credentials into the same access-point auth context used by
  MUT and Product/PAPI paths;
- parse and validate pack files;
- quarantine incoming objects before publish;
- validate object hashes and graph reachability;
- resolve the request into a project view or scope view;
- translate a push into `VersionSubmissionIntent`;
- translate fetch/clone into a Git-compatible view.

It may not:

- advance refs directly;
- update scope state directly;
- write final version index rows;
- write final audit rows;
- decide conflict policy.

The canonical user-facing Git remote is access-point bound. Before
`receive-pack` or `upload-pack` runs, the adapter must resolve the access
key or Git HTTP credential into:

- project id;
- scope id/path/exclude/mode;
- actor or bound user identity;
- connector/channel pause state.

That resolved auth context is the only source of truth for which scope a
Git client can see or write. A scoped Git remote may not choose another
scope by URL parameter, Git ref name, or client-side path convention.

### 4.2 MUT Adapter
The MUT adapter preserves legacy MUT request/response semantics without
preserving a separate version store or a separate publish path.

It may:

- parse legacy clone/pull/push payloads;
- validate incoming objects and snapshots;
- translate legacy push into `VersionSubmissionIntent`;
- translate transaction results back into legacy response shapes.

It may not define an independent commit identity, root, or audit model.
It may also not call the historical MUT handler as the authority for
publish. MUT protocol support is an adapter concern. The server-side
version fact is still a real Git commit/tree/ref fact.

### 4.3 Product Operation Adapter

The Product Operation Adapter is the successor role of today's `MutOps`.
It is not a version protocol. It translates product operations into write
intents:

- write file;
- create directory;
- move/copy;
- delete;
- upload;
- bulk write;
- connector import/export;
- hosted agent write-back.

These operations become `OperationWriteIntent` and are published through
the same transaction engine as Git and MUT submissions.

In the current codebase, `MutOps` is the concrete implementation of this
adapter role for Web/PAPI-1/AP-FS style operations. It should remain thin:
it may route paths to the narrowest scope, validate operation shape, build
tree splice functions, and attach operation metadata. It must not decide
final commit identity, publish refs, write accepted-write audit rows, or
own conflict policy. Those decisions belong to
`GitNativeTransactionEngine`.

The practical distinction is:

```
MutOps:
  product file operation -> OperationWriteIntent + splice_fn

Git adapter:
  Git pack / pushed commit -> VersionSubmissionIntent

MUT adapter:
  legacy MUT payload -> VersionSubmissionIntent

GitNativeTransactionEngine:
  intent -> authoritative Git commit/tree/ref + history/audit/outbox
```

---

## 5. Transaction Intents

`mut_engine` accepts two write shapes and one resolution shape.

### 5.1 Operation Write Intent

Used by product APIs and internal systems.

```
OperationWriteIntent
  actor
  source_channel
  scope
  operation_type
  affected_paths
  operation_payload
  message
```

Meaning:

> Apply this product operation to the current authoritative tree, subject
> to scope authorization and conflict policy.

### 5.2 Version Submission Intent

Used by Git push and legacy MUT push.

```
VersionSubmissionIntent
  actor
  source_channel
  scope
  base_commit_id
  client_commit_id
  proposed_tree_id
  quarantined_objects
  message
```

Meaning:

> The client produced a proposed tree based on a base commit. Decide
> whether, how, and under which policy it becomes authoritative.

### 5.3 Conflict Resolution Intent

Used by manual review and hosted resolver agents.

```
ConflictResolutionIntent
  transaction_id
  resolver_actor
  resolution_tree_id
  resolution_message
  decision
```

Meaning:

> A pending transaction has been reviewed or resolved. Re-enter the same
> publish pipeline instead of bypassing it.

---

## 6. Transaction Lifecycle

Every write transaction follows the same state model:

```
received
  │
  ▼
validated
  │
  ▼
policy_selected
  │
  ├── rejected
  │
  ├── pending_manual_review
  │
  ├── pending_agent_resolution
  │
  └── resolving
        │
        ▼
     publish_attempt
        │
        ├── committed
        ├── rejected
        └── retryable_conflict
```

The transaction engine owns this lifecycle. A pending transaction never
updates a scope head or project ref. Only a committed transaction becomes
a Git version fact.

Rejected and pending transactions are still audit facts. They may have no
commit id.

---

## 7. Architectural Decisions

The following choices are architecture contracts, not implementation
details. They determine the shape of the engine API and must be shared by
Git, MUT, and product operation adapters.

### 7.1 Concurrency Model: Per-Scope Optimistic CAS

The final concurrency model is:

- the transaction unit is a scope view;
- the authoritative conflict detector is compare-and-swap on the current
  scope state, including tree identity and head commit identity;
- merge/build work is optimistic: concurrent writers to the same scope may
  compute candidate trees in parallel;
- the SQL publish CAS is the linearization point. Only the accepted
  scope-head update is serialized by the database;
- a per-scope in-process queue may exist only as an overload/backoff valve
  for pathological CAS-thrashing scopes, not as the normal correctness
  boundary;
- there is no global repository lock for normal writes;
- when CAS fails, the engine reloads the current head and re-enters policy
  selection or merge, rather than blindly retrying the same result.
- root/project view projection is not a global write lock. It is a
  derived view rebuilt from scope heads with its own CAS/retry loop.

This preserves the best part of the original MUT native push path:
calculation happens outside a long pessimistic lock, and the database CAS
decides which candidate becomes the next authoritative scope head. The
older direct-operation path used per-scope serialization to avoid duplicate
work; the final architecture keeps CAS as the correctness contract and
treats any local queue as optional load shedding.

This is the concurrency property PuppyOne must protect during Git
migration:

> A write to the root scope must not lock every child scope. A write to
> one child scope must not serialize unrelated sibling scopes. Only writes
> that target the same authoritative scope compete on the same CAS key.

Optimistic CAS is also where server-side merge belongs. If the incoming
base is stale, the engine reloads the current scope head, applies the
selected merge/conflict policy, and attempts a new CAS. It must not take a
repository-wide pessimistic lock to make the merge convenient.

### 7.2 Scope-Bound Submissions

The default write transaction is single-scope. A Git or MUT submission is
always bound to exactly one project or scope remote. In an agent's view,
that scope behaves like its own GitHub repository with its own local
`.git` checkout and its own remote URL or access point.

A Git/MUT push must not span multiple scopes. If a submission attempts to
modify paths owned by another scope, the server rejects it and the caller
must split the work into separate commits/pushes against the correct
scope remotes.

Product operations may still accept a multi-path payload. In that case,
the product operation adapter decomposes it into ordered per-scope
transactions:

```
incoming multi-scope intent
  -> scope A transaction -> commit/head/audit for scope A
  -> scope B transaction -> commit/head/audit for scope B
  -> optional project-view projection refresh
```

There is no implicit all-or-nothing transaction across unrelated scopes.
Each scope has its own policy decision, commit, audit event, and publish
boundary. A future cross-scope atomic operation must be an explicit new
intent type, not a hidden side effect of bulk write or Git push.

This also preserves existing PuppyOne behavior: current product bulk
write logic groups paths by the narrowest matching scope and writes each
scope through the same mutation path. The final architecture should keep
that semantic shape while making the transaction records explicit.

For a Git push, scope ownership is checked before publish:

- files under a child scope are owned by that child scope;
- the root scope owns only paths not captured by a more specific scope;
- a scope-bound Git push may only change paths owned by that scope;
- a push that touches multiple scopes is rejected and must be split;
- project-view history is a projection over those transactions, not a
  separate all-repo commit root that can overwrite child scopes.

This is what prevents a root-scope Git push from trampling a child scope,
and what prevents child-scope writes from waiting behind unrelated root
scope work.

### 7.3 Read Consistency: Read-Your-Write for Published Views

Once a committed transaction is returned to the caller, the same actor
must be able to read that committed view immediately.

For scope views, reads use the current scope head. For project/global
views, PuppyOne may use a materialized projection, but it must not expose
stale version facts after a successful write. The projection must either:

- be refreshed before the write response is considered committed for that
  view; or
- be rebuilt on read when the stored projection is behind the scope-head
  registry.

Notifications, WebSocket delivery, indexing, and expensive activity-feed
decoration may be asynchronous. Git refs, scope heads, and Web/PAPI
version reads may not be merely eventually consistent from the writer's
point of view.

This carries forward the right part of the existing subtree graft work:
the global root is rebuilt from the database-authoritative scope registry,
not from an independent MUT root. The final Git-compatible implementation
should keep that registry-first projection model.

### 7.4 Publish Boundary: One Authoritative Write Transaction

Accepted writes must publish their authoritative facts atomically.

Before publish, incoming Git objects must stay in quarantine/staging.
For `receive-pack`, the adapter validates the pack in a temporary Git
object database and passes two things to the engine: the decoded proposed
tree bytes and a `promote_objects()` callback. The engine may promote
objects only after the submission has passed scope/policy checks and is
about to publish an accepted commit. Rejected or pending submissions must
not leak their client commit objects into the canonical object store.

The visible publish point is a database transaction that advances the
relevant ref/scope head and records the authoritative write facts:

- scope or project ref/head update;
- version transaction status;
- version index row;
- accepted-write audit row;
- outbox event for notifications, hooks, and resolver follow-up.

If any of those authoritative write facts cannot be recorded, the ref/head
must not become visible. Orphaned staged objects are acceptable and can be
garbage-collected; a visible commit without its transaction/audit fact is
not acceptable.

Post-publish projection and notification work has two layers:

- synchronous best-effort hook for read-your-write latency;
- durable `mut_version_outbox` repair loop with claim/complete/fail state
  for replaying graft, version-index, notification, and resolver follow-up
  if the synchronous hook fails.

Read/access audit events, such as clone or fetch, are separate activity
facts and do not belong to the accepted-write publish boundary. They
should be durable, but they do not determine whether a version fact exists.

This is stricter than some current paths. Existing code already has the
right CAS and history-sync instincts, but accepted-write audit is not
always part of one database transaction today. The final architecture
should explicitly tighten that contract rather than preserve best-effort
accepted-write audit.

### 7.5 Feature Flag Surface: Adapter-Only Switch

PuppyOne supports protocol selection through a single adapter-exposure
flag. The flag's blast radius is intentionally minimal: it controls which
protocol adapters may accept requests for a project and nothing else.

#### Flag Location

```
project.protocol_mode = "mut" | "git" | "both"
```

New projects default to `git`. `mut` is for legacy native-MUT projects,
and `both` is a rollout mode for projects that need both protocol
surfaces during transition. The value must be enum-validated at API and
database boundaries. In production-like environments, inability to read
the project policy must fail closed at adapter admission; local
development and tests may explicitly fail open to `both`.

Even in `both`, there are not two engines. Both protocol surfaces enter
the same Git-native transaction core.

The project value is the server-side source of truth for which protocol
surfaces are reachable. It is resolved at request-admission time, after
the project or access key has been identified and before any adapter
translates input into a transaction intent.

An access point or credential may choose which allowed protocol URL to
advertise to a client, but it must not override the project's allowed
protocol set.

#### What the Flag Controls

| Surface | Controlled by flag? |
|---------|---------------------|
| Whether Git or MUT adapters accept requests for the project | Yes |
| User-facing remote URL surfaced to clients (Git URL vs MUT access point) | Yes |
| Onboarding/help text shown for the project | Yes |
| Product Operation Adapter exposure | No, always available |

#### What the Flag Must Not Control

These are flag-independent and must behave identically for `mut`, `git`,
and `both` projects:

- the transaction engine and its publish authority;
- conflict policy selection and outcomes;
- commit decision rules (when to accept a client commit vs synthesize);
- storage source-of-truth (scope heads, S3 objects, version index);
- audit model, audit fields, and audit publish boundary;
- read consistency contract;
- every invariant in section 17.

A change to any item above must ship to both `mut` and `git` projects in
the same release. It must never be gated behind the flag.

#### Reversibility

Switching `protocol_mode` between values requires no server-side version
data migration. Because all projects share one transaction ledger, one
object store, and one scope-head registry, the flag only changes which
client protocols can talk to the project. A project switched from `mut`
to `git`, then back to `mut`, has the same server-side version history
both times. Client remotes, local checkout metadata, or credentials may
still need to be reconfigured.

#### Why the Blast Radius Stays Small

This property is enforced by two earlier invariants:

- adapters cannot publish refs, scope state, version index, or audit
  (invariant 1);
- the engine is the only write transaction authority (invariant 2).

Adding, removing, or swapping an adapter therefore cannot change what
becomes a version fact or what becomes an audit fact. The flag's job is
limited to "which front door is open"; the building behind every door is
the same.

A future protocol (for example, a hypothetical SSH-only Git surface or a
read-only export protocol) is added by introducing a new adapter and a
new value for `protocol_mode`. No engine, storage, audit, or invariant
change is required to add a protocol.

This flag must never be used to choose between a "legacy MUT core" and a
"Git core". There is only the Git-native core. The flag only decides
which doors are open.

### 7.6 Git-Native User Contract

The user-facing success condition is simple:

> A user or agent can use normal Git commands against a PuppyOne remote,
> and PuppyOne stores the result in the same scoped transaction system
> that native MUT and Product/PAPI writes use.

The minimum Git-native command flow must work:

```
git clone <puppyone-git-url>
git add <paths>
git commit -m "message"
git push origin main
git fetch origin
git pull --ff-only
git log --oneline
git diff <commit> <commit>
```

For scoped credentials, the same commands operate on a scoped Git view.
The client must not receive hidden objects or paths outside that scope.

Git authentication uses the same Access Point model as the legacy MUT
access-point routes. A scoped Git URL resolves to one repo scope and one
mode:

```
https://<host>/git/ap/<access_key>.git
  -> resolve access_key
  -> project_id + scope(path, exclude, mode)
  -> Git receive-pack/upload-pack
  -> Version Transaction Engine
```

Read-only access points may fetch/clone but must receive a Git-compatible
push rejection. Identity-bound access points must reject a Git request
whose supplied actor does not match the bound identity. The actor may be
derived from `X-Mut-User`, `X-Git-Actor`, or the Git HTTP Basic username,
but once resolved it is treated as normal PuppyOne auth context rather
than an adapter-local convention.

Git compatibility does not mean Git owns PuppyOne collaboration policy.
On push, Git is only the submission format. The server still performs
scope partitioning, optimistic CAS, merge/conflict policy, audit, and
root/scope projection before a write becomes authoritative.

---

## 8. Commit Decision

The transaction engine decides which Git commit represents a committed
write.

| Input | Condition | Version result |
|-------|-----------|----------------|
| Operation write | Always server-originated | Synthesize server commit |
| Version submission | Base equals current head and policy allows | Accept client commit unchanged |
| Version submission | Base differs from current head | Server-side merge or policy decision |
| Manual/agent resolution | Resolution accepted | Synthesize server commit |

### 8.1 Accepting Client Commits

When a Git submission is already current, valid, and policy-compatible,
PuppyOne should preserve the client commit object unchanged. This keeps
the Git experience intuitive:

```
client commit A
remote ref becomes A
```

No server trailer is injected in this path because changing the commit
message changes the SHA.

### 8.2 Server-Generated Commits

PuppyOne synthesizes a commit when:

- the write originated from a product operation;
- server-side merge changed the proposed tree;
- manual review produced a resolution tree;
- a hosted resolver agent produced a resolution tree;
- policy requires trusted server attribution.

Server-generated commit messages may include stable trailers, but only
for immutable, trusted facts:

```
PuppyOne-Transaction: <transaction_id>
PuppyOne-Source: <git | mut | papi | web | agent | sync>
PuppyOne-Scope: <scope_path>
PuppyOne-Original-Commit: <client_commit_id>
```

Mutable facts such as IP address, user agent, request id, or raw auth
metadata belong in audit rows, not immutable commit messages.

---

## 9. Conflict Policy Architecture

Conflict handling is a first-class architecture concern. It must not be
buried inside Git, MUT, or product operation adapters.

### 9.0 V1 Policy

The first production policy is intentionally conservative:

- deterministic server-side auto-merge is allowed;
- any unsafe conflict becomes a pending manual-review transaction;
- pending conflicts do not advance Git refs, scope heads, project views, or
  version history;
- Git/MUT clients receive a rejected/pending result and must not resolve the
  conflict locally;
- only a source-side actor with the right PuppyOne permission can resolve or
  approve the conflict.

This mirrors the user trust model of GitHub-style protected collaboration:
the remote/source is authoritative, and a conflict is resolved at the source
boundary rather than silently overwritten by the client.

The initial safe auto-merge set is:

- same content on both sides;
- only one side changed;
- JSON object changes on different keys;
- text changes in non-overlapping line hunks.

The initial manual-review set is:

- both sides changed the same scalar value or same overlapping text hunk;
- binary files changed on both sides;
- modify/delete and delete/modify conflicts;
- any merge that would otherwise require choosing a winner.

### 9.1 Policy Selection

Conflict policy is selected from the transaction context:

| Dimension | Examples |
|-----------|----------|
| Project | default policy for the repo |
| Scope | stricter rules for `configs/` than `docs/` |
| Path / glob | `*.json`, `*.md`, generated files |
| File type | JSON structural merge, text merge, binary |
| Actor | human, hosted agent, sync connector |
| Source channel | Git, MUT, Web, PAPI, connector |
| Operation type | write, bulk write, move, delete |

The selected policy returns one of these outcomes:

| Policy | Meaning |
|--------|---------|
| `auto_merge` | Server resolves with deterministic merge rules |
| `last_write_wins` | Latest accepted transaction overwrites conflicting content |
| `reject` | Transaction is refused and audited |
| `manual_review` | Transaction becomes pending for human decision |
| `agent_review` | Hosted agent analyzes conflict and proposes a decision |
| `agent_auto_resolve` | Hosted agent produces a resolution tree |

Policy configuration is admin-owned control-plane state. It may be surfaced
as a JSON editor or imported from a reviewed file, but repository content is
not itself authoritative policy. An agent that can push to the repo must not
be able to make `generated/**` last-write-wins or enable auto-publish by
editing a tracked config file.

V1 still models the future policies, but only `manual_review` is selected by
default. `last_write_wins`, `agent_review`, and `agent_auto_resolve` require
explicit admin enablement in a later release.

### 9.2 Policy Outcomes

```
incoming write
  │
  ▼
conflict policy
  │
  ├── auto_merge ────────────────► publish
  │
  ├── last_write_wins ───────────► publish + audit overwritten state
  │
  ├── reject ────────────────────► audit only
  │
  ├── manual_review ─────────────► pending transaction
  │                                  │
  │                                  ▼
  │                               resolution intent
  │                                  │
  │                                  ▼
  │                               publish or reject
  │
  └── agent_auto_resolve ────────► pending resolver task
                                     │
                                     ▼
                                  resolution intent
                                     │
                                     ▼
                                  publish or review
```

Pending states do not advance any ref. They store enough immutable object
references to review or replay the conflict:

- base tree;
- current tree;
- proposed tree;
- changed paths;
- conflict hunks or structured conflict records;
- selected policy;
- resolver assignment;
- transaction id.

### 9.3 Hosted Resolver Agents

Hosted resolver agents are not a special write path. They are consumers
of pending conflict events and producers of `ConflictResolutionIntent`.

V1 resolver agents are assistive only: they may propose a resolution tree,
patch, explanation, or test plan, but the final publish still requires a
source-side human approval. Later versions may support agent auto-publish,
but only behind an admin-owned policy rule and the same transaction engine.

This keeps the publish authority in one place:

```
pending conflict
  -> outbox event
  -> hosted resolver agent
  -> resolution intent
  -> mut_engine publish pipeline
```

The resolver agent never writes refs, scope state, or audit rows directly.

---

## 10. Git Protocol Semantics

PuppyOne should be Git-compatible, not GitHub-identical.

### 10.1 What Git-Compatible Means

For every view PuppyOne exposes:

- versions are Git commit objects;
- trees and blobs are Git objects;
- refs point at commit objects;
- `git log`, `git diff`, `git checkout`, and VS Code Git operate on that
  view using normal Git expectations.

### 10.2 What PuppyOne May Do Differently

PuppyOne may differ from GitHub because the server owns collaboration
semantics:

- a non-fast-forward push becomes a transaction decision, not an automatic
  rejection;
- the decision can be `committed`, `rejected`, or `pending_resolution`;
- server-side merge may synthesize a canonical commit;
- some fetches may be gated to preserve push-before-pull semantics;
- scoped credentials may see a projected Git history rather than the full
  project history.

### 10.3 Push Outcomes

Avoid saying "push always succeeds". A push enters transaction processing.

| Outcome | Meaning |
|---------|---------|
| `committed` | A Git commit/ref became authoritative |
| `rejected` | Nothing was published; audit records the reason |
| `pending_resolution` | Nothing was published yet; review or resolver is required |

Git adapters should surface these outcomes using Git-compatible remote
messages and status codes where possible.

---

## 11. Scope Views and Projection

Scope remains a core PuppyOne concept. Git has no native server-side path
permission model, so Git compatibility requires explicit views.

### 11.1 Project View

The project view is the full repository view for actors with full access.
Its ref points to a Git commit whose tree represents the whole project.

### 11.2 Scope View

A scope view is a Git-compatible projection of a subtree:

```
repo_scope(path="docs/")
  -> scoped Git ref
  -> commits whose trees expose only docs/
  -> fetch/clone cannot obtain objects outside the scope
```

Scoped history is derived from canonical transactions. It may require
projected commits so that Git clients can checkout a valid tree without
learning hidden paths.

The invariant is view-relative:

> For a given actor and scope, VS Code Git and PuppyOne Web history show
> the same version facts for that view.

Full-project actors see the project view. Scoped actors see their scope
view. Both views are derived from the same transaction ledger and object
store; there is no second source of truth.

---

## 12. Subtree and History Graft

PuppyOne already has the concept of grafting scoped trees into a global
root. In the final architecture this is not a MUT-specific compatibility
hack. It becomes the Git-compatible projection mechanism.

There are two grafts that must both survive the migration:

- tree graft: a child scope's tree appears at the correct path in the
  project worktree;
- history graft: a child scope's commit appears in the parent/project
  history visible to actors who can see that parent/project view.

The current MUT implementation already has this design: when a child
scope submits a change, the project-level history can display that
change, and the global root can show the grafted worktree. Git
compatibility must preserve this behavior, not flatten it away.

### 12.1 Source of Truth

Each scope has an authoritative head:

```
(project_id, scope_id/path) -> head_commit_id, tree_id
```

The global project tree is derived by overlaying current scope trees in a
deterministic order.

### 12.2 Projection Builder

```
scope heads
  │
  ▼
root projection builder
  │
  ├── read root scope tree as base
  ├── overlay non-root scopes by path depth
  ├── write Git tree object for full project
  └── synthesize/update project-view Git commit/ref
```

This projection must use Git tree objects. It must be rebuildable from
scope heads and must not become an independent root.

### 12.3 Project History Graft

Project-view Git history is a projection over scoped transactions, not
only the list of commits authored directly in the root scope.

When a child scope advances, PuppyOne must produce enough project-view
metadata for full-project actors to see that change in normal history
surfaces:

```
child scope transaction
  -> canonical scope commit
  -> grafted project tree
  -> project-view history entry / projected commit
```

The projected project-view commit is a real Git commit object. It may have
a different SHA from the canonical scope commit, because its tree is the
full project tree rather than the child subtree. When the ids differ, the
version index records the mapping:

```
transaction_id
canonical_scope_commit_id
project_view_commit_id
scope_path
grafted_tree_id
```

The required user-visible behavior is:

- `git log` on a full-project remote includes changes submitted from
  child scopes;
- `git diff` and checkout against a project-view commit reconstruct the
  grafted project tree;
- PuppyOne Web history and Git history agree for the same actor/view;
- scoped actors still see only their scoped projected history and must not
  learn hidden sibling paths or objects.

This is a first-class migration requirement. A Git implementation that
only grafts file trees but loses child-scope commits from project history
is incomplete.

### 12.4 Staleness Rule

The materialized project root is a cache/projection, not the source of
truth. If it is stale, PuppyOne must be able to rebuild it from scope
heads before serving a full-project Git view or Web read. A write response
that claims `committed` must not leave the writer unable to fetch or read
the committed view.

### 12.5 No Split Roots

There must not be:

```
Git-protocol root = one source of truth
MUT-protocol root = another source of truth
```

There is one transaction ledger, one object store, and one set of scope
heads. Git project and scope histories are projections over that state.

---

## 13. Audit Model

Audit is not Git history.

Git history answers:

> What content became authoritative?

Audit answers:

> Who attempted what, through which channel, under which policy, and what
> happened?

Audit events may or may not have commits.

| Event | Commit? |
|-------|---------|
| accepted write | yes |
| server-side merge | yes, canonical commit |
| rejected write | no |
| pending manual review | no, until resolution |
| pending agent resolution | no, until resolution |
| clone/fetch/pull/access event | usually no |
| rollback/restore | yes, if content changes |

Recommended join keys:

```
transaction_id
canonical_commit_id
original_commit_id
project_view_commit_id
scope_view_commit_id
source_channel
actor_id
actor_type
scope_path
policy
status
```

`commit_id` must be nullable in audit. Audit rows do not depend on a Git
commit existing.

---

## 14. Storage Source of Truth

| Fact | Source of Truth | Derived / Cache |
|------|-----------------|-----------------|
| Blob content | S3 Git blob object | none |
| Tree content | S3 Git tree object | none |
| Commit object | S3 Git commit object | version index rows |
| Scope head | PG scope/ref state | scoped Git ref materialization |
| Project view head | PG ref state | Git ref advertisement |
| Global root tree | Derived from scope heads | materialized root tree/cache |
| Transaction state | PG version transactions | audit/activity views |
| Conflict state | PG conflicts + Git object references | resolver task payloads |
| Audit event | PG audit logs | UI activity stream |
| Notification | PG outbox | WebSocket delivery |
| Scope definition | PG repo_scopes | adapter auth context |

Atomic publish is a PG transaction. Git receive-pack objects are unpacked
and fsck-validated in quarantine first. The engine promotes only the
accepted reachable objects when a submission clears scope/policy checks;
if publish later loses CAS, those objects are harmless orphan candidates
and are garbage-collectable. Rejected and pending submissions do not
promote client objects.

Object garbage collection is a conservative mark-and-sweep job, not a
correctness lock. The mark phase starts only from durable PuppyOne facts:
current project/scope heads, `mut_commits`, `mut_version_index`,
unprocessed `mut_version_outbox` rows, and pending conflict audit metadata.
It walks Git commit/tree/blob edges and legacy raw MUT tree edges. The
sweep phase deletes only unreachable objects older than the configured
retention window; if object age is unknown, the object is kept. When an
unreachable root is kept by age/unknown-age protection, its descendants are
also protected so GC never leaves a partial commit/tree/blob graph. The job is
disabled and dry-run by default so production can observe candidates before
turning deletion on.

The visible commit point is the PG transaction that advances the relevant
scope/project ref and records the corresponding transaction state,
version index row, accepted-write audit row, and outbox event.

The durable repair boundary is the version outbox. Projection and
notification hooks run synchronously for latency, but every accepted write
also inserts an outbox row in the same publish transaction. A background
worker claims rows, replays the post-commit hook, and marks rows complete
or failed for retry.

---

## 15. Read Model

PuppyOne exposes two read families.

### 15.1 Git Reads

Git reads serve Git-compatible refs and objects:

- project view fetch/clone;
- scope view fetch/clone;
- log/diff/checkout through normal Git clients.

### 15.2 Product Reads

Product reads serve Web/PAPI use cases:

- list directory;
- read file;
- version history;
- diff;
- rollback/restore;
- audit/activity log.

Product history must be aligned with the Git view visible to that actor.
For a full-project actor this is the project view. For a scoped actor this
is the scope view.

---

## 16. URL Surface

Exact routes are product/API decisions, but the architectural split should
remain:

```
Git protocol:
  /git/ap/{access_key}.git/info/refs
  /git/ap/{access_key}.git/git-upload-pack
  /git/ap/{access_key}.git/git-receive-pack

Authenticated full-project/internal Git protocol:
  /git/{project_id}.git/info/refs
  /git/{project_id}.git/git-upload-pack
  /git/{project_id}.git/git-receive-pack

Product operations:
  /api/v1/content/{project_id}/...

Product history:
  /api/v1/history/{project_id}/...

Product audit:
  /api/v1/audit/{project_id}/...

Legacy MUT:
  /api/v1/mut/...
```

Legacy MUT routes may continue to exist for existing clients, but they
are not the user-facing version-control brand and are not allowed to own
publish semantics.

---

## 17. Invariants

These are PR-review invariants. Breaking any of them breaks the
architecture.

1. Adapters do not publish refs, scope state, version indexes, or final
   audit rows.
2. `mut_engine` is the only write transaction authority.
3. Version facts exposed to users are Git-compatible commits, trees, blobs,
   and refs.
4. MUT compatibility does not create a second version store.
5. Product operations, Git submissions, and MUT submissions converge into
   the same transaction engine.
6. Conflict resolution is policy-driven and stateful; pending conflicts do
   not advance refs.
7. Hosted resolver agents return resolution intents; they do not publish
   directly.
8. Audit is not Git history; audit commit ids are nullable.
9. Scope views must not leak hidden paths or hidden objects.
10. Global root projection is derived from scope heads and can be rebuilt.
11. There is no independent per-protocol root: Git and MUT protocols both
    project from the same scope-head registry.
12. For any actor/view, PuppyOne Web history and Git history describe the
    same version facts.
13. Normal writes are serialized by per-scope optimistic CAS, optionally
    helped by local per-scope locks.
14. Product multi-path writes decompose into explicit per-scope
    transactions unless a future intent type says otherwise.
15. Git and MUT submissions are scope-bound; cross-scope submissions are
    rejected and must be split across scope remotes.
16. Child-scope commits are grafted into parent/project history views for
    actors who can see those views.
17. Project/scope view history entries exposed through Git refs point to
    real Git commit objects.
18. Git protocol entry points must resolve PuppyOne auth before advertising
    refs, receiving packs, or serving packs. The canonical public Git URL
    is access-point bound, and read-only/bound-identity access points must
    be enforced by Git exactly as they are by MUT.
19. A committed write provides read-your-write consistency for the
    committed view.
20. Accepted-write ref/head, version index, transaction status, audit, and
    outbox publish atomically.
21. The protocol-mode feature flag controls adapter exposure only. It must
    not branch engine logic, storage layout, conflict policy, commit
    decision, audit fields, or any invariant above. A semantic change to
    those layers gated on the flag is a violation.

---

## 18. Glossary

| Term | Meaning |
|------|---------|
| Git version model | User-visible commit/tree/blob/ref semantics |
| `mut_engine` | PuppyOne's Version Transaction Engine package |
| `MutOps` | Current product-operation adapter for Web/PAPI-1/AP-FS write/move/delete/bulk operations |
| Version Transaction Engine | The write authority that turns intents into version/audit facts |
| MUT protocol | Legacy wire protocol supported by an adapter |
| Product Operation Adapter | Adapter for Web/PAPI/CLI operation-style writes |
| Operation Write | A typed product operation such as write/move/delete/bulk write |
| Version Submission | A proposed tree/commit submitted by Git or MUT |
| Conflict Resolution Intent | Manual or agent-produced resolution for a pending transaction |
| Canonical commit | The commit accepted or synthesized as the authoritative version for a view |
| Project view | Full repository Git view |
| Scope view | Git-compatible projected view for a scoped actor |
| Subtree graft | Overlaying scope trees into a project root projection |
| History graft | Projecting child-scope commits into parent/project history views |
| Read-your-write | After a committed write returns, the writer can immediately read that committed view |
| Outbox | Durable event queue for notifications and resolver work |
| `protocol_mode` | Per-project feature flag selecting adapter exposure (`mut`, `git`, or `both`) |

---

## Appendix: Core Statement

PuppyOne should be understood as:

> Git for version facts.
> `mut_engine` for transaction decisions.
> PuppyOne Audit for collaboration facts.

`mut_engine` no longer defines what a version is. Git does that.
`mut_engine` defines what writes are allowed to become version facts, under
which policy, and with which audit trail.

---

## 19. Migration Plan

The migration plan is governed by one product constraint:

> We are not replacing PuppyOne's collaboration system. We are replacing
> the user-visible version model and primary submission surface with a
> Git-native one, while keeping native MUT protocol access as a legacy
> surface over the same core.

### 19.1 Migration Rules

These rules are mandatory for the refactor.

Non-goals:

- do not redesign scope semantics;
- do not replace the existing CAS/graft machinery without a specific
  correctness reason;
- do not create separate Git and MUT storage roots;
- do not use the feature flag to fork engine behavior;
- do not implement Git support as a wrapper around the old MUT protocol
  handler or `direct_writer` call path;
- do not change unrelated Product/PAPI behavior merely because the
  protocol surface is being expanded;
- do not serialize all writes behind a root/project lock;
- do not allow a Git/MUT submission to modify multiple scopes in one
  push.

1. Preserve existing proven mechanisms.

   The current code already solved important hard problems. These must be
   carried forward:

   | Existing asset | Final role |
   |----------------|------------|
   | `direct_writer` per-scope lock + CAS retry | Transaction engine concurrency core |
   | `mut_scope_state` CAS on `scope_hash` + `head_commit_id` | Ref/head publish primitive |
   | narrowest-scope routing in `MutOps` | Operation adapter scope routing |
   | DB-authoritative subtree graft | Git-compatible root projection |
   | Git-format blob/tree/commit object storage | Version object store |
   | `mut_commits` history records | Version index backing table, until renamed or abstracted |
   | `audit_logs` integration | Collaboration audit backing table |

   A migration that discards these without a specific correctness reason
   is wrong. But preserving them means lifting their algorithms and
   invariants into the Git-native core, not preserving old router-level
   publish ownership.

2. Do not create a second version root.

   There must never be a Git root and a MUT root that can diverge.
   Native MUT submissions and Git submissions both publish through the
   same scope-head registry, object store, transaction ledger, and root
   projection.

3. Keep MUT native submission as an adapter, not as a parallel engine.

   Legacy MUT clients may keep using clone/pull/push routes. Those routes
   translate into transaction intents and legacy response shapes. They do
   not own an independent publish path and must not delegate publication
   to the historical MUT handler as an authority.

4. Build Git as the first-class adapter and reference implementation.

   Git smart HTTP/SSH support is added at the adapter layer. `receive-pack`
   turns a Git push into a `VersionSubmissionIntent`; `upload-pack` serves
   project or scope views produced from the same transaction state.
   New projects default to `protocol_mode = "git"`.

   Each public Git remote is access-point bound. The Git adapter resolves
   the access key or Git HTTP credential into the same auth context used by
   MUT access points: project id, scope path, exclusions, mode, actor
   identity, and pause state. A client checkout pushes to one project or
   scope remote, not to several scopes at once. If a user or agent needs
   to modify two scopes, it must make two commits/pushes against the
   corresponding remotes.

5. Keep the feature flag at the adapter boundary.

   `protocol_mode` controls which protocol adapters accept requests and
   which URL is advertised. It must not branch engine behavior, storage
   layout, conflict policy, commit decision, audit fields, scope routing,
   or root projection.

6. Tighten publish atomicity instead of weakening it.

   Existing code has the right CAS shape, but accepted-write audit is not
   always part of one database transaction today. The migration should
   move toward the final publish boundary: ref/head, version index,
   transaction state, accepted-write audit, and outbox event publish
   atomically.

7. Preserve read-your-write.

   A committed write must be immediately visible to the writer through the
   relevant Git or Product view. Projection work may be cached, but stale
   projections must be refreshed synchronously or rebuilt on read before
   serving stale version facts.

8. Preserve scoped tree and history graft semantics for Git.

   Git project views and Git scope views are projections over the same
   scope-head registry. The projection rule stays the same as the current
   DB-authoritative graft:

   - root scope is the base tree;
   - non-root scopes overlay by path depth and path order;
   - hidden scopes are omitted from scoped views;
   - projection failure must fail loud or retry, never silently produce an
     empty or partial root tree.

   History graft is equally mandatory. A commit submitted in a child
   scope must be visible in the parent/project history for actors who can
   see that parent/project view. If Git projection requires a synthetic
   project-view commit, the version index records the mapping from the
   child scope commit to the project-view commit.

9. Preserve optimistic concurrency.

   A Git push must not force PuppyOne into a global branch lock. Server
   merge is optimistic: read current scope head, merge or decide by policy,
   CAS publish, retry on CAS miss. Unrelated scopes continue independently.

### 19.2 Target Migration Shape

The final write shape is:

```
Git push        ─┐
MUT native push ─┤ -> adapter -> VersionSubmissionIntent
Web/PAPI write  ┤
Agent write     ┘
                   -> Git-native TransactionEngine
                   -> object quarantine / object validation
                   -> commit decision and conflict policy
                   -> per-scope CAS publish
                   -> real Git objects/refs
                   -> version index + audit + outbox
                   -> root/scope projections
```

The code migration should therefore move existing responsibilities, not
duplicate them:

| Current location | Target location |
|------------------|-----------------|
| `services/direct_writer.py` | `application/transaction_engine.py` |
| `services/ops.py` write methods | `adapters/operations/ops_adapter.py` |
| `routers/protocol_router.py` | `adapters/mut/router.py` |
| `routers/access_point.py` | `adapters/mut/access_point.py` |
| `services/hooks.py` graft logic | `application/root_projection.py` |
| `server/backends/supabase_history.py` | `infrastructure/ref_repository.py` and `version_repository.py` |
| `server/backends/supabase_audit.py` | `infrastructure/audit_repository.py` |
| new Git protocol code | `adapters/git/` |

The names may change, but the behavioral contracts must not.

### 19.3 Recommended Sequence

1. Add tests around current best practices.

   Before moving code, lock down:

   - per-scope CAS behavior;
   - multi-scope decomposition;
   - DB-authoritative root projection;
   - scope-hidden object/history behavior;
   - accepted-write history/audit consistency;
   - read-your-write after commit.

2. Create the Git-native transaction core boundary.

   Add intents, transaction result types, repository interfaces, object
   quarantine, ref/head repositories, version index repositories, audit
   repositories, and projection interfaces. The first implementation must
   be structured as the final Git-native write core, not as a facade over
   the historical MUT write path.

   Existing `direct_writer`, history manager, audit manager, and graft
   hook code may be mined for algorithms and carefully moved behind the
   new interfaces. The dependency direction must be:

   ```
   adapters -> Git-native TransactionEngine -> repositories/projection
   ```

   never:

   ```
   adapters -> facade -> old router/direct_writer publish path
   ```

3. Move Product Operations onto intents.

   Keep the public `MutOps`/content API stable, but make it produce
   `OperationWriteIntent` and call the engine. This should preserve the
   current narrowest-scope routing behavior while moving publish
   authority out of `services/ops.py` and `services/direct_writer.py`.

4. Move native MUT push behind the adapter boundary.

   Keep legacy routes and response shapes, but remove direct publish
   authority from router-level `handle_push` paths. Native MUT submission
   becomes `VersionSubmissionIntent` plus legacy response mapping.

5. Expose the Git adapter behind `protocol_mode`.

   Implement Git fetch/clone/push against the same engine and read views.
   The feature flag only controls request admission and advertised URLs.
   The first acceptance path is the ordinary Git command flow against an
   access-point Git URL:

   ```
   git clone https://<host>/git/ap/<access_key>.git
   cd <repo>
   git add <paths>
   git commit -m "message"
   git push origin main
   git fetch origin
   git pull --ff-only
   ```

   The same flow must work for project/root-scope remotes and scoped
   remotes. Each remote remains scope-bound; scoped remotes see only their
   projected worktree. Read-only access points can fetch/clone but receive
   a Git-native push rejection; identity-bound access points reject
   mismatched Git HTTP actors before refs are advertised or packs are
   accepted.

6. Make accepted-write publish atomic.

   Add or formalize `version_transactions`, `outbox`, and repository
   methods so accepted-write ref/head, version index, audit, and outbox
   are recorded in one authoritative database transaction.

7. Retire old direct-publish paths.

   Once Git, MUT, and Product Operation adapters all call the engine,
   remove or quarantine any code path that can advance scope state,
   project refs, version index, or accepted-write audit outside the
   transaction engine.

8. Prove concurrency and graft acceptance cases.

   Before considering the migration complete, test at least:

   - two sibling scopes push concurrently and both land without waiting on
     a repository-wide lock;
   - a root-scope write and child-scope write land without the root write
     overwriting the child scope;
   - a Git push touching multiple scopes is rejected with a clear message
     telling the caller to split the work across scope remotes;
   - the project Git view shows the grafted result after both writes;
   - project Git history includes child-scope commits through history
     graft/projection;
   - a scoped Git clone/fetch cannot obtain objects outside its scope.

### 19.4 Definition of Done

The migration is complete when:

- MUT native clients and Git clients can both submit changes to the same
  project without producing divergent histories;
- switching `protocol_mode` requires no server-side version data
  migration;
- all write paths produce Git-compatible commits, trees, blobs, and refs;
- standard Git commands can push to PuppyOne and fetch the resulting
  project or scope view;
- new projects default to Git protocol mode;
- one Git/MUT push is accepted for one scope only; cross-scope changes are
  split by the caller into separate pushes;
- PuppyOne audit joins cleanly to version facts through transaction and
  commit identifiers;
- scope projection, subtree graft, and history graft behavior remain at
  least as complete and safe as the current DB-authoritative MUT
  implementation;
- sibling scopes can write concurrently without a root/project lock;
- no adapter can publish refs, scope state, version index, or accepted
  audit rows directly.
