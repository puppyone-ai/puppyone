-- ============================================================
-- Unified Sync Architecture — Step 1: 创建新表
-- Date: 2026-02-24
--
-- 纯增量操作，不修改任何现有表，安全运行。
--
-- 创建：
--   1. syncs    — 统一同步关系表（替代 sync_sources + content_nodes 上的 sync 字段）
--   2. uploads  — 一次性上传/导入任务表（替代 etl_task + sync_task + search_index_task）
-- ============================================================


-- ============================================================
-- 1. syncs — 统一同步关系表
-- ============================================================
--
-- 一条 syncs 记录 = 一个外部系统与一个 workspace 节点之间的持久同步关系
--
-- 替代：
--   sync_sources (连接级配置)
--   content_nodes 上的 sync_* 字段 (节点级同步状态)
--   sync_task 的配置部分 (同步触发配置)

CREATE TABLE IF NOT EXISTS syncs (
    -- ========== 核心身份 ==========
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    node_id             TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,

    -- ========== 同步定义 ==========
    direction           TEXT NOT NULL,
    provider            TEXT NOT NULL,
    authority           TEXT NOT NULL DEFAULT 'mirror',

    -- ========== 适配器配置 ==========
    config              JSONB NOT NULL DEFAULT '{}',

    -- ========== 认证 ==========
    credentials_ref     TEXT,
    access_key          TEXT,

    -- ========== 触发策略 ==========
    trigger             JSONB NOT NULL DEFAULT '{"type": "manual"}',

    -- ========== 冲突策略 ==========
    conflict_strategy   TEXT NOT NULL DEFAULT 'three_way_merge',

    -- ========== 运行时状态 ==========
    status              TEXT NOT NULL DEFAULT 'active',
    cursor              BIGINT DEFAULT 0,
    last_synced_at      TIMESTAMPTZ,
    error_message       TEXT,

    -- ========== 远端状态跟踪 ==========
    remote_hash         TEXT,
    last_sync_version   INT NOT NULL DEFAULT 0,

    -- ========== 时间戳 ==========
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每个节点最多一个 authoritative sync
CREATE UNIQUE INDEX IF NOT EXISTS idx_syncs_one_authority_per_node
    ON syncs (node_id) WHERE authority = 'authoritative';

-- access_key 唯一（用于 CLI / MCP 认证）
CREATE UNIQUE INDEX IF NOT EXISTS idx_syncs_access_key
    ON syncs (access_key) WHERE access_key IS NOT NULL;

-- 查询索引
CREATE INDEX IF NOT EXISTS idx_syncs_project   ON syncs (project_id);
CREATE INDEX IF NOT EXISTS idx_syncs_node      ON syncs (node_id);
CREATE INDEX IF NOT EXISTS idx_syncs_provider  ON syncs (provider);
CREATE INDEX IF NOT EXISTS idx_syncs_status    ON syncs (status) WHERE status = 'active';

-- 约束
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_direction
    CHECK (direction IN ('inbound', 'outbound', 'bidirectional'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_authority
    CHECK (authority IN ('authoritative', 'mirror'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_status
    CHECK (status IN ('active', 'paused', 'error', 'syncing'));
ALTER TABLE syncs ADD CONSTRAINT chk_syncs_conflict_strategy
    CHECK (conflict_strategy IN ('source_wins', 'three_way_merge', 'lww'));

-- RLS
ALTER TABLE syncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_syncs
    ON syncs FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================
-- 2. uploads — 一次性上传/导入任务表
-- ============================================================
--
-- 所有一次性后台任务：文件上传处理、一次性导入、搜索索引构建
--
-- 替代：
--   etl_task (文件 OCR + LLM 后处理)
--   sync_task (一次性 SaaS 导入)
--   search_index_task (搜索索引构建)

CREATE TABLE IF NOT EXISTS uploads (
    -- ========== 核心身份 ==========
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    node_id         TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,

    -- ========== 任务类型 ==========
    type            TEXT NOT NULL,

    -- ========== 任务配置 ==========
    config          JSONB NOT NULL DEFAULT '{}',

    -- ========== 进度状态 ==========
    status          TEXT NOT NULL DEFAULT 'pending',
    progress        INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    message         TEXT,
    error           TEXT,

    -- ========== 结果 ==========
    result_node_id  TEXT REFERENCES content_nodes(id) ON DELETE SET NULL,
    result          JSONB,

    -- ========== 时间戳 ==========
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_uploads_project   ON uploads (project_id);
CREATE INDEX IF NOT EXISTS idx_uploads_node      ON uploads (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uploads_status    ON uploads (status);
CREATE INDEX IF NOT EXISTS idx_uploads_type      ON uploads (type);
CREATE INDEX IF NOT EXISTS idx_uploads_created   ON uploads (created_at DESC);

-- 约束
ALTER TABLE uploads ADD CONSTRAINT chk_uploads_status
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

ALTER TABLE uploads ADD CONSTRAINT chk_uploads_type
    CHECK (type IN ('file_ocr', 'file_postprocess', 'import', 'search_index'));

-- RLS
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_uploads
    ON uploads FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================
-- 完成 Step 1
--
-- 新增表：
--   syncs   — 持久化同步配置 + 运行时状态
--   uploads — 一次性后台任务
--
-- 未改动任何现有表，可安全回滚：
--   DROP TABLE IF EXISTS uploads;
--   DROP TABLE IF EXISTS syncs;
-- ============================================================
