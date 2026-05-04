# Access Point Redesign — Design Doc

**Date**: 2026-05-02 (revised)
**Author**: claude-code-1m on `feat/access-point-redesign`
**Base**: `puppyone@origin/qubits` (`9d10c362`) + `mut@origin/main` (`2929d89`)
**Status**: Approved direction (Q1–Q6 resolved). Implementation in progress.

---

## 0. TL;DR

Today our `access_points` table is doing **five different jobs** (filesystem CLI auth, agent identity, MCP endpoint, sandbox endpoint, third-party datasource sync). The product has been calling all five "access points" but to a user they look like five unrelated things, and the one piece they actually need to understand — the **scope** — is invisible.

This redesign separates those concerns into **strict, per-table responsibilities** (per the directive "access point 应该并入到 repo 相关的存储；scope/config 单独；connector 单独；不要混在一起"):

| Concept | What it is | Where it lives | Cardinality |
|---------|-----------|---------------|-------------|
| **Repo identity** | The project's URL + agent prompt template. | `projects` (extended columns) | 1 per project |
| **Scope** | A subtree (`path` + `exclude` + `mode`). Each scope owns its own access key. | `repo_scopes` (new) | N per project |
| **Connector** | A data-flow channel bound to a scope. CLI + Agent are auto-INSERTed for every scope; third-party are user-created. | `connectors` (new) | M per project, ≥ `2 × |scopes|` (cli + agent always) |
| **OAuth Connection** | A user's third-party account login (per-user-per-provider). Reused across many connectors. | `oauth_connections` (existing, unchanged) | 1 per user per provider |
| **Repo User Permission** | (team plans) Per-user CRUD on a repo / on specific scopes. | `repo_user_permissions` (new) | as needed; default = inherit org_member |

**Drops**:
- `access_points` table — fully retired. Its rows split into `repo_scopes` (filesystem identity → scope) and `connectors` (everything else). Identity-level fields move to `projects`.

**Renames**:
- `sync_runs` → `connector_runs`.

**No changes**:
- `mut` library — wire protocol untouched, scope-manager interface unchanged.
- `mut_scope_state` — per-scope versioning still drives Merkle hashing.
- `oauth_connections` — user-level OAuth tokens unchanged.

---

## 1. Why this change

### 1.1 Current confusion (verified 2026-05-02)

1. **"Access Point" is overloaded.** A row with `provider='filesystem'` is a CLI mount key. `provider='notion'` is an OAuth-backed sync. `provider='agent'` is a chat profile. Same table, same UI affordance, completely different mental models.

2. **Scope is invisible.** `frontend/app/(main)/projects/[projectId]/access/page.tsx` shows scope as a read-only "Path" string. There is no scope CRUD anywhere. PR #1216's plug button on `/data` *implicitly* derives scope from the clicked path.

3. **Auth is bound to the connector.** Every datasource AP carries its own `access_key`. Two Notion connections to one repo means two keys. The "which one is *the* repo URL" question has no good answer.

4. **Connector ↔ scope is rigid.** A Notion AP is born at one path and dies there. Re-targeting requires delete + recreate.

5. **No team-level user permissions.** `org_members` is binary in/out. No way to say "Alice can read repo A, write repo B".

### 1.2 What the user wants the mental model to be

> The **repo URL is the access point** — one per repo. User copies it (with a prompt template explaining the mut protocol) into Claude Code / Cursor / Codex / OpenClaw and they're connected.
>
> **Scopes are the structural slices** — user-managed CRUD. Defaults derived from existing top-level folders, freely added/excluded/deleted. Auth follows scope automatically: each scope auto-mints its own access key. Multiple scopes ⇒ multiple keys per repo.
>
> **Connectors are channels** — CLI + Agent are always present for every scope (auto-INSERTed). Third-party (Notion / Gmail / URL / …) are user-created, must pick `import` or `export` direction at create time. OAuth account linkage is separated and reused across many connectors.

### 1.3 Goals

- One repo URL per project.
- Per-scope auto-generated access keys (multiple keys per repo via multiple scopes).
- Explicit scope CRUD in the UI; drag-and-drop scope onto connector creation.
- Hard separation: `projects` (identity) / `repo_scopes` (structure) / `connectors` (channels).
- Team-level `repo_user_permissions` table (denied-overrides-allow).
- Drop `access_points` table cleanly (data fully migrated).

### 1.4 Non-goals

