-- ============================================================================
-- Migration: 重构 content_nodes 的用户所有权字段
-- Date: 2026-02-05
-- 
-- 变更说明：
--   1. user_id → created_by（创建者，仅记录，可空）
--   2. 新增 sync_oauth_user_id（sync 类型专用，存储绑定的 OAuth 用户）
--   3. 添加 project_id 外键约束
--   4. 添加安全约束：sync 类型必须有 sync_oauth_user_id
--
-- 新架构：
--   - project_id: 所属项目（必填，有外键）
--   - created_by: 创建者 ID（可空，仅记录）
--   - sync_oauth_user_id: OAuth 绑定用户（仅 sync 类型必填）
-- ============================================================================

-- ============================================
-- Step 1: 先检查当前状态（运行这个查询确认）
-- ============================================
-- SELECT 
--   column_name, data_type, is_nullable,
--   (SELECT COUNT(*) FROM information_schema.table_constraints tc
--    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
--    WHERE tc.table_name = 'content_nodes' AND ccu.column_name = c.column_name AND tc.constraint_type = 'FOREIGN KEY') as has_fk
-- FROM information_schema.columns c
-- WHERE table_name = 'content_nodes' AND column_name IN ('user_id', 'project_id')
-- ORDER BY ordinal_position;

-- ============================================
-- Step 2: 添加新列 sync_oauth_user_id
-- ============================================
ALTER TABLE content_nodes 
ADD COLUMN IF NOT EXISTS sync_oauth_user_id UUID;

-- ============================================
-- Step 3: 迁移数据 - 对于 sync 类型，复制 user_id 到 sync_oauth_user_id
-- ============================================
UPDATE content_nodes 
SET sync_oauth_user_id = user_id
WHERE type = 'sync' AND sync_oauth_user_id IS NULL;

-- ============================================
-- Step 4: 重命名 user_id 为 created_by
-- ============================================
-- 先删除旧的外键约束
ALTER TABLE content_nodes 
DROP CONSTRAINT IF EXISTS content_nodes_user_id_fkey;

-- 重命名列
ALTER TABLE content_nodes 
RENAME COLUMN user_id TO created_by;

-- ============================================
-- Step 5: 将 created_by 设为可空（它不再是核心字段）
-- ============================================
ALTER TABLE content_nodes 
ALTER COLUMN created_by DROP NOT NULL;

-- ============================================
-- Step 6: 添加 project_id 外键约束（如果不存在）
-- ============================================
-- 先检查是否存在 project 表
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project') THEN
    -- 添加外键约束
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'content_nodes_project_id_fkey' 
      AND table_name = 'content_nodes'
    ) THEN
      ALTER TABLE content_nodes 
      ADD CONSTRAINT content_nodes_project_id_fkey 
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- ============================================
-- Step 7: 添加约束 - sync 类型必须有 sync_oauth_user_id
-- ============================================
ALTER TABLE content_nodes 
DROP CONSTRAINT IF EXISTS chk_sync_oauth_user;

ALTER TABLE content_nodes 
ADD CONSTRAINT chk_sync_oauth_user
CHECK (type != 'sync' OR sync_oauth_user_id IS NOT NULL);

-- ============================================
-- Step 8: 添加 sync_oauth_user_id 的外键（引用 auth.users）
-- ============================================
-- 注意：这个外键确保 sync_oauth_user_id 是有效的用户
ALTER TABLE content_nodes 
DROP CONSTRAINT IF EXISTS content_nodes_sync_oauth_user_id_fkey;

ALTER TABLE content_nodes 
ADD CONSTRAINT content_nodes_sync_oauth_user_id_fkey 
FOREIGN KEY (sync_oauth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================
-- Step 9: 更新索引
-- ============================================
DROP INDEX IF EXISTS idx_content_nodes_user_id;
DROP INDEX IF EXISTS idx_content_nodes_created_by;
DROP INDEX IF EXISTS idx_content_nodes_sync_oauth_user_id;

-- created_by 索引（可选，因为不再用于查询）
CREATE INDEX IF NOT EXISTS idx_content_nodes_created_by 
ON content_nodes(created_by) 
WHERE created_by IS NOT NULL;

-- sync_oauth_user_id 索引（用于查询某用户的同步节点）
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_oauth_user_id 
ON content_nodes(sync_oauth_user_id) 
WHERE sync_oauth_user_id IS NOT NULL;

-- project_id 索引（核心查询字段）
DROP INDEX IF EXISTS idx_content_nodes_project_id;
CREATE INDEX IF NOT EXISTS idx_content_nodes_project_id 
ON content_nodes(project_id);

-- ============================================
-- Step 10: 添加注释
-- ============================================
COMMENT ON COLUMN content_nodes.project_id IS '所属项目 ID（核心字段，有外键约束）';
COMMENT ON COLUMN content_nodes.created_by IS '创建者用户 ID（仅记录，不用于权限控制）';
COMMENT ON COLUMN content_nodes.sync_oauth_user_id IS '同步绑定的 OAuth 用户 ID（仅 type=sync 时必填，后端自动设置，不接受前端输入）';

-- ============================================
-- 验证查询
-- ============================================
-- SELECT 
--   column_name, 
--   data_type, 
--   is_nullable,
--   column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'content_nodes' 
--   AND column_name IN ('project_id', 'created_by', 'sync_oauth_user_id')
-- ORDER BY ordinal_position;

-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'content_nodes'::regclass;

-- SELECT type, 
--        COUNT(*) as total,
--        COUNT(sync_oauth_user_id) as has_oauth_user
-- FROM content_nodes 
-- GROUP BY type;

