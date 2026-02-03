-- ============================================================
-- Migration: Add project_id to agents table
-- Date: 2026-02-03
-- Purpose: 让 Agent 关联 Project，支持按项目过滤
-- ============================================================

-- 1. 添加 project_id 字段
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS project_id TEXT;

-- 2. 从 agent_bash 关联的 content_nodes 回填现有 agent 的 project_id
-- 逻辑：找到每个 agent 的 bash_accesses 中第一个 node 所属的 project_id
UPDATE agents a
SET project_id = (
    SELECT cn.project_id 
    FROM agent_bash ab
    JOIN content_nodes cn ON ab.node_id = cn.id
    WHERE ab.agent_id = a.id
    LIMIT 1
)
WHERE a.project_id IS NULL;

-- 3. 创建索引（按 project_id 查询）
CREATE INDEX IF NOT EXISTS idx_agents_project_id 
ON agents(project_id);

-- 4. 创建复合索引（按用户+项目查询）
CREATE INDEX IF NOT EXISTS idx_agents_user_project 
ON agents(user_id, project_id);

-- 5. 添加外键约束（可选，允许 NULL）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'agents_project_id_fkey'
    ) THEN
        ALTER TABLE agents 
        ADD CONSTRAINT agents_project_id_fkey 
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
COMMENT ON COLUMN agents.project_id IS 
'所属项目 ID，用于按项目过滤 Agent';

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
        WHERE table_name = 'agents' AND column_name = 'project_id'
    ) INTO col_exists;
    
    IF col_exists THEN
        RAISE NOTICE 'SUCCESS: project_id column added to agents table';
        
        -- 统计填充情况
        SELECT COUNT(*) INTO total_count FROM agents;
        SELECT COUNT(*) INTO filled_count FROM agents WHERE project_id IS NOT NULL;
        
        RAISE NOTICE 'Data migration: %/% agents have project_id filled', filled_count, total_count;
    ELSE
        RAISE WARNING 'FAILED: project_id column was not created';
    END IF;
END $$;