- Changing the mut wire protocol or any mut library code. Per design directive #9: "mut 层面的同步机制没有改动".
- Real-time presence / collaboration features.
- Adding new third-party providers (only re-shaping existing ones).

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| **Project** / **Repo** | Synonymous. The versioned context base. `projects` table holds identity. |
| **Repo URL** | `https://api.puppyone.com/api/v1/mut/<project_id>` — the project's mut endpoint. The "access point" the user copies. |
| **Prompt Template** | Per-project text the user pastes into their agent alongside the repo URL. Explains the mut protocol so the agent can self-onboard. |
| **Scope** | A subtree (`path` + `exclude` + `mode`). One row in `repo_scopes`. Each scope owns its own `access_key`. |
| **Root scope** | Auto-created for every project, `path=''`, never deletable. |
| **Connector** | A data-flow channel for one scope. `provider` ∈ {cli, agent, notion, gmail, github, google_sheets, google_docs, google_calendar, url, supabase, …}. |
| **Built-in connector** | `provider='cli'` or `provider='agent'`. Auto-INSERTed for every scope. Bidirectional. No OAuth. |
| **Third-party connector** | Provider in the OAuth-backed set. User-created. Direction must be picked: `inbound` (import) or `outbound` (export). |
| **OAuth Connection** | User's link to a third-party account (per-user-per-provider). Stored in `oauth_connections`. Reused across many connectors. |
| **Repo User Permission** | (team plans) Override of the default org_member access for a single user on a single repo. |

Three things that **stay the same**:
- `mut_scope_state` — per-scope version + Merkle hash.
- `oauth_connections` — user-level OAuth tokens.
- mut library API (clone / push / pull / negotiate / rollback / pull-commit).

---

## 3. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Project (1)                                                              │
│  ├─ repo URL  ─────────────►  https://api.puppyone.com/api/v1/mut/<pid>  │
│  ├─ prompt_template ────────►  pasted into Claude/Cursor/Codex/OpenClaw │
│  │                                                                       │
│  ├─ Scope (N) ─────────► path + exclude[] + mode + access_key             │
│  │     │                                                                  │
│  │     ├─ Connector: provider='cli'   (auto, bidir)                       │
│  │     ├─ Connector: provider='agent' (auto, bidir)                       │
│  │     └─ Connector: provider='notion'/'gmail'/'url'/… (user, in|out)     │
│  │                                                                       │
│  └─ User Permissions (T, team plans only)                                │
│                                                                          │
│  External (unchanged):                                                   │
│   - mut_scope_state                                                      │
│   - oauth_connections (per user, per provider)                           │
│   - connector_runs (renamed from sync_runs)                              │
└──────────────────────────────────────────────────────────────────────────┘
```

Connector → scope is many-to-one. Connector → oauth_connection is many-to-one (multiple connectors reuse one OAuth login). One repo URL per project.

---

## 4. mut layer changes

**Zero changes to the mut library.** Per design directive #9. The library is scope-only, auth-agnostic; the embedder (puppyone) does all auth resolution. Verified during the 2026-05-02 audit:
- `mut/server/handlers.py` accepts an `auth` dict containing `_scope`. The handlers look at `path`, `exclude`, `mode` only.
- `mut/server/scope_manager.py` has a `ScopeBackend` abstraction. Puppyone's `SupabaseScopeBackend` implements it.

What changes is **puppyone's scope backend implementation**: it switches from `access_points.config` to `repo_scopes`. That's a backend-only change inside `backend/src/mut_engine/`.

**Verified compatibility**: existing `mut connect <url>` cli setups continue to work because:
- The URL path stays `/api/v1/mut/ap/{access_key}`.
- Old keys (`cli_xxx`) get migrated to `repo_scopes.access_key` rows during data-migration.
- Server-side resolution `access_key → scope → project_id` returns the same shape.

---

## 5. Database schema

### 5.1 New table: `repo_scopes`

```sql
CREATE TABLE repo_scopes (
    id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id    TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Display name. e.g. "Documentation", "Source code". Editable.
    name          TEXT        NOT NULL,

    -- Canonical path. Empty string '' = root scope. No leading/trailing /.
    -- Same canonicalization as mut_scope_state.scope_path
    -- (cf. supabase/migrations/20260416100000_scope_path_canonical.sql).
    path          TEXT        NOT NULL,

    -- Subtree exclusions; entries are path-relative to `path`.
    exclude       JSONB       NOT NULL DEFAULT '[]'::JSONB,

    -- 'r' (read-only) or 'rw' (read-write).
    mode          TEXT        NOT NULL DEFAULT 'rw'
        CHECK (mode IN ('r', 'rw')),

    -- Auto-created project-root scope. Never deletable.
    is_root       BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Per-scope access key. Auto-generated on INSERT.
    -- This is the mut credential for this scope.
    -- Format: cli_<urlsafe-32>  (matches existing access_points.access_key format).
    access_key            TEXT        NOT NULL UNIQUE,
    access_key_revoked_at TIMESTAMPTZ,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (project_id, path)
);

