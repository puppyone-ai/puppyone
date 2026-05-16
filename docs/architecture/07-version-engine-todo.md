# Version Engine Migration — TODO

> Action list for the work described in
> [07-version-engine-supplement.md](07-version-engine-supplement.md) and
> [01-version-engine.md](01-version-engine.md). Grouped by area; each item is
> sized to be roughly a PR-shaped unit of work.
>
> Priority key:
> - **P0** — blocks the new Git-server model from being correct or shippable.
> - **P1** — required for parity with old MUT server behavior.
> - **P2** — quality / performance / cleanup; not blocking initial rollout.
>
> Status key:
> - ☐ not started
> - ◐ partially done on `qubits` (needs completion)
> - ☑ done (listed here so the doc is a complete picture)

---

## A. Remove MUT wire protocol and `mut` package dependency

| # | Status | P | Item |
|---|--------|---|------|
| A1 | ☐ | P0 | Delete `backend/src/mut_engine/routers/protocol_router.py` and its mount in `main.py`. |
| A2 | ☐ | P0 | Delete `backend/src/mut_engine/adapters/mut/` (push_adapter, rollback_adapter, `__init__`). |
| A3 | ☐ | P0 | Delete MUT-protocol endpoints inside `backend/src/mut_engine/routers/access_point.py` (`/clone`, `/pull`, `/negotiate`, `/scopes`, `/push`, `/rollback`); keep AP CRUD and key resolution. |
| A4 | ☐ | P0 | Remove all `from mut.core.protocol import ...` (PushRequest, PushResponse, RollbackRequest, RollbackResponse, require_supported_protocol, PROTOCOL_VERSION). Audit list (from grep): `mut_engine/adapters/mut/*`, `mut_engine/routers/access_point.py`, `mut_engine/routers/protocol_router.py`, `mut_engine/services/ephemeral_client.py`. |
| A5 | ☐ | P0 | Remove all `from mut.server.handlers import ...` (handle_clone, handle_pull, handle_negotiate, handle_scopes). Audit: `access_point.py`, `protocol_router.py`, `services/ephemeral_client.py`. |
| A6 | ☐ | P0 | Remove `mut.server.scope_manager.ScopeManager` / `ScopeBackend` imports from `server/server_repo.py`, `server/backends/supabase_scope.py`. Reimplement as a PuppyOne-owned ScopeRegistry. |
| A7 | ☐ | P0 | Replace `mut.core.merge.ConflictResolver` import in `server/repo_manager.py` with a PuppyOne-internal resolver (the V1 conflict policy already does this; finish the wiring). |
| A8 | ☐ | P0 | Move git-format / Merkle utilities into `backend/src/mut_engine/infrastructure/`: `git_format`, `hash`, `object_store` interface, `tree`, `merge` strategies, `diff`. After move, fix all callers; `mut` package becomes zero imports in `backend/src/`. |
| A9 | ☐ | P0 | Delete `backend/src/mut_engine/services/ephemeral_client.py` (MutEphemeralClient) and replace its remaining callers with `MutOps`/Git-engine writes. |
| A10 | ☐ | P0 | Delete or archive `mut/` repo (the standalone client). Remove its packaging from any docker/nixpacks/uv lockfile referencing `mutai` PyPI source. |
| A11 | ☐ | P1 | Drop `projects.protocol_mode` (new migration) **or** restrict its CHECK to `('git')` and stop reading it in code. Remove `application/protocol_mode.py` if dropped. |
| A12 | ☐ | P1 | Delete `backend/src/mut_engine/services/object_compat.py` (legacy MUT raw-tree object compat) once all callers go through git-format objects. |

---

## B. Engine core completion (transactions, conflicts, resolution)

