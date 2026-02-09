-- ============================================================
-- Migration: Add project_id to tool table
-- Date: 2026-02-03
-- Purpose: 让 Tool 直接关联 Project，支持按项目过滤
-- ============================================================

-- 1. 添加 project_id 字段
ALTER TABLE tool 
ADD COLUMN IF NOT EXISTS project_id TEXT;

-- 2. 从 content_nodes 表回填现有 tool 的 project_id
-- 通过 tool.node_id -> content_nodes.project_id 关联
UPDATE tool t
SET project_id = cn.project_id
FROM content_nodes cn
WHERE t.node_id = cn.id
  AND t.project_id IS NULL
  AND t.node_id IS NOT NULL;

-- 3. 创建索引（按 project_id 查询）
CREATE INDEX IF NOT EXISTS idx_tool_project_id 
ON tool(project_id);

-- 4. 创建复合索引（按用户+项目查询）
CREATE INDEX IF NOT EXISTS idx_tool_user_project 
ON tool(user_id, project_id);

-- 5. 添加外键约束（可选，如果 project 表存在）
-- 注意：允许 NULL（custom 工具可能没有绑定项目）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tool_project_id_fkey'
    ) THEN
        ALTER TABLE tool 
        ADD CONSTRAINT tool_project_id_fkey 
        FOREIGN KEY (project_id) 
        REFERENCES project(id) 
        ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN undefined_table THEN
        -- project 表不存在，跳过外键
        NULL;
END $$;

-- 6. 添加字段注释
COMMENT ON COLUMN tool.project_id IS 
'所属项目 ID，通过 node_id 关联的 content_nodes 获取，用于按项目过滤工具';

-- ============================================================
-- 验证迁移结果
-- ============================================================
DO $$
DECLARE
    col_exists BOOLEAN;
    filled_count INTEGER;
    total_count INTEGER;
BEGIN
    -- 检查字段是否存在
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tool' AND column_name = 'project_id'
    ) INTO col_exists;
    
    IF col_exists THEN
        RAISE NOTICE 'SUCCESS: project_id column added to tool table';
        
        -- 统计填充情况
        SELECT COUNT(*) INTO total_count FROM tool;
        SELECT COUNT(*) INTO filled_count FROM tool WHERE project_id IS NOT NULL;
        
        RAISE NOTICE 'Data migration: %/% tools have project_id filled', filled_count, total_count;
    ELSE
        RAISE WARNING 'FAILED: project_id column was not created';
    END IF;
END $$;

