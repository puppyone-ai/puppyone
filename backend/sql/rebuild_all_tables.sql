-- ============================================================
-- PuppyOne / ContextBase — 增量建表 SQL
-- 基于 2026-02-09 main 数据库诊断结果
-- 
-- 现有表（保留不动）: api_keys, credit_ledger, messages, 
--   threads, subscriptions, profiles
-- 
-- profiles 需要 ALTER 加字段
-- 其余 21 张表全部新建
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PART 1: 修改现有 profiles 表（加 3 个缺失字段）
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_onboarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS demo_project_id TEXT;

-- ============================================================
-- PART 2: 新建 21 张表（按依赖顺序）
-- ============================================================

-- 2. project — 项目
CREATE TABLE IF NOT EXISTS project (
    id            TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    name          TEXT NOT NULL,
    description   TEXT,
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. content_nodes — 内容节点树
CREATE TABLE IF NOT EXISTS content_nodes (
    id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    sync_oauth_user_id  TEXT,
    parent_id           TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,
    id_path             TEXT NOT NULL DEFAULT '/',
    preview_json        JSONB,
    preview_md          TEXT,
    s3_key              TEXT,
    mime_type           TEXT,
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    permissions         JSONB NOT NULL DEFAULT '{"inherit": true}'::JSONB,
    sync_url            TEXT,
    sync_id             TEXT,
    sync_config         JSONB,
    sync_status         TEXT NOT NULL DEFAULT 'idle',
    last_synced_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_nodes_project_id ON content_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_parent_id ON content_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_type ON content_nodes(type);
CREATE INDEX IF NOT EXISTS idx_content_nodes_id_path ON content_nodes(id_path);

-- 4. tool — 工具注册表
CREATE TABLE IF NOT EXISTS tool (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      TEXT REFERENCES project(id) ON DELETE CASCADE,
    node_id         TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    json_path       TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL,
    name            TEXT NOT NULL,
    alias           TEXT,
    description     TEXT,
    input_schema    JSONB,
    output_schema   JSONB,
    metadata        JSONB,
    category        TEXT NOT NULL DEFAULT 'builtin',
    script_type     TEXT,
    script_content  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_user_id ON tool(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_project_id ON tool(project_id);
CREATE INDEX IF NOT EXISTS idx_tool_node_id ON tool(node_id);

-- 5. agents — Agent 配置
CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    icon            TEXT NOT NULL DEFAULT '✨',
    type            TEXT NOT NULL DEFAULT 'chat',
    description     TEXT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    mcp_api_key     TEXT,
    trigger_type    TEXT DEFAULT 'manual',
    trigger_config  JSONB,
    task_content    TEXT,
    task_node_id    TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    external_config JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);

-- 6. agent_bash — Agent Bash 访问权限
CREATE TABLE IF NOT EXISTS agent_bash (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    node_id     TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    json_path   TEXT NOT NULL DEFAULT '',
    readonly    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, node_id, json_path)
);

-- 7. agent_tool — Agent 工具绑定
CREATE TABLE IF NOT EXISTS agent_tool (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES tool(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    mcp_exposed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, tool_id)
);

-- 8. agent_execution_log — Agent 执行日志
CREATE TABLE IF NOT EXISTS agent_execution_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    trigger_type    TEXT,
    trigger_source  TEXT,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    duration_ms     BIGINT,
    input_snapshot  JSONB,
    output_summary  TEXT,
    output_snapshot JSONB,
    error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_execution_log_agent_id ON agent_execution_log(agent_id);

-- 9. chat_sessions — 聊天会话
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title       TEXT,
    mode        TEXT DEFAULT 'agent',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent_id ON chat_sessions(agent_id);

-- 10. chat_messages — 聊天消息
CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT,
    parts       JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- 11. mcp — MCP 实例
CREATE TABLE IF NOT EXISTS mcp (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    api_key         TEXT NOT NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
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

-- 12. mcp_binding — MCP 工具绑定
CREATE TABLE IF NOT EXISTS mcp_binding (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mcp_id      BIGINT NOT NULL REFERENCES mcp(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES tool(id) ON DELETE CASCADE,
    status      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_binding_mcp_id ON mcp_binding(mcp_id);

-- 13. oauth_connection — OAuth 连接
CREATE TABLE IF NOT EXISTS oauth_connection (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    token_type      TEXT,
    expires_at      TIMESTAMPTZ,
    workspace_id    TEXT,
    workspace_name  TEXT,
    bot_id          TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_connection_user_id ON oauth_connection(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_connection_provider ON oauth_connection(provider);

-- 14. context_publish — 公开 JSON 发布
CREATE TABLE IF NOT EXISTS context_publish (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    table_id    TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    json_path   TEXT NOT NULL DEFAULT '',
    publish_key TEXT NOT NULL UNIQUE,
    status      BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. etl_task — 文件 ETL 任务
CREATE TABLE IF NOT EXISTS etl_task (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    rule_id     BIGINT,
    filename    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    progress    INT NOT NULL DEFAULT 0,
    error       TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}'::JSONB,
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etl_task_project_id ON etl_task(project_id);
CREATE INDEX IF NOT EXISTS idx_etl_task_user_id ON etl_task(user_id);

-- 16. etl_rule — ETL 规则
CREATE TABLE IF NOT EXISTS etl_rule (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    json_schema     JSONB,
    system_prompt   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. sync_task — SaaS 同步任务
CREATE TABLE IF NOT EXISTS sync_task (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id        TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    task_type         TEXT NOT NULL,
    source_url        TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    progress          INT NOT NULL DEFAULT 0,
    progress_message  TEXT,
    root_node_id      TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    files_total       INT DEFAULT 0,
    files_processed   INT DEFAULT 0,
    metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,
    error             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_task_project_id ON sync_task(project_id);

-- 18. search_index_task — 搜索索引任务
CREATE TABLE IF NOT EXISTS search_index_task (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tool_id               TEXT NOT NULL UNIQUE,
    user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id            TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    node_id               TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    json_path             TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'pending',
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ,
    nodes_count           INT,
    chunks_count          INT,
    indexed_chunks_count  INT,
    folder_node_id        TEXT,
    total_files           INT,
    indexed_files         INT,
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. chunks — 文本分块
CREATE TABLE IF NOT EXISTS chunks (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    node_id                 TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    json_pointer            TEXT NOT NULL DEFAULT '',
    chunk_index             INT NOT NULL DEFAULT 0,
    total_chunks            INT NOT NULL DEFAULT 1,
    chunk_text              TEXT NOT NULL,
    char_start              INT NOT NULL DEFAULT 0,
    char_end                INT NOT NULL DEFAULT 0,
    content_hash            TEXT NOT NULL DEFAULT '',
    turbopuffer_namespace   TEXT,
    turbopuffer_doc_id      TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(node_id, json_pointer, content_hash, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_node_id ON chunks(node_id);

-- 20. agent_logs — Agent 调用日志
CREATE TABLE IF NOT EXISTS agent_logs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    call_type       TEXT NOT NULL,
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
    session_id      TEXT,
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    latency_ms      BIGINT,
    error_message   TEXT,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at);

-- 21. access_logs — 数据访问日志
CREATE TABLE IF NOT EXISTS access_logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    node_id     TEXT,
    node_type   TEXT,
    node_name   TEXT,
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
    session_id  TEXT,
    project_id  TEXT REFERENCES project(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_project_id ON access_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);

-- 22. db_connections — 外部数据库连接
CREATE TABLE IF NOT EXISTS db_connections (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    provider    TEXT NOT NULL DEFAULT 'supabase',
    config      JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_connections_project_id ON db_connections(project_id);

-- ============================================================
-- PART 3: 启用 RLS
-- ============================================================
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_bash ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_publish ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE db_connections ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 4: RLS 策略 — service_role 全权访问
-- （后端用 service_role key，需要绕过 RLS）
-- ============================================================
DO $$
DECLARE
    tbl TEXT;
    policy_name TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'profiles', 'project', 'content_nodes', 'tool', 'agents',
            'agent_bash', 'agent_tool', 'agent_execution_log',
            'chat_sessions', 'chat_messages', 'mcp', 'mcp_binding',
            'oauth_connection', 'context_publish', 'etl_task', 'etl_rule',
            'sync_task', 'search_index_task', 'chunks', 'agent_logs',
            'access_logs', 'db_connections'
        ])
    LOOP
        policy_name := 'service_role_all_' || tbl;
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            policy_name, tbl
        );
    END LOOP;
END $$;

-- ============================================================
-- 完成！
-- 现有 6 张表保留不动: api_keys, credit_ledger, messages,
--   threads, subscriptions, profiles (已 ALTER)
-- 新建 21 张 PuppyOne 业务表
-- 共 27 张表
-- ============================================================
