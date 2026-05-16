# PuppyOne Version Engine — Supplement (Post-Meeting Addendum)

> Companion to [01-version-engine.md](01-version-engine.md). This document
> captures decisions taken **after** that document was written and lists the
> implementation gaps that remain in the `qubits` branch. Where this document
> and 01-version-engine.md disagree, **this document supersedes**. Other
> documents (00-vision, 01-mut-engine, 02–06) are left untouched and should be
> read together with this supplement.

---

## 1. Positioning Update

PuppyOne is a **new kind of Git server** — analogous to GitHub for stock Git
clients, but with the collaboration semantics that the legacy MUT server used
to provide. The product role of MUT server is preserved; only its wire
protocol, client, and Python package are dropped.

| Layer | Old role (MUT era) | New role |
|-------|--------------------|----------|
| Client / wire protocol | `mut` CLI + MUT HTTP protocol | Stock `git` CLI + Git smart HTTP/SSH |
| Server role | MUT server | PuppyOne Git server (this codebase) |
| Server mechanisms | Scope/auth tiering, CAS, subtree graft, conflict policy, audit, access points, channel pause, hosted resolver agents | **Kept and reimplemented in Git terms inside `mut_engine`** |
| Internal package name | `mut_engine` | `mut_engine` (name retained, but it is now the Git-native Version Transaction Engine) |

The user-facing brand promise becomes:

> Use any `git` client against PuppyOne. The server still does scope-aware
> auth, scoped views, server-side merge under PuppyOne policy, audit, and
> centralized conflict resolution.

This is consistent with the spirit of 01-version-engine.md, but goes one step
further: the **legacy MUT adapter is removed**, not just demoted. There is
no longer a `protocol_mode = mut` or `protocol_mode = both` value. There is
exactly one user-visible protocol surface: Git (plus the internal Product
Operation Adapter for PAPI / Web / `puppyone fs` CLI / connectors / agents).

---

## 2. MUT Server Mechanisms To Preserve (Reimplemented Over Git)

These are the parts of the old MUT server design that must survive the
migration. Each is already partially in `mut_engine` on the `qubits` branch;
the migration job is to make sure none of them depends on the legacy MUT wire
protocol or the `mut` Python package.

1. **Scope hierarchy as a first-class server concept**
   - `(project_id, scope_path) → head_commit_id, scope_hash` in
     `mut_scope_state`.
   - Narrowest-scope routing for writes (a write at a path owned by a child
     scope lands in that child scope).
   - Access points bound to one scope with `path / exclude / mode`.

2. **Centralized auth and access-point tiering**
   - One Access Point credential → one project + one scope + one mode.
   - Identity-bound APs, read-only APs, paused channels — all enforced by the
     server before refs are advertised or packs are accepted, on **both** Git
     and Product/PAPI paths.

3. **Per-scope optimistic CAS publish**
   - `scope_hash + head_commit_id` is the CAS pre-image.
   - No global repo lock. Sibling scopes commit concurrently.
   - CAS-loss reloads scope head and re-enters policy/merge.

4. **DB-authoritative subtree graft**
   - The project worktree is a projection over current scope heads, never an
     independent root.
   - Failure modes (S3 partial reads, missing scope) fail loud, not silently
     produce an empty/partial tree.

5. **History graft (project-view commit projection)**
   - Child scope commits appear in the parent / project Git history for actors
     who can see that view.
   - The mapping (canonical scope commit ↔ project-view commit) lives in
     `mut_version_index`.

6. **Active conflict resolution at the server**
   - Conflict policy is server-owned, not client-owned.
   - Unsafe conflicts produce a pending transaction with full base/current/
     proposed records, reviewed at the source side, not silently overwritten
     by the last writer.
   - Hosted resolver agents are consumers of pending events and producers of
     resolution intents; they never publish refs directly.

7. **Audit as a separate ledger**
   - Audit rows describe attempts (actor, channel, policy, status), Git
     history describes accepted content. Rejected/pending rows have no
     commit id.

8. **Atomic publish boundary**
   - Accepted-write ref/head + version index + transaction state + audit row +
     outbox event are inserted in one SQL transaction.

9. **Outbox repair loop**
   - Synchronous post-commit hooks for read-your-write, durable outbox for
     replaying projection / notifications / resolver dispatch when the
     synchronous path fails.

10. **Conservative object GC**
    - Mark from durable DB roots; protect unknown-age objects; dry-run by
      default.

