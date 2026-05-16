# Git Kernel Migration Plan

> Status: Dependency-removal pass implemented; architecture hardening remains
>
> Date: 2026-05-16
>
> Goal: remove `mutai` as a production core dependency while preserving
> PuppyOne's scoped collaboration semantics, optimistic CAS behavior,
> S3-compatible object storage, conflict workflow, audit trail, and Git
> protocol compatibility.

Implementation checkpoint:

- Backend source and `backend/tests` no longer import external `mut.*`.
- `mutai`, local `../../mut`, and the GitHub `mut.git` install override
  have been removed from backend dependency and deploy files.
- Legacy MUT compatibility now lives in PuppyOne-owned
  `backend/src/mut_engine/adapters/mut/`.
- The current executable architecture is documented in
  [01-version-engine.md](01-version-engine.md).

---

## 1. Decision

PuppyOne should use Git as the version kernel.

That means:

- Git owns object, tree, commit, ref, pack, fsck, and clone/push protocol
  semantics.
- PuppyOne owns write admission, scope policy, optimistic merge policy,
  conflict policy, audit, outbox, project projections, and product APIs.
- Legacy MUT payloads are translated at the edge into the same version
  transaction intents used by Git and product writes.
- `mutai` must not be imported by core transaction, storage, or product
  code after the migration. Any remaining MUT compatibility lives behind a
  legacy adapter boundary.

The target is not "MUT with a Git facade". The target is "Git version
facts with PuppyOne transaction semantics".

## 2. Non-Negotiable Product Contracts

The migration is only correct if these behaviors continue to hold.

### 2.1 Scope and Concurrency

- A project has one global tree and many scoped views.
- `scope_hash` remains the CAS key for a scope row.
- `root_hash` or its Git-tree successor remains the global read source.
- Scope heads and CAS state must update atomically.
- Different scopes can publish concurrently when they touch different
  paths.
- Parent and child scopes both see each other's committed changes through
  global tree grafting or the Git-backed equivalent.
- The serial section of a write remains the DB compare-and-swap, not the
  whole push.

This preserves the current high-concurrency property: expensive work
such as object validation, tree construction, merge calculation, and S3
I/O can run in parallel; only the final state transition is serialized.

### 2.2 Git Push Into a Sub-Scope

A scoped Git push must still follow the PuppyOne path:

```text
git receive-pack
  -> quarantine and fsck
  -> extract submitted commit/tree
  -> resolve actor, access point, scope, and base
  -> VersionSubmissionIntent
  -> GitNativeTransactionEngine
  -> optimistic merge / conflict pending / reject
  -> atomic scope publish
  -> global tree projection
  -> audit and outbox
```

The Git client is allowed to submit Git-native commits. It is not allowed
to bypass PuppyOne scope policy or conflict policy.

### 2.3 Conflict Semantics

- Non-overlapping path edits should merge automatically.
- True same-file conflicts can produce a pending conflict instead of
  corrupting history.
- Manual-review conflict records must remain first-class product state.
- Server-side merge decisions must be auditable.
- Client-submitted merge commits should remain rejected or explicitly
  policy-gated until the product supports them intentionally.

### 2.4 Storage Safety

- Object writes are fail-loud. A commit must not publish if required
  objects were not durably stored.
- Git object bytes must verify against their object id.
- The root projection must be rebuilt from authoritative DB state, not
  from a silently partial object-store read.
- Object GC must preserve all roots reachable from active refs, pending
  conflicts, version index entries, and outbox work.

### 2.5 Latency

The migration must protect the current 5 to 6 second class target for
normal scoped Git writes.

Avoid:

- whole-project locks,
- full-tree flattening on every single-file read,
- serializing unrelated scope writes,
- replacing S3-compatible storage with a single local bare repository as
  the only source of truth,
- round-tripping through legacy MUT protocol objects in the hot path.

## 3. Target Architecture

```text
External write surfaces
=======================

Git Smart HTTP      Product API / Web / CLI      Legacy MUT API
     |                       |                         |
     v                       v                         v
Git adapter          Operation adapter          Legacy MUT adapter
     |                       |                         |
     +-----------------------+-------------------------+
                             |
                             v
              Version Transaction Engine
              --------------------------
              - scope policy
              - actor and AP authorization
              - base/current validation
              - optimistic CAS retry loop
              - merge and conflict policy
              - canonical commit decision
              - atomic publish
              - audit and outbox
                             |
                             v
Storage and state ports
-----------------------
- Git object store on S3
- Git tree and commit service
- Ref/scope state repository
- Version index repository
- Audit repository
- Conflict repository
- Outbox repository
```

