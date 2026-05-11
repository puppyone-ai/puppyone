# MUT Engine Bug Checklist

> Canonical fix list — deduplicated, severity-verified.
>
> Sources: Opus 4 deep audit + GPT-5 cross-review + manual verification.
>
> Last updated: 2026-04-17

---

## P0 — Data Safety (fix first)

### P0-0: Version-number race / duplicate `mut_version` — REMOVED by commit_id migration (2026-04-17)

| Key | Value |
|-----|-------|
| **Original symptom** | Two concurrent pushes could read the same `mut_version`, each `+1`, and each write back the same new number, producing duplicate entries in `mut_commits`. |
| **Original root cause** | Per-instance counter (`projects.mut_version` read-modify-write in Python) instead of a DB-side atomic increment. |
| **Final fix (this change set)** | Retire the integer version entirely. Each commit is now identified by `commit_id = sha256(scope_path, scope_hash, ts_microseconds, who)[:16]`. There is no counter to race on — identical inputs produce identical ids (deduped by CAS on `scope_hash`), distinct inputs produce distinct ids. Migration `20260418000000_mut_commit_id_identity.sql` drops `projects.mut_version`, `mut_commits.version`, `mut_scope_state.version`, `atomic_next_version(...)` RPCs, and the denormalized `last_sync_version` on `sync_state` / `access_points`. |
| **Affected surfaces** | `mut` wire protocol (`base_commit_id`, `head_commit_id`, `commit_id`); backend mut_engine schemas + routers + audit metadata; sync connector idempotency checks; frontend `contentTreeApi` + History/Home/Monitor pages; CLI `data` commands output. All migrated in lockstep — no compat shim. |

### P0-1: `handle_rollback` bypasses CAS and never triggers grafting

| Key | Value |
|-----|-------|
| **Files** | `mut/server/handlers.py` (handle_rollback) |
| | `backend/src/mut_engine/routers/protocol_router.py` (rollback endpoint) |
| | `backend/src/mut_engine/routers/access_point.py` (rollback endpoint) |
| | `backend/src/mut_engine/routers/content_history.py` (rollback endpoint) |
| **Root cause** | `handle_rollback()` calls `repo.set_scope_hash()` directly instead of going through the CAS compare-and-swap flow. All three backend rollback endpoints also skip `run_post_push_hook()`. |
| **Consequence** | 1) Concurrent rollback can silently overwrite another agent's commit. 2) `root_hash` never updates after rollback, so the global tree doesn't reflect the rollback — other scopes / Web UI still see pre-rollback state. |
| **Fix** | Rewrite `handle_rollback()` to use CAS commit flow (like `handle_push`). Make it return version + hashes so backend can call the post-push hook (or a dedicated rollback hook) to graft into `root_hash`. |

