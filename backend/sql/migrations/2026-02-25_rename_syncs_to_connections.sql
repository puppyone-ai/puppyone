-- ============================================================
-- Migration: syncs → connections (规范化命名)
-- Date: 2026-02-25
--
-- connections 表是统一的"连接"抽象，承载所有外部连接关系：
--   - Sync 绑定 (provider = gmail/github/notion/filesystem/...)
--   - Agent 配置 (provider = 'agent')
--
-- 同步创建关联表:
--   - connection_access (节点权限绑定)
--   - connection_tool   (工具绑定)
-- ============================================================

-- 1. 重命名主表
ALTER TABLE IF EXISTS syncs RENAME TO connections;

-- 2. 重建索引（保持命名一致）
DROP INDEX IF EXISTS idx_syncs_project;
DROP INDEX IF EXISTS idx_syncs_node;
DROP INDEX IF EXISTS idx_syncs_provider;
DROP INDEX IF EXISTS idx_syncs_status;
DROP INDEX IF EXISTS idx_syncs_user_id;
DROP INDEX IF EXISTS idx_syncs_one_authority_per_node;
DROP INDEX IF EXISTS idx_syncs_access_key;

CREATE INDEX IF NOT EXISTS idx_connections_project   ON connections (project_id);
CREATE INDEX IF NOT EXISTS idx_connections_node      ON connections (node_id);
CREATE INDEX IF NOT EXISTS idx_connections_provider  ON connections (provider);
CREATE INDEX IF NOT EXISTS idx_connections_status    ON connections (status) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_authority_per_node
    ON connections (node_id) WHERE authority = 'authoritative';

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_access_key
    ON connections (access_key) WHERE access_key IS NOT NULL;

-- 3. 重建约束
ALTER TABLE connections DROP CONSTRAINT IF EXISTS chk_syncs_direction;
ALTER TABLE connections DROP CONSTRAINT IF EXISTS chk_syncs_authority;
ALTER TABLE connections DROP CONSTRAINT IF EXISTS chk_syncs_status;
ALTER TABLE connections DROP CONSTRAINT IF EXISTS chk_syncs_conflict_strategy;

ALTER TABLE connections ADD CONSTRAINT chk_connections_direction
    CHECK (direction IN ('inbound', 'outbound', 'bidirectional'));
ALTER TABLE connections ADD CONSTRAINT chk_connections_authority
    CHECK (authority IN ('authoritative', 'mirror'));
ALTER TABLE connections ADD CONSTRAINT chk_connections_status
    CHECK (status IN ('active', 'paused', 'error', 'syncing'));
ALTER TABLE connections ADD CONSTRAINT chk_connections_conflict_strategy
    CHECK (conflict_strategy IN ('source_wins', 'three_way_merge', 'lww'));

-- 4. RLS
DROP POLICY IF EXISTS service_role_all_syncs ON connections;
CREATE POLICY service_role_all_connections
    ON connections FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 5. 放宽 node_id NOT NULL 约束 (Agent 行 node_id 可为空)
ALTER TABLE connections ALTER COLUMN node_id DROP NOT NULL;
