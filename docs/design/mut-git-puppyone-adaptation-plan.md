# PuppyOne Adaptation Plan — Latest MUT (git-format) + Git Compatibility

**Status**: Plan, not yet implemented
**Last updated**: 2026-05-09
**Companion docs**: [`mut-git-compatibility-strategy.md`](../mut-git-compatibility-strategy.md), [`access-point-redesign-2026-05-02.md`](./access-point-redesign-2026-05-02.md)
**MUT-side reference**: branch `feat/git-format-storage` of `mut/`, head commit `3b81887`

---

## 1. Context — what changed in MUT that PuppyOne must absorb

The `mut/` repository's `feat/git-format-storage` branch landed seven commits that together rewrite the local-storage and wire-protocol contracts. PuppyOne embeds the MUT server in-process (`MutEphemeralClient`, `PuppyOneServerRepo`, `direct_writer`), so every change to the MUT contract is also a change PuppyOne has to make.

| MUT change | What it means for PuppyOne |
|---|---|
| Local store is `.git/`, not `.mut/`; objects are zlib-compressed git loose-object bytes (`<type> <size>\0<content>`) | Wire protocol now ships these loose bytes verbatim. PuppyOne's server-side handlers must store / serve them via the same encoding. |
| `commit_id` is a real git commit object SHA-1 (40 hex chars), not the legacy 16-hex truncated SHA-256 | All `commit_id` columns and serialisers must widen. New commits are produced with `_make_commit(repo, tree, parent, who, message, ts)`. |
| `PushResponse.commit_object` returns the new commit's loose bytes; clone/pull `objects` dict includes the head commit object | PuppyOne's protocol responses must be updated to ship those bytes — otherwise client `git fsck` reports dangling/missing commit. |
| New endpoints: `POST /scopes` (visible scope tree per credential), `GET /ws` (WebSocket notifications) | PuppyOne must implement both inside `protocol_router.py`. |
| Client records `[mut].bound-branch` in `.git/config`; client-side check refuses to push/pull on a different branch | Server-side: optionally enforce; design says one git branch ↔ one MUT repo. PuppyOne adds `projects.bound_git_branch`. |
| Credential resolution: env var → `.env` → `~/.mut/credentials.json`. The legacy `.mut/credential` file is no longer read | No backend impact (credential is the bearer token from `repo_scopes.access_key`); the docs/UI should stop mentioning the legacy path. |
| Single ignore file `.gitignore` (no `.mutignore`) | UI/docs cleanup; no schema impact. |

PuppyOne also gains a brand-new responsibility from the strategy doc: **GitHub Integration** — bidirectional bridge between a GitHub repo+branch and a MUT repo. This is purely additive.

---

## 2. Current state — what PuppyOne already has

### 2.0 Note: `connectors[provider='github']` vs `github_integrations` (this plan)

The existing codebase already has a GitHub flow: `backend/src/connectors/datasource/github/connector.py` plus rows in the `connectors` table with `provider='github'`. That flow is **scope-level, URL-based, one-shot ZIP fetch, inbound-only** — it predates the git-compatibility design and exists for "drop a snapshot of a public repo into this scope as files".

The new `github_integrations` table introduced in this plan is a **different concept**: project-level, branch-bound, bidirectional, webhook-driven, with watermarked import/export. The two tables intentionally coexist (different intent, different keys); over time the `connectors[github]` row degrades into a UI hint while `github_integrations` becomes the binding source-of-truth. No forced migration of existing rows.

### 2.1 Backend (FastAPI)

Verified via codebase scan on 2026-05-09:

| Component | File | Role |
|---|---|---|
| In-process MUT client | `src/mut_engine/services/ephemeral_client.py` | Wraps `mut.server.handlers`; clone/push/pull/negotiate without HTTP |
| Internal write orchestrator | `src/mut_engine/services/direct_writer.py` | per-scope async lock + CAS retry; produces `mut_commits` rows |
| Tree manipulation | `src/mut_engine/services/tree_splice.py`, `tree_reader.py` | Pure Merkle ops on the S3-backed object store |
| Server-side adapters | `src/mut_engine/server/server_repo.py`, `repo_manager.py`, `auth.py` | Implements MUT's `ServerRepo` interface against Supabase + S3 |
| MUT protocol router (HTTP) | `src/mut_engine/router/protocol_router.py` | Exposes `/clone`, `/push`, `/pull`, `/negotiate` per project |
| Access-point router | `src/mut_engine/router/access_point.py` | Same protocol routed by `access_key` instead of JWT |
| Scope CRUD (user-facing) | `src/repo/scope_router.py` | Manages `repo_scopes` rows |
| Connector CRUD | `src/repo/connector_router.py` | Manages built-in (cli/agent/filesystem) and external connectors |
| Audit logs | `src/mut_engine/audit_router.py` | Lists commits + audit trail |
| Content read/write | `src/mut_engine/content_read.py`, `content_write.py` | Web-UI-facing file editor endpoints (uses `direct_writer`) |
| OAuth (GitHub plumbing exists, not wired to MUT) | `src/connectors/datasource/oauth/github_service.py`, `src/connectors/datasource/github/connector.py` | OAuth login/refresh; connector stub |
| Schedulers / workers | `src/infra/scheduler/{service,jobs/*}.py`, `src/ingest/file/jobs/worker.py` | Agent jobs, sync jobs, sandbox reaper, ETL workers |

### 2.2 DB (Supabase)

| Table | Purpose | Existing relevant columns |
|---|---|---|
| `repo_scopes` | Scope geometry per project | `id, project_id, path, exclude, mode, access_key, access_key_revoked_at, is_root, name` |
| `mut_commits` | Immutable per-scope history | `project_id, commit_id, scope_path, scope_hash, who, message, head_commit_id, changes, merged, conflicts, created_at` |
| `mut_scope_state` | Per-scope CAS target | `project_id, scope_path, scope_hash, head_commit_id` |
| `projects` | Project metadata | `id, name, mut_root_hash, ...` |
| `oauth_connections` | OAuth tokens (GitHub, Notion, Google, ...) | `id, user_id, provider, access_token, refresh_token, expires_at, workspace_name, metadata` |
| `connectors` | Per-scope sync channels | `id, project_id, scope_id, provider, name, direction, config, status, oauth_connection_id` |
| `repo_user_permissions` | Fine-grained ACL per scope | `user_id, scope_id, permission_level` |

Migrations live in `puppyone/supabase/migrations/` and follow the convention `YYYYMMDDHHMMSS_<slug>.sql` with: comment header explaining "why", idempotent body (`CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT`), `DO $$ … $$` sanity check at the end, single transaction (`BEGIN`/`COMMIT`).

### 2.3 Frontend (Next.js)

| Surface | File | Today |
|---|---|---|
| Commit history page | `app/(main)/projects/[projectId]/history/page.tsx` | Timeline + per-commit diff via SWR |
| Home page commit sparkline | `app/(main)/projects/[projectId]/home/components/HistoryCard.tsx` | 30-day commit cadence |
| File explorer | `app/(main)/projects/[projectId]/data/[[...path]]/page.tsx` | Reads via `treeList()` shallow tree |
| Scope/connector list | `app/(main)/projects/[projectId]/access/page.tsx` | Two-pane scope ↔ connector master/detail |
| Project settings | `app/(main)/projects/[projectId]/settings/page.tsx` | Name, visibility, members |
| Workspace OAuth | `app/(main)/settings/connect/page.tsx` | Generic OAuth status |
| API clients | `lib/repoApi.ts`, `lib/contentTreeApi.ts`, `lib/syncApi.ts`, `lib/oauthApi.ts` | One module per backend area |

**Absent**: WebSocket / real-time notifications, GitHub repo binding UI, branch picker, connection-status indicator.

---

## 3. Plan — DB layer (Supabase)