-- Exactly one root scope per project.
CREATE UNIQUE INDEX idx_repo_scopes_one_root_per_project
    ON repo_scopes (project_id) WHERE is_root = TRUE;

CREATE INDEX idx_repo_scopes_project ON repo_scopes (project_id);
CREATE INDEX idx_repo_scopes_access_key ON repo_scopes (access_key)
    WHERE access_key_revoked_at IS NULL;

ALTER TABLE repo_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repo_scopes_service_role_all" ON repo_scopes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Invariants** (enforced by service layer + DB):
- One `is_root=true` scope per project.
- `path` canonicalized (no leading/trailing `/`).
- `access_key` unique across the entire table.
- INSERT triggers auto-create cli + agent connectors (see §5.3).

**Decision (Q2)**: We deliberately put `access_key` directly on `repo_scopes` instead of a separate `scope_auths` table. Rationale: 1 key per scope is the natural model; multiple keys per repo is achieved naturally by having multiple scopes. Future "shared key for read-only access" can be added as a `scope_auth_aliases` table without breaking this schema.

### 5.2 New table: `connectors`

```sql
CREATE TABLE connectors (
    id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id            TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_id              TEXT        NOT NULL REFERENCES repo_scopes(id) ON DELETE CASCADE,

    -- Channel kind.
    --   'cli'    — user's local mut CLI. Auto-INSERTed per scope. Bidir.
    --   'agent'  — PuppyOne's in-app chat agent. Auto-INSERTed per scope. Bidir.
    --   'notion' / 'gmail' / 'google_docs' / 'google_sheets' /
    --   'google_calendar' / 'google_drive' / 'github' / 'linear' /
    --   'airtable' / 'url' / 'rss' / 'rest_api' / 'supabase' / etc.
    provider              TEXT        NOT NULL,

    -- Display name (user-editable for third-party; fixed for cli/agent).
    name                  TEXT        NOT NULL,

    -- Direction:
    --   'bidirectional' — only for cli, agent.
    --   'inbound'       — third-party → repo (import).
    --   'outbound'      — repo → third-party (export).
    direction             TEXT        NOT NULL
        CHECK (direction IN ('bidirectional', 'inbound', 'outbound')),

    -- Provider-specific config: notion page_id, gmail label, github repo, etc.
    -- For cli/agent this is empty {}.
    -- For agent: {mcp_api_key} so MCP service callers can find the agent.
    config                JSONB       NOT NULL DEFAULT '{}'::JSONB,

    -- For OAuth-backed third-party: the user account this connector authenticates as.
    -- NULL for cli, agent, and self-auth providers (e.g. raw URL with API key).
    oauth_connection_id   TEXT        REFERENCES oauth_connections(id) ON DELETE SET NULL,

    -- Sync trigger config: {"type": "manual" | "scheduled" | "on_change", "config": {...}}.
    trigger               JSONB       NOT NULL DEFAULT '{"type": "manual"}'::JSONB,

    -- Lifecycle.
    status                TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'syncing', 'error')),
    last_run_at           TIMESTAMPTZ,
    last_run_id           TEXT,
    error_message         TEXT,

    -- Audit.
    created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Built-in cli/agent: at most one per (scope, provider). Enforced by partial UNIQUE.
    UNIQUE (scope_id, provider)
        WHERE provider IN ('cli', 'agent')
);

CREATE INDEX idx_connectors_project ON connectors (project_id);
CREATE INDEX idx_connectors_scope ON connectors (scope_id);
CREATE INDEX idx_connectors_oauth ON connectors (oauth_connection_id)
    WHERE oauth_connection_id IS NOT NULL;
CREATE INDEX idx_connectors_provider_pid ON connectors (project_id, provider);

ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "connectors_service_role_all" ON connectors
    FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Decision (Q1)**: built-in connectors are **auto-INSERTed** on scope creation, not synthetic. Rationale: removes a confusing "click to materialize" step; users see the same row count whether they've customized or not; enables a single canonical query path. The trigger that creates these rows lives in §5.3.

### 5.3 Auto-INSERT trigger: `repo_scopes` → builtin connectors

```sql
CREATE OR REPLACE FUNCTION create_builtin_connectors_for_scope()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO connectors (project_id, scope_id, provider, name, direction, config, status)
    VALUES
        (NEW.project_id, NEW.id, 'cli',   'Local CLI', 'bidirectional', '{}'::JSONB, 'active'),
        (NEW.project_id, NEW.id, 'agent', 'AI Agent',  'bidirectional', '{}'::JSONB, 'active');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_builtin_connectors
    AFTER INSERT ON repo_scopes
    FOR EACH ROW
    EXECUTE FUNCTION create_builtin_connectors_for_scope();