---

## 3. MUT Wire Protocol And Client — Drop Completely

There is no MUT-compatibility surface in the final system.

Deleted:

- The `mut` Python package's wire-protocol modules:
  `mut.core.protocol` (PushRequest/PushResponse/RollbackRequest/...),
  `mut.server.handlers` (handle_clone / handle_pull / handle_negotiate /
  handle_scopes), `mut.server.server`, `mut.server.sync_queue`,
  `mut.foundation.transport`, `mut.foundation.ws_client`.
- The `mut` CLI (`mut clone / commit / push / pull / log / rollback / ...`).
- PuppyOne routers serving the MUT wire protocol:
  `backend/src/mut_engine/routers/protocol_router.py` and the MUT-equivalent
  endpoints inside `routers/access_point.py`
  (`/api/v1/mut/...` and `/api/v1/mut/ap/{access_key}/{clone,pull,...}`).
- PuppyOne adapters under `backend/src/mut_engine/adapters/mut/`.
- The `projects.protocol_mode` field's `mut` and `both` enum values (the
  field can either be dropped entirely or constrained to `git` only).
- Documentation framing MUT as the data plane (notably 00-vision.md and
  03-cli.md still say this; they are intentionally not rewritten in this
  pass, but new readers should treat **this supplement** as authoritative).

Kept (as internal git-format / Merkle utilities, no longer a separate
protocol):

- `mut.foundation.git_format` (commit/tree/blob encoding)
- `mut.foundation.hash`
- `mut.core.object_store`, `mut.core.tree`
- `mut.core.merge` (IdenticalStrategy, JsonMergeStrategy, LineMergeStrategy, …)
- `mut.core.diff`
- `mut.core.scope` / `mut.core.ignore` (insofar as they are independent of
  the wire protocol)

These must be moved into the PuppyOne backend (recommended location:
`backend/src/mut_engine/infrastructure/`) so PuppyOne no longer depends on
the `mut` package at all. The MUT repo itself can either be archived or kept
as a vendor source for the migration, not as a runtime dependency.

---

## 4. Service Layer vs Protocol Layer

PuppyOne is split into two clear layers:

```
                    ┌──────────────────────────────────────────┐
                    │            Service Layer                  │
                    │                                           │
Service-layer       │  - Third-party data ingestion             │
adapters            │  - Local-folder client sync               │
(connectors,        │  - SaaS connectors (Notion/GitHub/...)    │
ingest, ETL,        │  - File ETL / OCR / chunking              │
agents)             │  - Format conversion (the "adaptor layer" │
                    │     for import/export)                    │
                    │                                           │
                    │  Produces / consumes scoped FS content    │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │           Protocol Layer                  │
                    │                                           │
Protocol-layer      │  - Git smart HTTP / SSH                   │
adapters            │  - PuppyOne FS CLI (`puppyone fs ...`)    │
                    │  - PAPI / Web content APIs                │
                    │                                           │
                    │  Translates external requests into        │
                    │  intents that converge in                 │
                    │  GitNativeTransactionEngine               │
                    └───────────────────────────────────────────┘
```

To avoid term collision with 01-version-engine.md (which uses "adapter" to
mean protocol adapter only), this document standardizes:

- **Protocol Adapter** — Git adapter, Operation/Product adapter, FS CLI
  adapter. Lives under `backend/src/mut_engine/adapters/`.
- **Service Adapter** (a.k.a. **Connector Adapter** / **Source Adapter**) —
  third-party connectors, local-folder sync, ingest jobs, format converters.
  Lives under `backend/src/connectors/`, `backend/src/ingest/`, and
  cross-cutting `service-adapter` modules.

Both layers ultimately write through `GitNativeTransactionEngine` via the
Product Operation Adapter (`MutOps` / `OperationWriteIntent`).

---

## 5. Local ↔ Cloud Context Bridging

PuppyOne client = the user's local environment (laptop, dev machine, sandbox,
hosted agent box). PuppyOne server = the cloud Git server.

Three new requirements that go beyond stock GitHub:

1. **`.gitignore` decides what stays local.** Standard Git semantics apply.
2. **Tracked-but-unpushed local files must still be queryable from the
   cloud.** That is, the cloud needs visibility into the client's working
   tree state even before `git push`. Concretely:
   - A lightweight local daemon (or `puppyone` CLI integration) reports the
     local Git index/blob hashes and path manifest under a per-user,
     per-machine namespace.
   - The server stores this as a **shadow snapshot** (per `(project_id,
     user_id, machine_id, ref)`), not as an authoritative scope head.
   - Cloud agents can `puppyone fs grep / find / cat` against shadow
     snapshots subject to permissions.
