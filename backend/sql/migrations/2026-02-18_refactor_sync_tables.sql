-- ============================================================
-- L2.5 Sync 重构：sync_connections → sync_sources + sync_mappings
--
-- sync_sources: 外部数据源（一个目录/一个 Notion workspace/一个 GitHub repo）
-- sync_mappings: 资源级映射（source 内的文件 ↔ PuppyOne 的 node）
-- ============================================================

-- 删除旧表
DROP TABLE IF EXISTS sync_connections;

-- ============================================================
-- sync_sources: 数据源定义
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_sources (
    id            BIGSERIAL    PRIMARY KEY,
    project_id    UUID         NOT NULL,
    adapter_type  TEXT         NOT NULL,          -- filesystem | github | notion | gmail | ...
    config        JSONB        NOT NULL DEFAULT '{}',  -- 适配器特定配置 (path / repo / workspace_id ...)
    trigger_config JSONB       NOT NULL DEFAULT '{}',  -- 触发器配置 { type: "watchdog" | "webhook" | "polling", ... }
    sync_mode     TEXT         NOT NULL DEFAULT 'bidirectional', -- bidirectional | pull_only | push_only
    conflict_strategy TEXT     NOT NULL DEFAULT 'three_way_merge', -- three_way_merge | external_wins | puppyone_wins | manual
    status        TEXT         NOT NULL DEFAULT 'active',  -- active | paused | error
    last_error    TEXT,
    credentials_ref TEXT,      -- 关联 oauth 表 (SaaS 类)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_sources_project  ON sync_sources (project_id);
CREATE INDEX IF NOT EXISTS idx_sync_sources_adapter   ON sync_sources (adapter_type, status);
CREATE INDEX IF NOT EXISTS idx_sync_sources_active    ON sync_sources (status) WHERE status = 'active';


-- ============================================================
-- sync_mappings: 资源级映射
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_mappings (
    id                  BIGSERIAL    PRIMARY KEY,
    source_id           BIGINT       NOT NULL REFERENCES sync_sources(id) ON DELETE CASCADE,
    node_id             UUID         NOT NULL,
    external_resource_id TEXT        NOT NULL,     -- source 内的资源标识 (相对路径 / page_id / ...)
    remote_hash         TEXT,                      -- 上次同步时外部内容的 SHA-256
    last_sync_version   INT          NOT NULL DEFAULT 0,  -- 上次同步时 PuppyOne 侧的 current_version
    status              TEXT         NOT NULL DEFAULT 'synced',  -- synced | conflict | error
    last_error          TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(source_id, external_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_mappings_source  ON sync_mappings (source_id);
CREATE INDEX IF NOT EXISTS idx_sync_mappings_node    ON sync_mappings (node_id);
