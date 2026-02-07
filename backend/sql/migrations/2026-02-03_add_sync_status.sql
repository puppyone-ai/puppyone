-- ============================================================
-- Migration: Add sync_status field to content_nodes
-- Date: 2026-02-03
-- Purpose: 支持占位符节点 (placeholder) 和完整的同步状态管理
-- ============================================================

-- 1. 添加 sync_status 字段
-- 状态说明:
--   'not_connected' - 占位符，用户未授权连接
--   'idle'          - 空闲，等待下次同步（已连接）
--   'syncing'       - 正在同步中
--   'error'         - 最近一次同步失败
ALTER TABLE content_nodes 
ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'idle';

-- 2. 添加约束，限制有效值
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_sync_status'
    ) THEN
        ALTER TABLE content_nodes 
        ADD CONSTRAINT chk_sync_status 
        CHECK (sync_status IN ('not_connected', 'idle', 'syncing', 'error'));
    END IF;
END $$;

-- 3. 为现有的 synced 节点设置正确状态
-- 如果有 sync_url，说明是已连接的节点
UPDATE content_nodes 
SET sync_status = 'idle' 
WHERE sync_url IS NOT NULL 
  AND sync_status = 'idle';

-- 4. 创建索引（快速查询占位符或出错节点）
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_status 
ON content_nodes(sync_status);

-- 5. 创建复合索引（按项目查询特定状态的节点）
CREATE INDEX IF NOT EXISTS idx_content_nodes_project_sync_status 
ON content_nodes(project_id, sync_status);

-- 6. 添加字段注释
COMMENT ON COLUMN content_nodes.sync_status IS 
'同步状态: not_connected(占位符/未授权), idle(空闲/已连接), syncing(同步中), error(出错)';

-- ============================================================
-- 验证迁移结果
-- ============================================================
DO $$
DECLARE
    col_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'content_nodes' 
        AND column_name = 'sync_status'
    ) INTO col_exists;
    
    IF col_exists THEN
        RAISE NOTICE '✅ Migration successful: sync_status column added to content_nodes';
    ELSE
        RAISE EXCEPTION '❌ Migration failed: sync_status column not found';
    END IF;
END $$;

-- ============================================================
-- 查看当前状态分布（可选，用于验证）
-- ============================================================
-- SELECT sync_status, COUNT(*) as count 
-- FROM content_nodes 
-- GROUP BY sync_status;