### P0-2: S3 `put` swallows exceptions — silent data loss

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/s3_storage.py` |
| **Root cause** | `S3StorageBackend.put()` (line ~146) catches all exceptions, logs, and **does not re-raise**. Additionally, `get()` and `exists()` catch all exceptions and convert them to `ObjectNotFoundError` / `False`. |
| **Consequence** | S3 transient failure during push → `put` silently fails → CAS succeeds, version increments, history recorded → but blob doesn't exist in S3. Next `clone`/`pull` hits `ObjectNotFoundError`. Data is "committed" but physically absent. The `get`/`exists` masking makes it impossible to distinguish "object genuinely missing" from "S3 is down". |
| **Fix** | `put()` must re-raise (or raise a dedicated `StorageWriteError`). `get()`/`exists()` should only catch `ClientError` with 404 status, not bare `Exception`. |

### P0-3: Agent / Sandbox direct `push()` bypass — no post-push hook

| Key | Value |
|-----|-------|
| **Files** | `backend/src/connectors/agent/service.py` (L383-388 schedule, L1198-1203 streaming) |
| | `backend/src/connectors/agent/sandbox_session.py` (L211-216 writeback) |
| | `backend/src/connectors/sandbox_endpoint/router.py` (L373-377 exec writeback) |
| **Root cause** | These files create `MutEphemeralClient` directly and call `push()`, but never call `run_post_push_hook()` afterward. |
| **Consequence** | Every agent chat write-back, scheduled agent task, and sandbox execution that writes files updates `scope_hash` but **not** `root_hash`. Other scopes, the Web UI, and Content API reads from `root_hash` won't see these changes until something else triggers a graft. |
| **Fix** | Extract a `push_and_finalize()` helper (or require all push callers to go through `MutOps`). Ensure every successful push triggers the grafting hook. |

### P0-4: `MutEphemeralClient.push()` doesn't consume server merge result

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/services/ephemeral_client.py` (L184-186) |
| **Root cause** | After successful push, `self._files` is set to the **local** `merged_files` dict (pre-push snapshot + local changes). Server-side 3-way merge results are ignored. |
| **Consequence** | If the server merged in files from another agent, the client's `_files` doesn't know about them. On the **next push** from the same client instance, the snapshot omits those files → server interprets as deletion. Affects long-lived agent sessions (`service.py` streaming) that reuse one `MutEphemeralClient` across multiple turns. `MutOps` is safe (creates new client per push). |
| **Fix** | After successful push, either (a) call `pull()` to refresh `_files` from server state, or (b) parse the push response's merged file list and patch `_files` accordingly. |

### P0-5: `_safe_flatten` in graft swallows S3 errors → silent data overwrite — FIXED 2026-04-21

| Key | Value |
|-----|-------|
| **File** | `mut/server/graft.py` (`_safe_flatten`, original; replaced by `puppyone/backend/src/mut_engine/services/hooks.py::_build_root_from_scope_state`) |
| **Root cause** | `_safe_flatten()` caught all exceptions and returned `{}`. The graft path was `read projects.mut_root_hash → fetch root tree from S3 → splice → write`, which made an S3 derived artifact both the SoT and the input for deriving the next SoT. Any silent partial S3 read produced a "structurally valid but data-losing" new root that CAS happily wrote. |
| **Consequence** | If S3 was temporarily unreachable during graft, the existing tree was read as "empty". The graft then overwrote the real root tree with only the just-pushed scope's changes, effectively deleting everything outside that scope. |
| **Fix** | Architectural: graft no longer reads the previous root tree from S3. Instead, `mut_scope_state` (the DB SoT for "where does each scope point") is the only input. `_build_root_from_scope_state` rebuilds root by SELECTing every scope hash from DB, starting from the root scope's tree as base, and overlaying child scopes via `graft_subtree` in path-depth order. Failures are loud (re-raise → retry → ERROR log); no silent fallback. See `docs/design/mut-scope-concurrency.md` §3.2 + §5.4 and `mut_engine/ARCHITECTURE.md` §6.1. Tests: `tests/mut_engine/test_bug_fixes.py::TestGraftFromDBState` (6 cases incl. nested scopes + corrupt-root-tree regression). |

### P0-6: CAS RPCs declared `p_project_id` as UUID while tables use TEXT — FIXED 2026-04-17