| # | Status | P | Item |
|---|--------|---|------|
| B1 | ☐ | P0 | Add `ConflictResolutionIntent` to `domain/intents.py` with fields per 01 §5.3 (transaction_id, resolver_actor, resolution_tree_id, resolution_message, decision). |
| B2 | ☐ | P0 | Add `version_transactions` Supabase table: `id, project_id, scope_path, status, source_channel, actor, base_commit_id, client_commit_id, proposed_tree_id, current_head_at_start, policy, created_at, updated_at, committed_commit_id`. RLS service-role only. |
| B3 | ☐ | P0 | Add `mut_conflicts` Supabase table per 01 §9.2: `id, transaction_id, project_id, scope_path, base_tree_id, current_tree_id, proposed_tree_id, changed_paths JSONB, conflict_records JSONB, policy, status, resolver_actor, resolver_kind, created_at, resolved_at`. |
| B4 | ☐ | P0 | Wire `_record_pending_conflict` in `application/transaction_engine.py` to insert into `mut_conflicts` (instead of one row in `audit_logs`) and return `pending_conflict_id` from the conflict table. |
| B5 | ☐ | P0 | Implement `GitNativeTransactionEngine.resolve(intent: ConflictResolutionIntent)` that loads the pending row, re-enters `_publish_scope_update` against current head, and writes an audit row `<channel>_push_resolved`. |
| B6 | ☐ | P1 | Make state transitions write `version_transactions` rows at: received, validated, policy_selected, rejected, pending_*, resolving, committed, retryable_conflict. |
| B7 | ☐ | P1 | Tighten publish atomicity: include `version_transactions` insert/update inside the same plpgsql RPC as the ref/head + `mut_commits` + `audit_logs` + `mut_version_outbox` write (extend `publish_mut_scope_update`). |
| B8 | ☐ | P1 | Implement `last_write_wins` outcome path (currently absent): keep the loser's content as a `lost_content` blob in `mut_conflicts` for restoration. |
| B9 | ☐ | P1 | Implement parent-scope-wins (supplement §7.A) inside conflict policy: when the same path/region is modified in a parent and a child scope, parent content wins; child's attempt is recorded as `superseded_by_parent` in `mut_conflicts` with full diff. |
| B10 | ☐ | P1 | Implement child-promotes-parent (supplement §7.B): after a child-scope commit lands, the post-commit hook synthesizes a derived parent-scope commit (real Git commit object, real `head_commit_id` bump, `Source: scope-promote` trailer), and inserts a `mut_version_index` row mapping child→parent. Must not lock unrelated parent paths. |
| B11 | ☐ | P1 | Add `select_conflict_policy` real implementation (per project/scope/path/glob/type/actor/source/operation). Source = admin control plane, never mutable repo content. Default policy after promote/LWW/auto-merge = `last_write_wins`; `manual_review` is opt-in. |
| B12 | ☐ | P1 | Inject server-commit trailers (01 §8.2) in `application/git_commit.py`: `PuppyOne-Transaction`, `PuppyOne-Source`, `PuppyOne-Scope`, `PuppyOne-Original-Commit`. Only on synthesized commits, never on preserved client commits. |
| B13 | ☐ | P2 | Hosted resolver agent dispatch: outbox event `pending_conflict_created` → resolver agent worker → produces `ConflictResolutionIntent`. Initially assistive (proposes only); admin gate for auto-publish. |
| B14 | ☐ | P2 | Per-scope local lock as overload-shedding valve (optional, behind config). Keep CAS as the correctness boundary. |

---

## C. Package layout to match 01 §3