```

This ensures the invariant "every scope has cli + agent connectors" without service-layer duplication. The trigger fires inside the same transaction as the scope INSERT, so we never see a half-state.

### 5.4 New table: `repo_user_permissions`

```sql
CREATE TABLE repo_user_permissions (
    id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- 'admin'   — full project control + can manage permissions
    -- 'editor'  — read + write through cli/agent/connectors
    -- 'reader'  — read only
    -- 'denied'  — explicitly blocked (overrides any role granted by org membership)
    role         TEXT        NOT NULL
        CHECK (role IN ('admin', 'editor', 'reader', 'denied')),

    -- Optional fine-grained scope filter. NULL = "all scopes in project".
    -- Non-empty array restricts the user to those scope_ids.
    -- Ignored for role='denied'.
    allowed_scope_ids JSONB,

    granted_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (project_id, user_id)
);

CREATE INDEX idx_repo_user_perm_user ON repo_user_permissions (user_id);

ALTER TABLE repo_user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repo_user_perm_service_role_all" ON repo_user_permissions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Resolution rule** (`platform/project/access.py:verify_project_access`):
1. If `repo_user_permissions` row exists for `(project_id, user_id)`:
   - `role='denied'` → deny.
   - else allow with that role.
2. Else fall back to `org_members`: any org member gets effective `editor`.
3. Else deny.

`repo_user_permissions` is **opt-in**. Solo / personal-org projects unaffected.

### 5.5 Existing tables — modifications

**`projects`** — add identity fields:
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prompt_template TEXT;
-- mut_version, mut_root_hash already exist (legacy global hash; kept for backwards compat
-- but deprecated by mut_scope_state).
```

**`sync_runs` → `connector_runs`** (Q3):
```sql
ALTER TABLE sync_runs RENAME TO connector_runs;
ALTER TABLE connector_runs RENAME COLUMN access_point_id TO connector_id;
-- Indexes auto-rename with the table; service code updates separately.
```

**`access_points` table — DROP after migration (Q5)**. The data migration script (§5.7) splits its rows into `repo_scopes` and `connectors`, then the table is dropped. Before drop:
1. All datasource rows → `connectors`.
2. All filesystem rows → `repo_scopes` (path/exclude/mode + access_key copied directly).
3. All agent rows → `connectors` (with `mcp_api_key` preserved in `config`).
4. All mcp / sandbox rows → `connectors`.
5. `connector_runs.connector_id` updated to point at the new connector ids.
6. `mut_scope_state` rows kept as-is (already keyed by `scope_path`, not `access_point_id`).

### 5.6 `gateways` table (Q6)

`gateways` is **deprecated but kept** during this redesign. Q6 clarifies that even team accounts are "team's-user-X-account, not literally a team account" — every OAuth login is naturally per-user. So `oauth_connections` is the right home; `gateways` was an unnecessary org-level abstraction.

We will:
- Stop creating new `gateways` rows.
- Migrate every existing `gateway` row → `oauth_connections` row (re-attributed to the org owner who created it). Connectors that previously pointed at `gateway_id` repoint to `oauth_connection_id`.
- Drop `gateways` in a follow-up migration after the dust settles.

### 5.7 Migration files (in order)

```
20260502000000_repo_scopes_table.sql              # CREATE TABLE repo_scopes + auto-key generation
20260502000100_connectors_table.sql               # CREATE TABLE connectors + builtin trigger
20260502000200_repo_user_permissions_table.sql    # CREATE TABLE repo_user_permissions
20260502000300_projects_add_prompt_template.sql   # ALTER projects ADD prompt_template
20260502000400_sync_runs_rename.sql               # RENAME sync_runs → connector_runs
20260502000500_backfill_root_scopes.sql           # INSERT repo_scopes (is_root=true) for every existing project
20260502000600_split_access_points.sql            # Data migration: access_points → repo_scopes + connectors (PYTHON SCRIPT)
20260502000700_drop_access_points.sql             # Final DROP after data verified moved
20260502000800_migrate_gateways_to_oauth.sql      # Gateways → oauth_connections
20260502000900_drop_gateways.sql                  # Final DROP gateways
```

Each follows existing convention: BEGIN/COMMIT, `IF NOT EXISTS`, `DO $$` for conditional logic, RLS service_role policy. Pattern: `supabase/migrations/20260427000000_oauth_state_csrf.sql`.

The data migration `20260502000600_*` is too complex for plpgsql (canonical-path normalization, conflict resolution, key-uniqueness preservation). Implemented as `backend/scripts/migrate_access_points_to_v2.py` and run before the SQL DROP migration.

---

## 6. Backend changes

### 6.1 New module structure

```
backend/src/repo/
├── __init__.py
├── models.py                    # RepoScope, Connector, RepoUserPermission domain models
├── schemas.py                   # Pydantic DTOs
│
├── scope_repository.py          # Supabase repo_scopes CRUD
├── scope_service.py             # Business logic: auto-key gen, builtin enforcement
├── scope_router.py              # /api/v1/projects/{pid}/scopes
│
├── connector_repository.py      # Supabase connectors CRUD
├── connector_service.py         # Business logic + run orchestration
├── connector_router.py          # /api/v1/projects/{pid}/connectors
│
├── permission_repository.py     # Supabase repo_user_permissions CRUD
├── permission_service.py        # ResolvedPermission, denied-overrides-allow
├── permission_router.py         # /api/v1/projects/{pid}/permissions
│
└── identity_router.py           # /api/v1/projects/{pid}/access-point
                                 # GET project URL + prompt + key visibility
