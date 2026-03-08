-- ============================================================
-- Fix Missing Migrations
-- ============================================================
-- Detected by check_migration_completeness.sql:
--   1. projects.visibility column
--   2. project_members table
--   3. sync_runs table
--   4. mcps table
--   5. mcp_bindings table
-- ============================================================

-- ============================================================
-- 1. projects.visibility
-- ============================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_visibility_check'
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT projects_visibility_check
            CHECK (visibility IN ('org', 'private'));
    END IF;
END $$;

-- ============================================================
-- 2. project_members
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'editor'
                CHECK (role IN ('admin', 'editor', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS service_role_all_project_members ON project_members';
    EXECUTE 'CREATE POLICY service_role_all_project_members ON project_members FOR ALL TO service_role USING (true) WITH CHECK (true)';
END $$;

-- ============================================================
-- 3. sync_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    sync_id     TEXT NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'running',
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    exit_code   INT,
    stdout      TEXT,
    error       TEXT,
    trigger_type TEXT DEFAULT 'manual',
    result_summary TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_sync_id ON public.sync_runs(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON public.sync_runs(started_at DESC);

-- ============================================================
-- 4. mcps (MCP 实例)
-- ============================================================
CREATE TABLE IF NOT EXISTS mcps (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    api_key         TEXT NOT NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    table_id        TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    name            TEXT,
    json_path       TEXT NOT NULL DEFAULT '',
    status          INT NOT NULL DEFAULT 0,
    port            INT,
    docker_info     JSONB,
    tools_definition JSONB,
    register_tools  JSONB,
    preview_keys    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. mcp_bindings (MCP 工具绑定)
-- ============================================================
CREATE TABLE IF NOT EXISTS mcp_bindings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mcp_id      BIGINT NOT NULL REFERENCES mcps(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    status      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_bindings_mcp_id ON mcp_bindings(mcp_id);