| # | Status | P | Item |
|---|--------|---|------|
| C1 | ☐ | P1 | Create `backend/src/mut_engine/infrastructure/` and move `server/server_repo.py`, `server/backends/supabase_history.py`, `supabase_scope.py`, `supabase_audit.py`, `s3_storage.py` into `object_store.py`, `ref_repository.py`, `version_repository.py`, `audit_repository.py`, `scope_repository.py`, `transaction_repository.py`, `conflict_repository.py`, `outbox_repository.py`. |
| C2 | ☐ | P1 | Move `services/ops.py` (MutOps) to `adapters/operations/ops_adapter.py`. Keep `MutOps` name (compat). |
| C3 | ☐ | P1 | Move `services/hooks.py` graft logic into `application/root_projection.py` and `application/project_view_projection.py`. `services/hooks.py` becomes a thin orchestrator file or is deleted. |
| C4 | ☐ | P2 | Reduce or delete `services/direct_writer.py` (now a compat shim) once tests stop importing `apply_mutation`. |
| C5 | ☐ | P2 | Reduce or delete `backends/__init__.py:safe_data` re-export once consumers go through the new infrastructure modules. |

---

## D. Storage / Supabase migrations

| # | Status | P | Item |
|---|--------|---|------|
| D1 | ☐ | P0 | New migration: create `version_transactions` (see B2). |
| D2 | ☐ | P0 | New migration: create `mut_conflicts` (see B3). |
| D3 | ☐ | P0 | Update `publish_mut_scope_update` RPC to write `version_transactions` row in the same txn. Bump RPC signature; update Python caller. |
| D4 | ☐ | P0 | New migration: add structured columns to `audit_logs` per 01 §13: `transaction_id, canonical_commit_id, original_commit_id, project_view_commit_id, scope_view_commit_id, source_channel, policy, status`. Keep `commit_id` nullable. Backfill from existing `metadata` JSONB. |
| D5 | ☐ | P1 | New migration: drop `protocol_mode` from `projects` (or restrict to `git`). Remove `mut`/`both` from CHECK. |
| D6 | ☐ | P1 | New migration: indexes for `mut_conflicts` (project_id, status, scope_path) and `version_transactions` (project_id, status, created_at). |
| D7 | ☐ | P2 | New migration: `local_shadow_snapshots` table for client-side tracked-but-unpushed files (project_id, user_id, machine_id, ref, manifest JSONB, blob_hashes JSONB, updated_at). RLS: user-private by default. |
| D8 | ☐ | P2 | New migration: `fs_path_index` materialized table (project_id, scope_path, path, blob_hash, size, mime, last_who, last_commit_id, last_updated_at). Refreshed by outbox worker. |

---

## E. Git adapter polish

| # | Status | P | Item |
|---|--------|---|------|
| E1 | ◐ | P0 | Receive-pack already exists. Add: `committed` / `rejected` / `pending_resolution` outcome reporting via Git side-band messages, with pending URL pointing to a resolution UI (01 §10.3). |
| E2 | ◐ | P0 | Upload-pack already exists. Verify scoped clones strictly cannot serve objects outside scope (acceptance test). |
| E3 | ☐ | P1 | SSH transport (alongside smart HTTP), for compatibility with `git@host:project.git` style remotes. |
| E4 | ☐ | P1 | Support `git push` to non-`main` branches under a controlled policy (today only `refs/heads/main` is writable). At minimum, accept feature branches and project-owned PR refs. |
| E5 | ☐ | P2 | LFS handshake or explicit reject with clear error (current behavior: silent failure on large pack). |
| E6 | ☐ | P2 | Capability negotiation: support `agent`, `report-status-v2`, `delete-refs` (currently delete is rejected outright; either keep that or allow with a policy). |

---

## F. Service-layer (connector / ingest / agent) cleanup

| # | Status | P | Item |
|---|--------|---|------|
| F1 | ☐ | P0 | Audit every connector that writes (filesystem sync, Notion, GitHub, Gmail, GDrive, ingest jobs) to confirm it goes through `MutOps` / `OperationWriteIntent`. No connector may publish refs or call `mut` wire protocol. |
| F2 | ☐ | P0 | Replace OpenClaw / `filesystem` connector's "MUT clone" client behavior with a Git client driving `git clone https://host/git/ap/<key>.git`. |
| F3 | ☐ | P1 | Rename internal "Connector" term where it overlaps with Protocol Adapter, per supplement §4. Keep `connectors/` as the SaaS / data-source folder. |
| F4 | ☐ | P1 | Define and implement the **adaptor layer** for format conversion (supplement §3 of original requirements, supplement §4 of this addendum): JSON ↔ tree, CSV ↔ structured rows, Notion blocks ↔ markdown, etc. Likely lives under `backend/src/mut_engine/adapters/operations/converters/`. |