| Key | Value |
|-----|-------|
| **Files** | `supabase/migrations/20260415000000_mut_cas_rpc_functions.sql` (introduced) |
| | `supabase/migrations/20260416200000_fix_cas_rpc_project_id_type.sql` (fix) |
| **Root cause** | The three CAS RPCs (`cas_update_scope_state`, `cas_update_root_hash`, `atomic_next_version`) declared `p_project_id UUID`. But `projects.id`, `mut_commits.project_id`, `mut_scope_state.project_id` are all `TEXT` columns — values happen to be UUID strings, but the column type is not. Inside each function `WHERE project_id = p_project_id` became `text = uuid` → PostgreSQL error `42883: operator does not exist: text = uuid`. |
| **Consequence** | Every push and every rollback HTTP 500'd as soon as it reached the CAS stage. All writes through the MUT protocol were blocked. |
| **Discovery** | Local E2E `mut push` test on 2026-04-17. Not caught earlier because: (a) the migration was never committed, so CI never applied it to any environment; (b) the existing `smoke_test_triggers.sql` only covered `handle_new_user`, not RPCs; (c) no test invoked the CAS RPCs end-to-end against a real DB. |
| **Fix** | `DROP FUNCTION` the UUID-signature overloads first — PostgreSQL treats `(uuid, …)` and `(text, …)` as distinct signatures, so `CREATE OR REPLACE` alone would leave both versions coexisting. Then `CREATE OR REPLACE FUNCTION` with `p_project_id TEXT`. |
| **Prevention** | Multi-layer guardrails, all landed in the same change set as the fix: |
| | 1. **Documentation**: `docs/design/mut-scope-concurrency.md` (Appendix: Data Type Conventions) explicitly states `project_id` is always `TEXT`. |
| | 2. **PR-stage lint**: `.github/workflows/validate-migrations.yml` scans newly added migrations for `p_project_id` declared as any non-TEXT type and fails the PR. |
| | 3. **Deployment smoke test**: `supabase/tests/smoke_test_triggers.sql` asserts (a) all three CAS RPCs have TEXT signatures, (b) zero UUID overloads exist, (c) each RPC can be invoked with a fake project_id without hitting 42883. Runs in both `migrate-staging.yml` and `migrate-production.yml`. |

---

## P1 — Security

### P1-1: Viewer role can perform all write operations

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/routers/_content_helpers.py` (L31-32) |
| **Root cause** | `ensure_project_access()` only checks project membership, not the member's role. Code contains an explicit `TODO(auth)` acknowledging this. |
| **Consequence** | A user invited as `viewer` can call write/mkdir/mv/rm/restore/bulk-write/rollback through Content API. |
| **Fix** | Add role check. Write endpoints require `editor` or `admin`; read endpoints allow `viewer`. |
| **Note** | This subsumes the `MutOps._make_client` scope concern (previously N3) — the real issue is missing role-based authorization on the Content API path, not the scope construction itself. |

### P1-2: Scope fallback grants full read-write on lookup failure

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/auth.py` (`_resolve_scope`, line ~97) |
| | `backend/src/mut_engine/routers/access_point.py` (scope fallback) |
| **Root cause** | When scope lookup fails (DB error, missing row), both files fall back to `path=""`, `exclude=[]`, `mode="rw"` — full project access. |
| **Consequence** | Transient DB failure or misconfigured access point → agent gets unrestricted tree access instead of being denied. |
| **Fix** | Fail closed: return 403 on scope lookup failure, or at minimum fall back to read-only with empty scope. |