```

### 6.2 API contract — Repo Identity (project-level)

```
GET    /api/v1/projects/{project_id}/access-point
       → {
           url: "https://api.puppyone.com/api/v1/mut/<project_id>",
           prompt_template: "...",
           scopes: [{ id, name, path, access_key (visible to admins/editors), is_root }],
         }
       — single page, single source of truth for "what does the user copy"

PATCH  /api/v1/projects/{project_id}/access-point
       body: { prompt_template?: string }
       — admin only
```

Note: there is **no separate "regenerate key for the repo"** endpoint. Keys are per-scope; rotate via the scope endpoint.

### 6.3 API contract — Scope CRUD

```
GET    /api/v1/projects/{project_id}/scopes
       → list, root pinned first

POST   /api/v1/projects/{project_id}/scopes
       body: { name, path, exclude?: string[], mode?: 'r'|'rw' }
       — DB trigger auto-INSERTs cli + agent connectors
       — service layer auto-generates access_key
       — 201 with { scope, builtin_connectors: [cli, agent] }

PATCH  /api/v1/projects/{project_id}/scopes/{scope_id}
       body: { name?, exclude?, mode? }
       — `path` is immutable post-create (rename = delete + recreate)

DELETE /api/v1/projects/{project_id}/scopes/{scope_id}
       — 400 if is_root
       — 409 if any non-builtin connectors are bound (lists them in response)
       — cascade: drops cli + agent connectors via FK
       — also drops mut_scope_state row for that path

POST   /api/v1/projects/{project_id}/scopes/{scope_id}/regenerate-key
       — admin only; revokes old key, mints new

POST   /api/v1/projects/{project_id}/scopes/auto-suggest
       → returns proposed scopes from current top-level folders in the repo tree
       — used by "first-time scope setup" wizard
```

### 6.4 API contract — Connectors

```
GET    /api/v1/projects/{project_id}/connectors
       — flat list with scope_id; client groups by scope
       — query params: ?scope_id=, ?provider=, ?direction=

POST   /api/v1/projects/{project_id}/connectors
       body: {
         scope_id,                              # required
         provider,                              # 'notion', 'gmail', etc. (NOT 'cli'/'agent')
         direction,                             # 'inbound' or 'outbound'
         oauth_connection_id?,                  # required for OAuth providers
         config,                                # provider-specific
         trigger?: { type, config? },           # default {type: 'manual'}
         name?,                                 # default = provider's display name
       }
       — 201 with new connector

PATCH  /api/v1/projects/{project_id}/connectors/{connector_id}
       body: any of the create fields except provider, scope_id

POST   /api/v1/projects/{project_id}/connectors/{connector_id}/run
       — manual trigger; returns connector_run_id

POST   /api/v1/projects/{project_id}/connectors/{connector_id}/pause
POST   /api/v1/projects/{project_id}/connectors/{connector_id}/resume

DELETE /api/v1/projects/{project_id}/connectors/{connector_id}
       — 400 if cli or agent (not user-deletable; deleted via scope deletion)
```

### 6.5 API contract — Permissions

```
GET    /api/v1/projects/{project_id}/permissions
       → all explicit grants + the implicit org-member fallback

POST   /api/v1/projects/{project_id}/permissions
       body: { user_id, role, allowed_scope_ids? }

PATCH  /api/v1/projects/{project_id}/permissions/{user_id}
DELETE /api/v1/projects/{project_id}/permissions/{user_id}

POST   /api/v1/projects/{project_id}/permissions/check
       body: { user_id, action, scope_id? }
       → { allowed: bool, reason: string }