3. **Cloud agents can read local context; local agents can read cloud
   context.** The shadow snapshot mechanism, plus existing scoped Git URLs,
   provides both directions.

Privacy & permission model for shadow snapshots:

- Shadow content is **user-private** by default: only the user (and admins
  the user permits) can see it.
- A user may opt-in to **promote** a shadow snapshot to a team-visible
  staging scope.
- Scope `exclude` and access-point `mode=r` still apply.

Open: exactly how shadow snapshots become part of context retrieval (vector
index? full-text? metadata only?) is left to a future spec; see TODO doc.

---

## 6. FS CLI Performance — Server-Side Indexing

`puppyone fs grep / find / ls -R` must scale to large enterprises and large
file counts. The current on-line tree walk in `routers/access_point_fs.py`
is the V0 implementation only.

Requirements:

- **Path index**: per project, per scope, prefix-searchable, refreshed on
  every accepted write transaction (via outbox).
- **Content full-text index**: text blobs indexed (Supabase pg_trgm /
  tsvector, or Turbopuffer for vector + lexical), refreshed asynchronously.
- **Metadata index**: size, mtime, MIME, who-last-modified.
- **Indexes are derived state**, not source of truth. They can be rebuilt
  from `mut_scope_state` + S3 objects.
- **Permission filter at query time**, not index time, so the same index
  serves multiple access points.

Refresh path:

```
accepted write
  -> publish_mut_scope_update (atomic SQL txn)
  -> outbox row 'version_committed'
  -> outbox worker:
       - graft project view
       - update path / metadata index
       - enqueue content full-text reindex
```

---

## 7. Parent / Child Scope Conflict Rule (Supplements §9 of 01)

01-version-engine.md §9 sets V1 conflict policy to "safe auto-merge,
otherwise manual review." This supplement adds a parent/child scope rule
that runs **before** the manual-review path.

**Rule 7.A — Same path, parent vs child scope, both modified**

When a write to a child scope and a write to its parent scope both touch the
same file at the same region:

- **The parent scope wins.** Its content is kept.
- The child scope's conflicting change is recorded as a rejected attempt in
  the audit log (status `superseded_by_parent`), with full diff metadata so
  the child-scope actor can review and re-apply on top.

**Rule 7.B — Child scope advance propagates to parent**

When a child scope advances (any accepted write), the parent scope's
**project-view projection** is automatically refreshed:

- A derived parent-scope commit is synthesized whose tree reflects the new
  child subtree.
- The parent scope's `head_commit_id` is bumped (`version + 1`) with a
  `Source: scope-promote` trailer.
- This is **not** a write that locks unrelated paths in the parent scope; it
  is a projection-style commit that only changes the subtree path owned by
  the child scope.

**Rule 7.C — All other conflicts fall back to LWW**

After parent-scope wins and same-content/one-side/JSON-different-keys/
non-overlapping-line auto-merges, anything left over follows
**last-write-wins** (LWW) — the latest accepted transaction overwrites the
earlier one, and the overwritten state is preserved in audit.