The important boundary is the port between the transaction engine and
Git storage. Domain code should ask for operations like "read tree",
"write object", "compare trees", "materialize quarantine", and "publish
scope head". It should not know whether the implementation uses git CLI,
Dulwich, pygit2, or an S3-backed Git object store.

## 4. Recommended Module Boundary

Use the current `mut_engine` package during the migration to avoid a
large rename. Introduce clearer submodules first.

```text
backend/src/mut_engine/
  application/
    transaction_engine.py        # keep as write authority
    intents.py                   # VersionSubmissionIntent, OperationWriteIntent
  domain/
    scope_policy.py
    conflict_policy.py
    merge_policy.py
    publish_result.py
  ports/
    git_objects.py               # object/tree/commit/ref interfaces
    scope_state.py
    audit.py
    conflict_store.py
    outbox.py
  adapters/
    git_http/
      upload_pack.py
      receive_pack.py
      quarantine.py
    product_ops/
      ops.py
      file_uploads.py
    legacy_mut/
      protocol_mapper.py
      snapshot_mapper.py
    storage/
      s3_git_object_store.py
      supabase_scope_state.py
      supabase_audit.py
```

`legacy_mut/` is the only place allowed to import legacy MUT protocol
objects after the adapter phase. After the dependency-removal phase, even
that code should use internal DTOs or vendored compatibility code.

## 5. Migration Phases

### Phase 0: Contract Freeze

Duration: 1 to 2 days.

Deliverables:

- Add contract tests for scoped concurrency, Git push behavior, conflict
  pending, S3 object safety, and file-upload staging.
- Mark current behavior that must survive the migration.
- Add import guard tests so new core modules cannot import `mut.*`.

Exit criteria:

- We can run a focused test suite that proves the product semantics.
- The suite fails if a change removes CAS retry, graft/projection,
  conflict pending, or Git loose object validity.

### Phase 1: Introduce Ports Without Behavior Change

Duration: 2 to 4 days.

Deliverables:

- Add internal DTOs for version submissions, object refs, tree entries,
  conflict outcomes, and publish results.
- Wrap existing `mutai` object/tree/protocol calls behind PuppyOne ports.
- Move direct imports of `mut.*` out of product code and into adapter
  implementations.
- Keep existing behavior and storage unchanged.

Exit criteria:

- Product routers, fileworker, connectors, and transaction engine depend
  on PuppyOne interfaces, not `mutai`.
- Existing tests pass without changing production semantics.

### Phase 2: Replace Low-Level `mutai` Usage With Git Implementations

Duration: 4 to 7 days.

Deliverables:

- Replace `mut.foundation.git_format` usage with PuppyOne-owned Git
  object encode/decode helpers or a Git library facade.
- Replace tree walking and flattening with Git tree service operations.
- Replace legacy object store types with `GitObjectStore` and
  `GitTreeService` ports.
- Keep S3 as canonical storage for Git loose objects and future pack
  objects.

Exit criteria:

- Core code can import and run without installing `mutai`.
- Git object ids, object bytes, and tree entries are validated by Git
  tooling or library-backed tests.
- File upload staging writes valid Git loose blob objects.

### Phase 3: Isolate Legacy MUT Protocol

Duration: 3 to 5 days.

Deliverables:

- Move MUT clone/pull/push request parsing into `adapters/legacy_mut`.
- Translate legacy snapshots into `VersionSubmissionIntent` or
  `OperationWriteIntent`.
- Remove publish authority from legacy handlers.
- Add a feature flag to disable legacy MUT endpoints in staging.

Exit criteria:

- Legacy clients still work through the adapter.
- The adapter cannot advance refs or scope state directly.
- Disabling the adapter does not break Git or product writes.

### Phase 4: Harden Git Pack and Quarantine Path

Duration: 4 to 8 days.

Deliverables:

- Keep using real `git` plumbing for receive-pack and upload-pack
  validation where it is already reliable.
- Make quarantine promotion explicit and idempotent.
- Add pack-object handling if loose-object-only storage becomes a
  latency bottleneck.
- Add object reachability checks before promotion.
- Add metrics around object count, bytes promoted, fsck duration, CAS
  retry count, conflict rate, and end-to-end write latency.

Exit criteria:

- `git clone`, `git fetch`, and scoped `git push` pass against staging.
- A failed push leaves no published scope state.
- Retrying the same push is idempotent or cleanly rejected.

### Phase 5: Remove External `mutai` Dependency

Duration: 1 to 2 days after previous phases.

Deliverables:

- Remove `mutai` from `pyproject.toml`, `uv.lock`, Docker/Nixpacks
  install steps, and Railway build assumptions.
- Add CI checks that fail on `from mut.` or `import mut` outside allowed
  legacy test fixtures.
- Delete or archive unused compatibility code.

Exit criteria:

- Backend builds from a clean checkout without access to the external
  `mut` repository.
- Fileworker, API, worker, and frontend checks no longer depend on
  `mutai` availability.

## 6. Complexity Assessment

This is a high-impact refactor, but it is not a full rewrite.

The reason it is tractable is that the hardest product decision layer
already exists in `GitNativeTransactionEngine`: scoped write admission,
optimistic retry, conflict handling, publish result construction, audit,
and outbox scheduling are already centralized enough to preserve.

Estimated effort:

| Track | Complexity | Estimate |
| --- | --- | --- |
| Contract tests and import guardrails | Medium | 1 to 2 days |
| Port/interface extraction | Medium-high | 2 to 4 days |
| Git object/tree replacement | High | 4 to 7 days |
| Legacy MUT adapter isolation | Medium-high | 3 to 5 days |
| Git quarantine and pack hardening | High | 4 to 8 days |
| Staging, load tests, observability | Medium-high | 3 to 5 days |
| Dependency removal and cleanup | Low-medium | 1 to 2 days |

Realistic total:

- Minimal removal of external `mutai` from production builds: about 1
  week if we vendor or quickly replace only the low-level helpers.
- Safe architecture migration preserving product contracts: about 2 to 4
  weeks.
- Fully hardened Git-backed storage with pack optimization, staging load
  tests, and operational metrics: about 4 to 6 weeks.

The main risk is not code volume. The main risk is accidentally changing
the semantics of scope publication, merge retries, or root projection.
That is why contract tests must come first.

## 7. What We Should Not Do

- Do not implement our own Git kernel.
- Do not keep `mutai` as an implicit production dependency hidden inside
  fileworker or storage code.
- Do not let Git adapters publish directly to DB state.
- Do not replace optimistic CAS with coarse locks.
- Do not make root scope a global write mutex.
- Do not make S3 a best-effort cache behind a local bare repository if
  S3 compatibility remains a product requirement.
- Do not do a big-bang package rename before the ports are stable.

## 8. Acceptance Test Matrix

These tests should exist before replacing the core dependency.

| Scenario | Expected result |
| --- | --- |
| Two same-scope pushes edit different files | Both changes are preserved after CAS retry if needed |
| Two same-scope pushes edit the same file | Auto-merge or pending conflict according to policy |
| Child scope Git push, root scope clone | Root view sees child changes |
| Root scope Git push into child path, child clone | Child view sees relevant root changes |
| Unrelated scopes push concurrently | No global serialization, both publish |
| CAS loser retries | Retry uses latest DB-authoritative state |
| S3 object write fails | No scope head, root projection, audit success, or outbox success is published |
| File upload staging | Stored object is a valid Git loose blob and decodes to uploaded bytes |
| Git fsck rejects corrupt pack | Push is rejected and no state advances |
| Pending conflict exists | Object GC preserves objects referenced by pending conflict |
| Legacy MUT push | Translates to transaction intent and uses the same publish path |
| `mutai` absent from environment | API, fileworker, and workers import successfully |

## 9. Implementation Order

Recommended first PRs:

1. Add contract tests and import guardrails.
2. Add PuppyOne-owned Git object helpers and ports.
3. Move fileworker blob staging to the Git object helper.
4. Move transaction engine and storage types off direct `mutai` imports.
5. Move legacy protocol DTOs behind `adapters/legacy_mut`.
6. Remove `mutai` from build dependencies once imports are gone.

This order keeps production behavior stable while progressively shrinking
the surface area that can break from `mutai` package drift.

## 10. Operational Metrics

Add or preserve these metrics during migration:

- receive-pack total duration,
- quarantine fsck duration,
- object promotion duration and byte count,
- CAS retry count,
- conflict-pending count,
- S3 put/get error count,
- root projection duration,
- outbox enqueue failures,
- fileworker import/startup failure,
- end-to-end scoped Git push latency.

The migration is successful only if correctness survives and normal
scoped writes stay within the existing latency class.