### P1-3: `audit_router` only checks project existence, not user membership

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/routers/audit_router.py` (`_ensure_project_access`) |
| **Root cause** | Checks that the project exists, but not that the current user belongs to it. |
| **Consequence** | Any authenticated user who knows a `project_id` can read that project's full audit log. |
| **Fix** | Reuse the standard project membership check (same as Content API). |

### P1-4: `MAX_FILE_SIZE` defined but never enforced

| Key | Value |
|-----|-------|
| **Files** | `backend/src/mut_engine/server/validation.py` (defines `MAX_FILE_SIZE`) |
| | `backend/src/mut_engine/routers/content_write.py` (doesn't check) |
| | MUT push protocol path (doesn't check) |
| **Consequence** | No upload size limit → potential DoS via arbitrarily large file pushes that exhaust memory or S3 quota. |
| **Fix** | Enforce `MAX_FILE_SIZE` at Content API write endpoints and in the MUT push handler (check each blob size before `store.put`). |

### P1-5: `validate_path` not called on several write paths + write-then-validate in `move`

| Key | Value |
|-----|-------|
| **Files** | `backend/src/mut_engine/services/ops.py` (`delete`, `move`, `restore`, `bulk_write` — only `strip("/")`) |
| | `backend/src/mut_engine/routers/content_write.py` (`move` endpoint, L124-136) |
| **Root cause** | `MutOps` methods for delete/move/restore/bulk_write don't call `validate_path`. The `move` endpoint in `content_write.py` calls `ops.move()` first, then validates the paths in the response — write happens before validation. |
| **Consequence** | Internal callers (schedulers, ARQ workers, MCP proxy) that bypass the router layer can pass `../` paths. The `move` endpoint can succeed on disk but return 400 if validation fails afterward, leaving inconsistent state. |
| **Fix** | Call `validate_path` inside `MutOps` methods (defense in depth), and move validation **before** `ops.move()` in the router. |

### P1-6: Access Key `status` check missing on direct MUT protocol path

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/auth.py` (`_try_access_key`) |
| **Root cause** | `_try_access_key()` doesn't check `access_point.status`. The `access_point.py` router does check it, so this only affects the direct MUT protocol path (`protocol_router.py`). |
| **Consequence** | A disabled/suspended access point can still authenticate via direct MUT protocol if it uses the access key auth path. |
| **Fix** | Add `status == "active"` check in `_try_access_key()`. |
| **Note** | Half-severity — `access_point.py` already handles this; only the direct protocol path is exposed. |

### P1-7: `SKIP_AUTH` has no environment guard

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/auth.py` |
| **Root cause** | `SKIP_AUTH` flag bypasses all authentication with no check for environment (dev/test/prod). |
| **Consequence** | If accidentally enabled in production, all MUT endpoints become unauthenticated. |
| **Fix** | Gate behind `ENV in ("local", "test")` or remove entirely. |

### P1-8: `user_identity` binding can be bypassed

| Key | Value |
|-----|-------|
| **Files** | `backend/src/mut_engine/server/auth.py`, `backend/src/mut_engine/routers/access_point.py` |
| **Root cause** | When `user_identity` is configured on an access point, the `X-Mut-User` header check is not strictly enforced — missing header or mismatch doesn't always result in rejection. |
| **Consequence** | An access key meant for a specific user can be used by a different user. |
| **Fix** | If `user_identity` is configured, require `X-Mut-User` header and enforce exact match; reject otherwise. |

---

## P2 — Robustness & Performance

### P2-1: `CachedStorageBackend` not thread-safe

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/s3_storage.py` (L93-97) |
| **Root cause** | `cachetools.LRUCache` is not thread-safe. `get()` reads the cache without holding `_cache_lock`, while other threads may write under the lock. |
| **Consequence** | Concurrent MUT pushes (via `asyncio.to_thread`) sharing the global cache can corrupt LRU internal state → `RuntimeError` or stale data. |
| **Fix** | Hold `_cache_lock` for all cache reads and writes, or switch to a thread-safe cache implementation. |

### P2-2: `_run_async` creates a new event loop per call

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/s3_storage.py` (L44-47) |
| **Root cause** | Each synchronous S3 operation submits to a thread pool, which calls `asyncio.run()` — creating and destroying an event loop for every operation. |
| **Consequence** | A single push may trigger dozens of S3 operations, each with event loop overhead. Under high concurrency, this becomes a bottleneck. |
| **Fix** | Maintain a persistent event loop in the thread pool, or use synchronous S3 calls directly. |

### P2-3: `run_post_push_hook` blocks the async event loop

| Key | Value |
|-----|-------|
| **Files** | `backend/src/mut_engine/routers/protocol_router.py` (L86-87) |
| | `backend/src/mut_engine/routers/access_point.py` |
| **Root cause** | `run_post_push_hook()` is called synchronously in async route handlers. It performs DB + S3 operations (grafting). |
| **Consequence** | Event loop is blocked during the entire graft operation. Other requests stall. |
| **Fix** | Wrap in `asyncio.to_thread()` or make the hook natively async. |

### P2-4: `admin.py` async methods call sync DB/S3 operations

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/admin.py` (`get_version_content`, `compute_diff`) |
| **Root cause** | `async def` methods directly call synchronous `repo.history.get_entry()` and `repo.store.get()`. |
| **Consequence** | Same as P2-3 — event loop blocked during DB/S3 I/O. |
| **Fix** | Wrap sync calls in `asyncio.to_thread()`. |