---

## G. CLI (`puppyone` / `puppyone fs`)

| # | Status | P | Item |
|---|--------|---|------|
| G1 | ☐ | P0 | Rewrite `docs/architecture/03-cli.md` (or replace with a new file) so the "data plane CLI" is **stock `git`**, not `mut`. Keep `puppyone fs` for cloud-scoped FS ops. (Per user instruction this pass: do not modify 03-cli.md yet — but flag it explicitly here for follow-up.) |
| G2 | ☐ | P1 | Decide and implement (or defer) `puppyone clone <project_or_ap>` sugar that calls `git clone https://host/git/ap/<key>.git`. (Open Q5 in supplement.) |
| G3 | ☐ | P1 | `puppyone fs grep / find / ls -R` query the new server-side index (see H2/H3), not the on-line tree walk, when the project is large. |
| G4 | ☐ | P1 | `puppyone fs` against shadow snapshots: add `--ref local:<machine>/<branch>` or similar selector that resolves to a shadow snapshot manifest. |
| G5 | ☐ | P2 | Local client daemon (`puppyone agent` or `puppyone sync`) that publishes shadow snapshots from the user's Git working tree to the server (debounced, respects `.gitignore`). |

---

## H. FS indexing & search performance

| # | Status | P | Item |
|---|--------|---|------|
| H1 | ☐ | P1 | Implement path index refresh in the outbox worker: on `version_committed`, diff old vs new scope tree and upsert `fs_path_index` rows. |
| H2 | ☐ | P1 | Wire `/ap-fs/find`, `/ap-fs/ls?recursive=true`, `/ap-fs/stat` to query `fs_path_index` instead of walking S3 trees. |
| H3 | ☐ | P1 | Content full-text index: on accepted text-blob writes, enqueue a Turbopuffer / pg_trgm reindex job. `/ap-fs/grep` queries the index first and falls back to live scan for misses. |
| H4 | ☐ | P2 | Permission filter at query time using the caller's access-point scope + exclude. |
| H5 | ☐ | P2 | Index rebuild CLI/admin command for disaster recovery. |

---

## I. Shadow snapshots (local-↔-cloud bridge)

| # | Status | P | Item |
|---|--------|---|------|
| I1 | ☐ | P1 | Spec the shadow snapshot manifest format (path, mode, blob_hash, size, mtime, optional preview). |
| I2 | ☐ | P1 | `POST /api/v1/local-snapshots` endpoint accepting a manifest from the local daemon, validated against project+user. |
| I3 | ☐ | P1 | Object upload pipeline for blob hashes not yet on the server: lazy on query, or eager on snapshot publish (Open Q1). |
| I4 | ☐ | P1 | Query path: `puppyone fs grep --ref local:<machine>/<branch> ...` reads from shadow snapshot tables + blob store. |
| I5 | ☐ | P2 | Promote shadow snapshot to a real scope: `puppyone fs promote <snapshot_ref> --scope <scope>` → triggers a real push as that user via the Git adapter. |
| I6 | ☐ | P2 | TTL / GC for stale shadow snapshots (Open Q2). |

---

## J. Audit / observability

| # | Status | P | Item |
|---|--------|---|------|
| J1 | ☐ | P1 | Backfill new audit columns (D4) from existing `metadata` JSONB. |
| J2 | ☐ | P1 | Audit join view: `audit_logs ⋈ version_transactions ⋈ mut_conflicts` for the admin UI activity feed. |
| J3 | ☐ | P2 | Read-access audit (clone/fetch) — durable but separate from accepted-write publish, per 01 §7.4. Lightweight table or sampled. |