```

### 6.6 Existing module modifications

#### `mut_engine/server/auth.py`

`PuppyOneAuthenticator._try_access_key` switches source: `repo_scopes` instead of `access_points`.

```python
def _try_access_key(self, key: str, project_id: str) -> dict | None:
    resp = (
        self._client.table("repo_scopes")
        .select("id, project_id, path, exclude, mode, access_key_revoked_at")
        .eq("access_key", key)
        .limit(1)
        .execute()
    )
    rows = safe_data(resp)
    if not rows:
        return None
    scope = rows[0]
    if scope["project_id"] != project_id:
        return None
    if scope.get("access_key_revoked_at"):
        return None
    return {
        "id": scope["id"],
        "path": scope["path"],
        "exclude": scope.get("exclude") or [],
        "mode": scope.get("mode", "rw"),
    }
```

The `_try_jwt` path (multi-tenant hardening C-1) is unchanged. It still returns `_root` scope; this means a JWT-authenticated MUT request operates on the project root, regardless of how many scopes exist. (Open question for follow-up: should JWT pushes specify a scope explicitly?)

#### `mut_engine/server/backends/supabase_scope.py`

Reads from `repo_scopes` columns instead of `access_points.config.scope`. Major simplification — no more JSONB extraction.

#### `mut_engine/routers/access_point.py`

`resolve_access_point(access_key)` queries `repo_scopes` instead of `access_points`. Returns the same shape (project_id, scope dict). The mut HTTP route paths (`/api/v1/mut/ap/{access_key}`) are unchanged.

#### `connectors/manager/router.py`

**Deprecated**. The unified manager is replaced by the per-domain routers (`scope_router`, `connector_router`, `identity_router`). For one release, manager endpoints stay as 410-Gone with a redirect hint to the new endpoint.

#### `connectors/agent/config/`

Agent CRUD now operates on `connectors` rows with `provider='agent'`. The `mcp_api_key` lives in `connectors.config.mcp_api_key`. The MCP service still queries `/internal/agent-by-mcp-key/{key}` — that endpoint is updated to query `connectors` instead of `access_points`.

#### `connectors/datasource/oauth/router.py`

OAuth callback writes to `oauth_connections` only. **Does not auto-create a connector** — that's a separate explicit step from the user. State table `oauth_states` (multi-tenant hardening M-2) is unchanged.

#### `internal/router.py`

`/internal/agent-by-mcp-key/{key}` queries `connectors` with `provider='agent'` and `config->>'mcp_api_key' = key`. The X-Acting-User-Id contract from PR #1209 is preserved.

#### `platform/project/dashboard_router.py`

Dashboard returns three sections:
- `repo_identity`: { url, prompt_template }
- `scopes`: list of repo_scopes (with `n_connectors` summary count per scope)
- `connectors`: list of connectors (active + recent runs)

`_compute_node_counts` cache key extends to include `repo_scopes.updated_at` so the home page reflects scope edits.

### 6.7 Connector execution

`connectors/datasource/engine.py` updated:

1. Resolve OAuth credentials via `connector.oauth_connection_id` → `oauth_connections`.
2. **Inbound**: `connector.fetch(config, credentials)` → `MutOps.write_file(project_id, scope_path + '/' + relative, content)`.
3. **Outbound (Q4 — Notion stub ships in this redesign)**: `MutOps.read_file(project_id, scope_path + '/' + relative)` → `connector.push(content, config, credentials)`. We ship a single working export connector (Notion: replace existing page content with markdown from the repo) to validate the schema end-to-end. Other providers stub `.push()` with `NotImplementedError`.

---

## 7. Frontend changes

### 7.1 New page: `/projects/{id}/scopes`

Dedicated scope-management page. Linked from:
- Project sidebar between "Home" and "Context"
- A "+" call-to-action on `/data` if user has only the root scope

UI:
- Left sidebar: scope list, root pinned with badge.
- Detail panel: name (editable), path (read-only), exclude list (CRUD), mode toggle (r↔rw), key (visible/copy/regenerate).
- "Suggest from existing folders" button → previews + accept individually.
- Delete button on non-root; if connectors are bound, modal lists them.

### 7.2 `/access` page — repurpose as Repo Identity

Becomes the **single repo URL** page:
1. Repo URL with copy button.
2. Prompt template (editable inline by admins) with copy button.
3. Per-scope connect blocks: scope name + the `mut connect <url> --credential <key>` command + "Download credential file" button.
4. Filesystem onboarding kept (the existing `mut connect` block, parameterized per scope).

Ripped out: multi-AP CRUD (no more list/detail). Page becomes ~30% of current size.

### 7.3 `/data` page — connector creation flow

Plug button on tree rows now opens a **multi-step modal**:

1. **Choose scope** — dropdown or drag affordance from a side scope list. Default = scope whose path is the longest prefix of the plug-clicked path; falls back to root.
2. **Choose provider** — CLI, Agent, Notion, Gmail, …
3. **Choose direction** — Import / Export (skipped for cli/agent; they're bidir).
4. **Pick OAuth account** — if multiple linked; "Link new account" link to `/connections`.
5. **Provider config** — Notion page picker, Gmail label, etc.

Existing `useDataCreateFlow.ts` rewritten to drive this new flow.

### 7.4 `/connections` page (new)

Promoted from `UserMenuPanel.tsx`'s "Integrations" tab. Per-provider:
- "Connect" / "Connected as <workspace>" / "Disconnect".
- Reused by every connector that picks this account.

### 7.5 `/team` page — permissions tab

New "Repo permissions" tab. Per-repo member table with role dropdown + scope picker. Default state is "(implicit editor — via org membership)" with low-contrast styling.

### 7.6 `/home` page — adaptation post PR #1216

PR #1216's home redesign is largely compatible:
- `AccessPointsListCard` → `ConnectorsListCard`. Rows are connectors, with "scope: <name>" subtext.
- `ApChip` next to a tree row counts connectors whose scope path is a prefix of the row's path.
- New "Repo URL" small card at the top of the right rail: URL + copy.

### 7.7 Onboarding flow

`GettingStartedPanel.tsx` updated steps:
1. Create project ✓
2. **Set up scopes** — NEW. Wizard reads existing top-level folders, lets user confirm/add/skip. Empty project → just root scope.
3. **Get your access point** — copy URL + prompt + (root) key.
4. **Connect a tool** — first connector. Defaults to CLI with the existing `mut connect` block.
5. (team plans) Invite team members → routes to permissions page.

---

## 8. Implementation order

Per the directive "按照 mut，puppyone 数据模型，puppyone 后端代码，puppyone 前端代码的顺序执行":

### Step 1 — mut layer
**Confirmed: zero changes.** The mut library is scope-only and auth-agnostic (verified §4). All work happens in puppyone's scope backend (`backend/src/mut_engine/server/backends/supabase_scope.py`), which we treat as backend code.

### Step 2 — DB migrations
Write the migrations enumerated in §5.7. After migrations, write the data migration Python script.

Order within Step 2:
1. `20260502000000_repo_scopes_table.sql`
2. `20260502000100_connectors_table.sql`
3. `20260502000200_repo_user_permissions_table.sql`
4. `20260502000300_projects_add_prompt_template.sql`
5. `20260502000400_sync_runs_rename.sql`
6. `20260502000500_backfill_root_scopes.sql`
7. `backend/scripts/migrate_access_points_to_v2.py` (data move; no SQL file yet)
8. `20260502000700_drop_access_points.sql` (only after script verified)
9. `20260502000800_migrate_gateways_to_oauth.sql`
10. `20260502000900_drop_gateways.sql` (final cleanup)

### Step 3 — Backend
Order within Step 3:
1. `src/repo/models.py` + `schemas.py` (data classes)
2. `src/repo/scope_repository.py` + `scope_service.py` + `scope_router.py`
3. `src/repo/identity_router.py`
4. `src/repo/connector_repository.py` + `connector_service.py` + `connector_router.py`
5. `src/repo/permission_*.py`
6. Modify `mut_engine/server/auth.py` + `supabase_scope.py` (switch source)
7. Modify `mut_engine/routers/access_point.py` (resolve via repo_scopes)
8. Modify `internal/router.py` (agent-by-mcp-key reads connectors)
9. Modify `connectors/datasource/oauth/router.py` (callback writes oauth_connections only)
10. Modify `connectors/datasource/engine.py` (add export path; ship Notion `.push()`)
11. Modify `platform/project/dashboard_router.py` (three sections)
12. Deprecate `connectors/manager/router.py` (410 + redirect to new)
13. Register new routers in `main.py`
14. Tests: per-module test files + cross-module e2e in `tests/repo/`

### Step 4 — Frontend
Order within Step 4:
1. `frontend/lib/api/scopes.ts`, `connectors.ts`, `permissions.ts` (typed clients)
2. `frontend/app/(main)/projects/[projectId]/scopes/page.tsx` + components
3. Rewrite `frontend/app/(main)/projects/[projectId]/access/page.tsx` (single-AP shape)
4. Rewrite `frontend/app/(main)/projects/[projectId]/data/hooks/useDataCreateFlow.ts` (multi-step flow)
5. Update `frontend/app/(main)/projects/[projectId]/data/components/menus/CreateMenu.tsx`
6. Update `frontend/app/(main)/projects/[projectId]/home/page.tsx` + `home/components/*`
7. New `frontend/app/(main)/connections/page.tsx`; remove from `UserMenuPanel.tsx`
8. New `frontend/app/(main)/team/components/RepoPermissionsTab.tsx`
9. Onboarding update (`GettingStartedPanel.tsx`)
10. Tests: e2e flows in `frontend/__tests__/repo/`

---

## 9. Resolved decisions

| Q | Decision |
|---|---------|
| Q1 | **Auto-INSERT cli + agent connectors per scope** via DB trigger (§5.3). No synthetic rows. |
| Q2 | **Multi-key per repo via per-scope keys.** `access_key` column directly on `repo_scopes`. Multiple scopes ⇒ multiple keys per repo naturally. |
| Q3 | **`sync_runs` → `connector_runs` rename** (`ALTER TABLE RENAME`). Data preserved. |
| Q4 | **Ship one working export connector** (Notion `.push()`) to validate end-to-end. Other providers' `.push()` stub. |
| Q5 | **Drop `access_points` table entirely.** Identity → `projects` columns; structural data → `repo_scopes`; channels → `connectors`. Hard separation, no shared table. |
| Q6 | **`gateways` deprecated.** OAuth is per-user-per-provider (since even team accounts are "team's-user-X-account"). Migrate `gateways` rows → `oauth_connections`, then drop `gateways`. |

---

## 10. File change summary

### Migrations
- `supabase/migrations/20260502000000_repo_scopes_table.sql`
- `supabase/migrations/20260502000100_connectors_table.sql`
- `supabase/migrations/20260502000200_repo_user_permissions_table.sql`
- `supabase/migrations/20260502000300_projects_add_prompt_template.sql`
- `supabase/migrations/20260502000400_sync_runs_rename.sql`
- `supabase/migrations/20260502000500_backfill_root_scopes.sql`
- `supabase/migrations/20260502000700_drop_access_points.sql`
- `supabase/migrations/20260502000800_migrate_gateways_to_oauth.sql`
- `supabase/migrations/20260502000900_drop_gateways.sql`
- `backend/scripts/migrate_access_points_to_v2.py`

### Backend new
- `backend/src/repo/{__init__,models,schemas,scope_repository,scope_service,scope_router,identity_router,connector_repository,connector_service,connector_router,permission_repository,permission_service,permission_router}.py`

### Backend modified
- `backend/src/mut_engine/server/auth.py`
- `backend/src/mut_engine/server/backends/supabase_scope.py`
- `backend/src/mut_engine/routers/access_point.py`
- `backend/src/internal/router.py`
- `backend/src/connectors/datasource/oauth/router.py`
- `backend/src/connectors/datasource/engine.py`
- `backend/src/connectors/agent/config/router.py` + `repository.py`
- `backend/src/platform/project/dashboard_router.py`
- `backend/src/main.py`
- `backend/src/connectors/manager/router.py` (deprecate)

### Backend tests
- `backend/tests/repo/test_scope_service.py`
- `backend/tests/repo/test_connector_service.py`
- `backend/tests/repo/test_permission_service.py`
- `backend/tests/repo/test_repo_router_e2e.py`

### Frontend new
- `frontend/lib/api/{scopes,connectors,permissions}.ts`
- `frontend/app/(main)/projects/[projectId]/scopes/page.tsx` + components
- `frontend/app/(main)/connections/page.tsx`
- `frontend/app/(main)/team/components/RepoPermissionsTab.tsx`

### Frontend modified
- `frontend/app/(main)/projects/[projectId]/access/page.tsx`
- `frontend/app/(main)/projects/[projectId]/data/[[...path]]/page.tsx`
- `frontend/app/(main)/projects/[projectId]/data/hooks/useDataCreateFlow.ts`
- `frontend/app/(main)/projects/[projectId]/data/components/menus/CreateMenu.tsx`
- `frontend/app/(main)/projects/[projectId]/home/page.tsx`
- `frontend/app/(main)/projects/[projectId]/home/components/{ApChip,AccessPointsListCard,GetStartedPanel}.tsx`
- `frontend/components/UserMenuPanel.tsx` (remove integrations tab)
- `frontend/components/onboarding/GettingStartedPanel.tsx`

### mut library
- **No changes.** Verified scope-only / auth-agnostic interface (§4).

---

## 11. Sign-off

- [x] Q1–Q6 resolved.
- [ ] Migrations dry-run on staging Supabase project; data-migration script produces an "all rows accounted for" report before phase B SQL drops fire.
- [ ] MCP service coordinated restart scheduled for the day backend phase ships.
- [ ] Notion-export `.push()` smoke-tested against a real Notion workspace.