### P2-5: `tree_reader.read_file` is O(total files in tree)

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/services/tree_reader.py` (`_resolve_blob`) |
| **Root cause** | `_resolve_blob` calls `tree_to_flat(root_hash)` which flattens the entire Merkle tree to find one file. |
| **Consequence** | Reading a single file costs O(n) where n = total files in project. The `/cat` endpoint compounds this by calling `read_file` + `stat` (two flattens) + a DB query. |
| **Fix** | Navigate the tree by path segments (like `_navigate_to_subtree`) instead of flattening. |

### P2-6: `_upsert_scope_state` is non-atomic read-modify-write

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/supabase_history.py` (L106-160) |
| **Root cause** | Reads existing state, merges fields, then upserts. Between read and write, another request can modify the row. |
| **Consequence** | Theoretical TOCTOU window. Mitigated by CAS being the primary write path, but `set_scope_version` and `set_scope_hash` still use this. |
| **Fix** | Use single-statement upsert with `ON CONFLICT ... SET` that only updates the specific field, or route all updates through the CAS RPC. |

### P2-7: legacy soft-delete path could create empty blobs

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/services/ops.py` (L215-216) |
| **Root cause** | `files.get(path, b"")` returns empty bytes when path doesn't exist in the cloned file set. |
| **Consequence** | Legacy soft-delete could materialize a 0-byte ghost file. |
| **Fix** | Removed tree-internal soft-delete; delete now removes paths from the current tree and recovery uses version history. |

### P2-8: `scope.py` doesn't resolve `..` path segments

| Key | Value |
|-----|-------|
| **File** | `mut/core/scope.py` (`check_path_permission`, `normalize_path`) |
| **Root cause** | `normalize_path` only does `strip("/")`, doesn't resolve `..`. Path `src/../secrets/x` starts with `src/` and passes the scope check. |
| **Consequence** | In the Merkle tree, `..` is stored as a literal directory name (no real escape). But if any code later interprets these paths on a real filesystem (e.g., filesystem sync daemon), it becomes a directory traversal. Defensive programming gap. |
| **Fix** | Add `posixpath.normpath` or manual `..` resolution in `normalize_path`. Reject paths containing `..` segments. |

### P2-9: `content_history` rollback maps all exceptions to HTTP 400

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/routers/content_history.py` (L187) |
| **Root cause** | `except Exception as e: raise HTTPException(status_code=400, detail=str(e))` |
| **Consequence** | S3 outage, DB timeout, permission error — all returned as "client error 400". Misleading for monitoring and debugging. |
| **Fix** | Catch specific exceptions and map to appropriate HTTP codes (500 for infra failures, 409 for conflicts, 404 for not found). |

