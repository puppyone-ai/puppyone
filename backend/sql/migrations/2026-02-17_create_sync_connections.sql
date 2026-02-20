-- L2.5 Sync Connections Table
-- 每个"外部连接"维护一套同步状态
-- 让 L2.5 能追踪：外部变了没？PuppyOne 变了没？Base 是什么？

CREATE TABLE IF NOT EXISTS sync_connections (
    id BIGSERIAL PRIMARY KEY,

    -- PuppyOne 侧
    node_id UUID NOT NULL,

    -- 适配器类型: filesystem | notion | gmail | github | google_sheets | ...
    adapter_type TEXT NOT NULL,

    -- 外部系统标识 (adapter-specific)
    -- filesystem: "/path/to/file.json"
    -- notion: "page_id=abc123"
    -- gmail: "thread_id=t456"
    external_id TEXT NOT NULL,

    -- 适配器特有配置 (JSON)
    -- filesystem: {"base_dir": "/workspace", "relative_path": "config.json"}
    -- notion: {"page_id": "abc123", "database_id": null}
    config JSONB NOT NULL DEFAULT '{}',

    -- 同步版本追踪
    last_sync_version INT NOT NULL DEFAULT 0,  -- 上次同步时 PuppyOne 的 current_version
    remote_hash TEXT,                          -- 上次同步时外部内容的 SHA-256

    -- 连接状态: active | paused | error
    status TEXT NOT NULL DEFAULT 'active',
    last_error TEXT,

    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 每个外部实体只能有一个连接
    UNIQUE(adapter_type, external_id)
);

-- 按节点查找关联的外部连接 (PUSH 方向使用)
CREATE INDEX IF NOT EXISTS idx_sync_connections_node_id
    ON sync_connections (node_id);

-- 按适配器类型 + 状态查找 (PULL 方向使用)
CREATE INDEX IF NOT EXISTS idx_sync_connections_adapter_status
    ON sync_connections (adapter_type, status);

-- 按状态过滤活跃连接
CREATE INDEX IF NOT EXISTS idx_sync_connections_status
    ON sync_connections (status) WHERE status = 'active';
