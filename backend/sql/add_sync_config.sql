-- Migration: Add sync_config column to content_nodes table
-- 用于存储各 SaaS 数据源的同步配置

-- 1. 添加 sync_config 字段
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS sync_config JSONB DEFAULT NULL;

-- 2. 添加注释
COMMENT ON COLUMN content_nodes.sync_config IS '同步配置（仅同步类型节点有值），如 Notion: {"recursive": true, "max_depth": 2}，GitHub: {"branch": "main", "include_issues": true}';

-- 3. 添加索引（可选，如果需要按配置查询）
-- CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_config ON content_nodes USING gin (sync_config);