### P2-10: `_run_post_push_hook` in `ops.py` silently swallows exceptions

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/services/ops.py` (L345-351) |
| **Root cause** | `except Exception: pass` |
| **Consequence** | Grafting failure after a successful push goes completely unnoticed — no log, no metric, no alert. `root_hash` silently drifts. |
| **Fix** | At minimum, log with structured context (project_id, version, error). Consider surfacing as a non-fatal warning to the caller. |

### P2-11: Multiple files bypass FastAPI DI to construct `SupabaseClient` directly

| Key | Value |
|-----|-------|
| **Files** | `backend/src/mut_engine/server/auth.py`, `backend/src/mut_engine/services/hooks.py`, `backend/src/mut_engine/routers/access_point.py`, `backend/src/mut_engine/dependencies.py` (`get_repo_manager_standalone`) |
| **Root cause** | Direct `SupabaseClient()` construction instead of using FastAPI DI. |
| **Consequence** | Multiple Supabase client instances with potentially different configurations. Singleton initialization order issues in `dependencies.py` (standalone initialization wins over DI). Harder to test and mock. |
| **Fix** | Consolidate to a single factory. Pass clients through DI or a shared provider. |

### P2-12: `_scope_hash_from_history` only looks back 10 versions

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/server_repo.py` (L240-255) |
| **Root cause** | Fallback scan hard-coded to last 10 global versions. Also, when `scope_path=""` (root), `not scope_path` is True → matches **any** scope's hash, not just root. |
| **Consequence** | In multi-scope projects with frequent commits, a scope that hasn't committed in >10 global versions gets empty fallback. Root scope can get wrong scope's hash. |
| **Fix** | Query history with a `WHERE scope_path = ?` filter instead of scanning. Remove the `not scope_path` short-circuit or handle root scope explicitly. |

### P2-13: `/cat` endpoint performs redundant tree reads

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/routers/content_read.py` (L76-91) |
| **Root cause** | Calls `ops.read_file()` (tree flatten), then `ops.stat()` (another read), then `ops.get_version()` (DB query) — three separate operations for one endpoint. |
| **Consequence** | Combined with P2-5, a single `/cat` request does at least two tree traversals. Inefficient but not critically broken. |
| **Fix** | Create a single `ops.cat()` method that returns content + metadata + version in one tree traversal. |

---

## P3 — Low / Code Hygiene

### P3-1: S3 `get` / `exists` convert timeouts and auth errors to "not found"

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/s3_storage.py` |
| **Root cause** | Bare `except Exception` in `get()` raises `ObjectNotFoundError`; in `exists()` returns `False`. |
| **Consequence** | Transient S3 issues are misclassified, leading to incorrect logic decisions downstream. |

### P3-2: `all_hashes` silently truncates at 10,000

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/backends/s3_storage.py` (`_MAX_LIST_KEYS = 10000`) |
| **Consequence** | Large projects with >10k objects get partial results from `all_hashes()` / `count()`. No warning. |

### P3-3: `admin.py` also uses `tree_to_flat` for single-file lookups

| Key | Value |
|-----|-------|
| **File** | `backend/src/mut_engine/server/admin.py` (`_resolve_path_hash`) |
| **Consequence** | Same O(n) issue as P2-5, in the version history / diff code path. |

### P3-4: Architecture smells (non-urgent)

- `dependencies.py` singleton init race (no lock, first caller wins)
- `set_root_hash` / `set_scope_hash` exposed as public API on `ServerRepo` (enables non-CAS writes)
- `hooks.py` mixes grafting logic with hook orchestration (SRP)
- `supabase_history.py` accumulates too many responsibilities

---

## Recommended fix order

```
Phase 1 — Data Safety (P0)
  P0-1  handle_rollback CAS + grafting
  P0-2  S3 put must re-raise
  P0-3  Agent/Sandbox push → hook helper
  P0-4  EphemeralClient consume merge result
  P0-5  graft from DB scope state (NOT old root tree from S3) — DONE 2026-04-21

Phase 2 — Security (P1)
  P1-1  Viewer role enforcement
  P1-2  Scope fallback → fail closed
  P1-3  audit_router membership check
  P1-4  MAX_FILE_SIZE enforcement
  P1-5  validate_path in MutOps + move ordering

Phase 3 — Robustness (P2 high-impact)
  P2-1  Cache thread safety
  P2-3  Hook async execution
  P2-5  tree_reader path navigation
  P2-10 Hook exception logging

Phase 4 — Remaining P1 + P2
  (rest of items, prioritized by effort/impact)

Phase 5 — Tests
  - Rollback → root_hash correctness
  - Direct push bypass → root visibility
  - merged_changes → no file deletion
  - Scope/status/identity security tests
  - mutai package feature compatibility
```