---

## K. Tests & acceptance

| # | Status | P | Item |
|---|--------|---|------|
| K1 | ☐ | P0 | Acceptance test: standard Git flow against `/git/ap/{access_key}.git` — clone, add, commit, push, fetch, pull --ff-only. |
| K2 | ☐ | P0 | Acceptance test: scoped Git clone cannot read objects outside scope (negative test: try to fetch a known-out-of-scope SHA). |
| K3 | ☐ | P0 | Acceptance test: sibling-scope concurrent pushes both land without root locking; assert total wall time < single-scope serialized baseline. |
| K4 | ☐ | P0 | Acceptance test: parent-scope-wins (supplement §7.A). |
| K5 | ☐ | P0 | Acceptance test: child-promotes-parent (supplement §7.B); parent scope head bumps and `git log` on parent shows the child change. |
| K6 | ☐ | P1 | Acceptance test: cross-scope push is rejected with a clear "split your push" message. |
| K7 | ☐ | P1 | Acceptance test: pending → resolve via `ConflictResolutionIntent` produces a final accepted commit and a clean audit chain. |
| K8 | ☐ | P1 | Acceptance test: project Git history shows child-scope commits via projected commits (`mut_version_index` mapping present). |
| K9 | ☐ | P1 | Acceptance test: read-your-write — writer can `git fetch` / `puppyone fs cat` the just-committed content. |
| K10 | ☐ | P2 | Load test: 100k-file `puppyone fs grep` returns under target latency using path/content indexes. |
| K11 | ☐ | P2 | Chaos test: kill outbox worker between publish and projection — durable repair restores project view. |

---

## L. Documentation

| # | Status | P | Item |
|---|--------|---|------|
| L1 | ☑ | — | Write [07-version-engine-supplement.md](07-version-engine-supplement.md) (this PR). |
| L2 | ☑ | — | Write [07-version-engine-todo.md](07-version-engine-todo.md) (this file). |
| L3 | ☐ | P1 | Annotate `docs/architecture/00-vision.md` and `docs/architecture/03-cli.md` with a top-of-file pointer: "See 07-version-engine-supplement.md for the current model. The MUT references in this doc are historical." (Per user instruction, do not rewrite contents yet.) |
| L4 | ☐ | P1 | Update `docs/architecture/02-access-points.md` if any AP semantics change (mode, identity binding, channel pause already cross-cut Git). |
| L5 | ☐ | P2 | Write `08-shadow-snapshots.md` once Open Q1/Q2 are resolved. |
| L6 | ☐ | P2 | Write `09-conflict-policy.md` covering the full policy DSL once B11 is implemented. |
| L7 | ☐ | P2 | Update `AGENTS.md` / `CLAUDE.md` so AI assistants point to 07-* as the source of truth. |

---

## M. Recommended sequencing (one possible ordering)

1. **Round 1 — Decide & unblock**: resolve Open Questions Q3/Q4/Q5/Q6/Q7 in supplement §9, then start A1–A10 (delete MUT) + B1/B2/B3 (add new tables) in parallel. Database migrations land first because backend changes consume them.
2. **Round 2 — Engine completeness**: B4–B12 (conflict storage + resolution + parent/child rules + trailers) + D3/D4. After this round, the new Git server model is functionally correct.
3. **Round 3 — Layout & cleanup**: C1–C5 (move files to `infrastructure/` and `adapters/operations/`). Pure refactor, behavior-preserving.
4. **Round 4 — Performance & cross-end**: H1–H4 (FS index) + I1–I4 (shadow snapshots), in parallel with E3/E4 (Git transport polish).
5. **Round 5 — Documentation & deprecation**: L3–L7 + remove `protocol_mode` (A11) once nothing in code reads it.
