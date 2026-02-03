-- ============================================================
-- Migration: Remove user_id from agents, use project_id instead
-- Date: 2026-02-03
-- Purpose: 统一架构，agents 和 content_nodes/tool 一样按 project 组织
-- ============================================================

-- 注意：此迁移假设 2026-02-03_add_agent_project_id.sql 已经执行

-- ============================================================
-- Step 1: 删除所有依赖 agents.user_id 的 RLS Policies
-- ============================================================

-- agents 表的 policies
DROP POLICY IF EXISTS "agent_select" ON agents;
DROP POLICY IF EXISTS "agent_insert" ON agents;
DROP POLICY IF EXISTS "agent_update" ON agents;
DROP POLICY IF EXISTS "agent_delete" ON agents;

-- agent_bash 表的 policy
DROP POLICY IF EXISTS "agent_bash_user_policy" ON agent_bash;

-- agent_tool 表的 policy
DROP POLICY IF EXISTS "agent_tool_user_policy" ON agent_tool;

-- agent_execution_log 表的 policy
DROP POLICY IF EXISTS "agent_execution_log_user_policy" ON agent_execution_log;

-- agent_api 表的 policy
DROP POLICY IF EXISTS "agent_api_user_policy" ON agent_api;

-- ============================================================
-- Step 2: 确保所有 agents 都有 project_id
-- ============================================================

DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count FROM agents WHERE project_id IS NULL;
    
    IF null_count > 0 THEN
        RAISE EXCEPTION 'Cannot proceed: % agents have NULL project_id. Fix data first!', null_count;
    END IF;
    
    RAISE NOTICE 'All agents have project_id, proceeding...';
END $$;

-- ============================================================
-- Step 3: 让 project_id 成为 NOT NULL
-- ============================================================

ALTER TABLE agents 
ALTER COLUMN project_id SET NOT NULL;

-- ============================================================
-- Step 4: 删除 user_id 相关索引
-- ============================================================

DROP INDEX IF EXISTS idx_agents_user_id;
DROP INDEX IF EXISTS idx_agents_user_project;

-- ============================================================
-- Step 5: 删除 user_id 列
-- ============================================================

ALTER TABLE agents 
DROP COLUMN user_id;

-- ============================================================
-- Step 6: 创建新的 RLS Policies（基于 project_id → project.user_id）
-- ============================================================

-- agents 表的新 policies
CREATE POLICY "agents_select_policy" ON agents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project 
            WHERE project.id = agents.project_id 
            AND project.user_id = auth.uid()
        )
    );

CREATE POLICY "agents_insert_policy" ON agents
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM project 
            WHERE project.id = agents.project_id 
            AND project.user_id = auth.uid()
        )
    );

CREATE POLICY "agents_update_policy" ON agents
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM project 
            WHERE project.id = agents.project_id 
            AND project.user_id = auth.uid()
        )
    );

CREATE POLICY "agents_delete_policy" ON agents
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM project 
            WHERE project.id = agents.project_id 
            AND project.user_id = auth.uid()
        )
    );

-- agent_bash 表的新 policy
CREATE POLICY "agent_bash_project_policy" ON agent_bash
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_bash.agent_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_bash.agent_id
            AND p.user_id = auth.uid()
        )
    );

-- agent_tool 表的新 policy
CREATE POLICY "agent_tool_project_policy" ON agent_tool
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_tool.agent_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_tool.agent_id
            AND p.user_id = auth.uid()
        )
    );

-- agent_execution_log 表的新 policy
CREATE POLICY "agent_execution_log_project_policy" ON agent_execution_log
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_execution_log.agent_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_execution_log.agent_id
            AND p.user_id = auth.uid()
        )
    );

-- agent_api 表的新 policy
CREATE POLICY "agent_api_project_policy" ON agent_api
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_api.agent_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE a.id = agent_api.agent_id
            AND p.user_id = auth.uid()
        )
    );

-- ============================================================
-- Step 7: 添加注释
-- ============================================================

COMMENT ON TABLE agents IS 
'Agent configurations. Organized by project_id (like content_nodes and tool).
User ownership is determined through project.user_id.';

COMMENT ON COLUMN agents.project_id IS 
'所属项目 ID (NOT NULL)，通过 project.user_id 确定所有权';

-- ============================================================
-- 验证
-- ============================================================

DO $$
DECLARE
    has_user_id BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'agents' AND column_name = 'user_id'
    ) INTO has_user_id;
    
    IF has_user_id THEN
        RAISE WARNING 'FAILED: user_id column still exists!';
    ELSE
        RAISE NOTICE 'SUCCESS: user_id removed from agents table';
    END IF;
END $$;

-- 显示最终结果
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'agents'
ORDER BY ordinal_position;