| # | Change | Migration name (proposed) | Notes |
|---|---|---|---|
| D1 | ~~Widen `commit_id` columns~~ — **NOT NEEDED** | n/a | All commit_id / hash columns already use Postgres `TEXT` (no width constraint). 40-hex SHA-1 fits without DDL. The contract change lives in application code; no migration. |
| D2 | ~~Widen `projects.mut_root_hash`~~ — **NOT NEEDED** | n/a | Same reason — `mut_root_hash TEXT DEFAULT ''` already accepts any length. |
| D3 | Add `projects.bound_git_branch TEXT NOT NULL DEFAULT 'main'` | `<ts>_projects_bound_git_branch.sql` | Implements "one git branch ↔ one MUT repo" as a column on `projects`. NULL → `'main'` backfill, then NOT NULL. |
| D4 | Create `github_integrations` table | `<ts>_github_integrations_table.sql` | Columns: `id UUID PK`, `project_id UUID FK→projects(id) UNIQUE`, `oauth_connection_id INTEGER FK→oauth_connections(id)`, `github_repo_owner TEXT NOT NULL`, `github_repo_name TEXT NOT NULL`, `default_branch TEXT NOT NULL DEFAULT 'main'`, `webhook_secret TEXT`, `auto_import BOOLEAN NOT NULL DEFAULT FALSE`, `last_imported_sha TEXT`, `last_imported_at TIMESTAMPTZ`, `last_exported_sha TEXT`, `last_exported_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`. |
| D5 | Create `github_sync_log` table | `<ts>_github_sync_log_table.sql` | Columns: `id UUID PK`, `integration_id UUID FK→github_integrations(id) ON DELETE CASCADE`, `direction TEXT CHECK (direction IN ('import','export'))`, `git_sha TEXT`, `mut_commit_id TEXT` (40-char), `status TEXT CHECK (status IN ('pending','success','failed','conflict'))`, `error_message TEXT`, `files_changed INTEGER`, `created_at TIMESTAMPTZ DEFAULT now()`. Index on `(integration_id, created_at DESC)`. |
| D6 | (Optional, later) Create `notification_log` table | `<ts>_notification_log_table.sql` | For at-least-once delivery of `commit_update` events when WebSocket isn't connected. Defer to phase 2. |

**Rollout order within DB**: D3 first (projects.bound_git_branch), then D4 (github_integrations), then D5 (github_sync_log). Each migration is idempotent and self-contained. D1/D2 collapse to a no-op because the schema already uses `TEXT` for every commit_id / hash column — only application code needs to drop "16-char" assumptions.

---

## 4. Plan — Backend (Python)

### 4.1 MUT protocol contract (must do first)

| # | Change | Files |
|---|---|---|
| B1 | Switch the in-process server to git loose-object format | `src/mut_engine/server/server_repo.py`, `src/mut_engine/services/{direct_writer,tree_splice,tree_reader}.py`. Use `mut.foundation.git_format.{encode_object, decode_object, encode_tree}`. ObjectStore stores `loose_bytes` keyed by SHA-1. |
| B2 | New commit creation produces real git commit objects | `direct_writer.py`. Replace the old 16-hex commit_id helper with `_make_commit(...)` from `mut.server.handlers`. The returned SHA-1 IS the new `mut_commits.commit_id`. |
| B3 | Clone / Pull responses ship the head commit object in `objects` dict | `protocol_router.py` clone + pull handlers. Mirror `mut/server/handlers.py` and `mut/server/server.py`. |
| B4 | Push response carries `commit_object` (loose bytes for the new commit) | `protocol_router.py` push handler. Mirror `PushResponse.commit_object` field. |
| B5 | Implement `POST /api/v1/mut/{project_id}/scopes` | New `protocol_router.py` route. Returns `ScopesResponse{owned, descendants}` based on the auth context's scope and `repo_scopes` rows. |
| B6 | Implement `GET /api/v1/mut/{project_id}/ws` WebSocket | New file `src/mut_engine/router/ws_router.py`. Auth via Bearer; broadcast hooked from `direct_writer` post-commit. |
| B7 | (Optional, can defer) Server-side `bound_git_branch` enforcement on push/pull | Read `projects.bound_git_branch`, compare with a client-supplied header, reject if mismatch. MVP: skip — client already enforces. |

### 4.2 GitHub Integration (new module)

New directory `src/repo/github_integration/`:

| File | Role |
|---|---|
| `router.py` | `POST /api/v1/projects/{pid}/github/connect`, `DELETE /github/disconnect`, `POST /github/import` (manual trigger), `POST /github/export`, `POST /github/webhook`, `GET /github/status`, `GET /github/sync-log` |
| `service.py` | CRUD on `github_integrations`; orchestrates importer/exporter; writes `github_sync_log` |
| `github_api.py` | GitHub REST/GraphQL client; lists user repos, fetches tree/blob, creates commits. Token refresh via `oauth/github_service.py` |
| `importer.py` | `(integration_id, branch) → bulk_write_via_direct_writer → mut_commit_id`. Skips LFS pointers / submodules with a warning. |
| `exporter.py` | `(integration_id, target_branch) → list MUT files → create GitHub commit`. PR mode for protected branches. |
| `webhook.py` | HMAC-verify `X-Hub-Signature-256`; enqueue ARQ import job. |
| `schemas.py` | Pydantic models for the router |

**Key invariants**:

- One `project` ↔ one GitHub repo ↔ one branch (the `bound_git_branch`). Want a different branch? Make a new project.
- Webhook handler does NOT import synchronously (GitHub has a 5-second webhook timeout). Enqueues an ARQ job.
- Import is idempotent on `git_sha` (already-imported SHAs are no-ops; cross-checked via `github_sync_log`).
- Conflict policy on import (MUT has unpushed-to-GitHub changes): default = REFUSE with "force / acknowledge overwrite" UI option.

### 4.3 Background workers

| File | Change |
|---|---|
| `src/infra/scheduler/jobs/github_import_job.py` (new) | Runs `importer.run(integration_id)` for scheduled / webhook-triggered imports. |
| `src/infra/scheduler/jobs/github_export_job.py` (new) | Same, opposite direction. |
| `src/infra/scheduler/jobs/sync_job.py` | Add `connector.provider == 'github'` branch (delegates to the import job). |

### 4.4 Schema / serialisation

| Change | File |
|---|---|
| All Pydantic models exposing `commit_id` get docstring "40-hex SHA-1"; remove any `Field(max_length=16)` etc. | `src/mut_engine/schemas.py`, `src/api/responses/*.py` |
| New schemas: `MutScopesResponse`, `GitHubIntegrationStatus`, `GitHubSyncLogEntry` | New `src/repo/github_integration/schemas.py` |
| Drop any `.mutignore` references (no production code expected; verify) | global grep |

---

## 5. Plan — Frontend (Next.js)

### 5.1 API client / types

| Change | File |
|---|---|
| `MutCommitInfo.commit_id` doc → 40-hex SHA-1; display via `slice(0, 10)` | `lib/contentTreeApi.ts` |
| New `lib/githubIntegrationApi.ts`: `connectGithub`, `disconnectGithub`, `importNow`, `exportNow`, `getStatus`, `listSyncLog` | new |
| New `lib/notificationsApi.ts` + `lib/hooks/useNotifications.ts` (WebSocket subscription) | new |
| Extend `lib/repoApi.ts` with `listVisibleScopes()` (calls `/scopes` MUT endpoint, returns owned + descendants) | existing |

### 5.2 New UI