This overrides the V1 default in 01-version-engine.md §9.0 ("any unsafe
conflict becomes pending manual review"). The new V1 default is:

> safe auto-merge → parent-scope-wins → LWW.
>
> `manual_review` becomes an opt-in policy that admins may enable per
> project / scope / path glob.

**Interaction with 01 §7.2 (single-scope writes, no cross-scope locks)**:
Rule 7.B does **not** introduce a cross-scope lock. The parent scope's bump
is a derived commit emitted by the post-commit hook (synchronously for
read-your-write on the affected paths only) and recorded in
`mut_version_index`. It does not serialize unrelated parent-scope writes;
the parent scope still uses its own per-scope CAS.

**Interaction with 01 §12 (root is derived projection)**: Rule 7.B does
change the parent scope's `head_commit_id`, which is technically a real
scope head, not a pure derived projection. This is an explicit design
divergence from "root is purely derived": **for promote commits, the parent
scope's head becomes a real Git commit object whose tree matches the
projection at that moment.** This keeps `git log` on the parent scope
honest: a user pulling the parent scope sees the child's change as a real
commit in the parent history.

---

## 8. Conflicts With 01-version-engine.md That This Doc Supersedes

| 01 reference | Original statement | Superseded by |
|---|---|---|
| §1.1, §4.2, §10.x, §19.x | "Keep native MUT clients working through a legacy protocol adapter." | This doc §3 — MUT wire protocol and adapter removed entirely. |
| §7.5 | `protocol_mode = "mut" \| "git" \| "both"` | This doc §3 — field dropped or restricted to `git`. |
| §9.0 | V1 policy = safe auto-merge → manual_review | This doc §7 — V1 policy = safe auto-merge → parent-scope-wins → LWW; manual_review is opt-in. |
| §12.5 (No Split Roots) implicitly forbids parent scope from advancing in response to a child write | Parent scope head is allowed to advance via promote commits (this doc §7.B). | Doc §7 — explicit, narrow exception with derived-commit semantics. |
| §16 URL surface lists `/api/v1/mut/...` | Routes deleted. | This doc §3. |

01-version-engine.md is left unchanged so historical context remains
auditable. Implementation work must consult **this supplement** for the
authoritative rules.

---

## 9. Open Design Questions (Resolve Before Implementation)

1. **Shadow snapshot indexing depth.** Path + metadata only, or also content
   full-text? Affects client bandwidth and server storage cost.
2. **Shadow snapshot retention.** Per-user TTL, or "until ref moves on the
   server"? GC story.
3. **Promote-commit author attribution.** When the parent scope advances
   because the child scope advanced, whose `who` lands in the parent commit?
   Proposal: original child actor + trailer `Source: scope-promote`.
4. **Manual-review policy activation surface.** Admin JSON file, project
   settings UI, or both? Where does it live so it cannot be modified by a
   regular pusher.
5. **`puppyone` CLI vs stock `git` CLI sugar.** Do we ship `puppyone git
   clone <project>` as a shortcut that resolves the access point URL, or
   keep the user on raw `git clone https://host/git/ap/...`?
6. **Service Adapter naming.** "Connector" already overloaded with SaaS
   connectors. Proposed split: `connectors/` = SaaS, `service-adapters/` =
   format converters / shadow-snapshot daemon / bulk import jobs.
7. **mut.* utility code home.** Move into
   `backend/src/mut_engine/infrastructure/` (recommended) or extract as a
   private internal package? Affects test imports and CI build.

---

## 10. Definition of Done (Supersedes 01 §19.4)

The migration is complete when **all** of the following hold:

- No Python module in `backend/src/` imports from the `mut` package.
- `routers/protocol_router.py`, `adapters/mut/`, and any
  `/api/v1/mut/...` route are deleted (or returning 410 Gone for a
  deprecation window, with no engine dispatch).
- `projects.protocol_mode` is either dropped or constrained to `git` only;
  no engine code reads it.
- Standard `git clone / fetch / pull / push / log / diff / checkout` work
  against a PuppyOne Git URL (access-point bound and project bound).
- Scoped Git clones cannot leak hidden paths or objects.
- Sibling-scope concurrent pushes both succeed without root locking.
- Parent-scope-wins rule (7.A) and child-promotes-parent rule (7.B) are
  exercised by acceptance tests, and parent-scope reads see promoted
  child-scope changes immediately.
- Conflict resolution (manual or agent) re-enters the publish pipeline via
  `ConflictResolutionIntent`, with structured conflict records persisted in
  a dedicated table.
- Accepted-write ref/head + `mut_commits` + `mut_version_index` +
  `audit_logs` + `mut_version_outbox` + (new) `version_transactions` insert
  in one SQL transaction.
- `puppyone fs grep / find` are backed by a server-side index, not on-line
  tree walks, for project sizes ≥ 100k files.
- Shadow snapshots from local clients are queryable from the cloud subject
  to per-user permissions.
- Documentation reflects the new model: this supplement is normative;
  00-vision.md and 03-cli.md are either rewritten or annotated as legacy.

---

## 11. Cross-References

- [01-version-engine.md](01-version-engine.md) — architecture base.
- [02-access-points.md](02-access-points.md) — Access Point auth model
  (still applies; Git URLs are access-point bound).
- [04-connectors.md](04-connectors.md) — service-layer ingestion (rename
  internally to "Service Adapter / Connector Adapter").
- [07-version-engine-todo.md](07-version-engine-todo.md) — implementation
  TODO list keyed to this supplement.