| Component / page | File |
|---|---|
| **GitHub tab** in project settings | `app/(main)/projects/[projectId]/settings/github/page.tsx` — repo dropdown (from user's GitHub), branch selector, direction toggle, auto-import switch |
| **Sync log** | `app/(main)/projects/[projectId]/settings/github/SyncLog.tsx` — table with status badges, manual retry button |
| **Connection-status badge** | `components/MutConnectionBadge.tsx` — green/yellow/red; hover popup with server URL, scope, bound branch |
| **Notification toast** + center | `components/NotificationToast.tsx` + `app/(main)/notifications/page.tsx` — surfaces incoming `commit_update` events |
| **Branch-binding banner** | `components/BoundBranchBanner.tsx` — single line, shown on settings/access pages: `bound to: github.com/<owner>/<repo> @ <branch>` |

### 5.3 Existing pages

| Page | Change |
|---|---|
| `history/page.tsx` | Display 40-hex `commit_id` truncated to 10 chars; show "linked git commit X" line if the MUT commit was triggered by an import |
| `access/page.tsx` | Scope detail panel adds parent/child scope info (from `/scopes` endpoint) |
| `settings/page.tsx` | Add GitHub sub-tab; show `bound_git_branch` (read-only); link to GitHub tab |
| `settings/connect/page.tsx` | GitHub OAuth status surface unchanged but linked to project-level binding state |

### 5.4 State management

| Hook | Purpose |
|---|---|
| `useNotifications(projectId)` | Maintains WS connection; SWR-mutates history / dashboard caches on incoming events |
| `useGithubIntegration(projectId)` | `useSWR(['github-integration', projectId], getStatus, {refreshInterval: 60_000})` |
| `useGithubSyncLog(integrationId)` | Lists recent imports/exports |

---

## 6. Rollout order

### Batch 1 — Wire format + commit_id
- DB migrations D1 + D2 + D3 (column widening + bound_git_branch)
- Backend B1 + B2 + B3 + B4 (loose-object format end-to-end on the embedded server)
- After this batch: existing UI keeps working with longer commit_ids; mut CLI clients on `feat/git-format-storage` interoperate cleanly.

### Batch 2 — Real-time notifications
- Backend B5 + B6 (`/scopes`, `/ws`)
- Frontend `useNotifications`, connection-status badge, notification toast/center
- After this batch: users see live "alice pushed X" toasts.

### Batch 3 — GitHub Integration
- DB migrations D4 + D5
- Backend `src/repo/github_integration/` module (full)
- Frontend GitHub tab + Sync log + branch-binding banner
- Background workers (import/export jobs, webhook handler)
- After this batch: GitHub binding flows live for power users.

### Batch 4 — Polish
- Backend B7 (server-side branch enforcement)
- DB D6 (`notification_log` for at-least-once delivery)
- LFS / submodule handling
- PR-mode export for protected branches

Each batch is independently deployable / rollback-able. Batch 1 is the only one with a wire-format break; all clients must be on the new MUT version before Batch 1 ships.

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| `projects` ↔ `git branch` 1:1 too restrictive (monorepo with multiple subprojects per branch) | Start 1:1; if needed later, promote `bound_git_branch` to a separate `project_branch_bindings` table |
| GitHub LFS pointer files imported as content | MVP rejects LFS files with a clear error; LFS support is phase 2 |
| GitHub submodules silently dropped | MVP warns + skips; recursive submodule import is phase 2 |
| Webhook duplicate fires (GitHub retries) | `github_sync_log.git_sha` UNIQUE per integration_id, ON CONFLICT DO NOTHING |
| Three-way merge direction (server-merges in MUT, client-merges in git) — import collides with unpushed MUT changes | MVP refuses; UI surfaces "MUT has unpushed changes — export first or force-import to overwrite" |
| 40-char `commit_id` indexing slowdown | TEXT type doesn't change index size meaningfully; existing indexes carry over |
| Backwards compatibility with 16-hex commit_ids in old `mut_commits` rows | Schema accepts both lengths; readers don't assume length 16 anywhere |

---

## 8. Out of scope (this plan)

- Multi-branch MUT repos in a single project (defer)
- GitHub history full import (only snapshots)
- GitLab / Bitbucket integration (only GitHub)
- New `mut-server` admin CLI (PuppyOne doesn't expose it)
- `.mutignore` migration (PuppyOne never used it)
- Rewriting `repo_scopes` schema (scope model unchanged)

---

## 9. Open questions

1. Should `bound_git_branch` live on `projects` or on `repo_scopes` (per-scope branch binding)? **Plan assumes `projects`** — confirm before D3 lands.
2. Notification delivery: WebSocket-only (ephemeral) or WebSocket + `notification_log` (durable)? **Plan defers durable to Batch 4** — confirm.
3. Server-side branch enforcement: warn-only, refuse, or rely on client? **Plan: rely on client (MVP), enforce later**.
4. GitHub repo discovery: list user's all repos via OAuth, or accept paste-in URL? **Plan assumes both: dropdown + manual input fallback**.

These are the items where a design decision changes the migration shape, so they should be resolved before Batch 1 lands.
