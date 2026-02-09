-- ============================================
-- PuppyOne Logging Tables
-- Run this script in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. AGENT_LOGS: Unified Agent Execution Log
-- Records: bash commands, tool calls, LLM calls
-- ============================================

CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Context: Who and Where
    user_id UUID,
    agent_id UUID,
    session_id UUID,          -- chat_session id (关键！按 session 分组)
    
    -- Call Type: 'bash', 'tool', 'llm'
    call_type TEXT NOT NULL,
    
    -- Common fields
    success BOOLEAN DEFAULT true,
    latency_ms INT,
    error_message TEXT,
    
    -- Type-specific details (JSONB for flexibility)
    -- bash: {"command": "cat data.json", "output_preview": "..."}
    -- tool: {"tool_name": "web_search", "input": {...}, "output_preview": "..."}
    -- llm:  {"model": "claude-3-5-sonnet", "input_tokens": 500, "output_tokens": 200}
    details JSONB DEFAULT '{}'
);

-- Indexes for agent_logs
CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs (session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_type ON agent_logs (call_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs (agent_id, created_at DESC);

-- ============================================
-- 2. ACCESS_LOGS: Data Egress Log
-- Records: when context/data is sent to sandbox
-- ============================================

CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Context: Who
    user_id UUID,
    agent_id UUID,
    session_id UUID,          -- chat_session id
    
    -- What: Which data was accessed
    node_id UUID NOT NULL,    -- content_node id
    node_type TEXT,           -- 'json', 'markdown', 'folder', 'github_repo', etc.
    node_name TEXT,
    
    -- Where
    project_id UUID
);

-- Indexes for access_logs
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_session ON access_logs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_agent ON access_logs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_node ON access_logs (node_id, created_at DESC);

-- ============================================
-- Example Queries
-- ============================================

-- 查看某个 session 的所有操作（完整审计）
-- SELECT * FROM agent_logs WHERE session_id = 'xxx' ORDER BY created_at;

-- 统计过去 24 小时各类调用次数
-- SELECT call_type, COUNT(*) FROM agent_logs 
-- WHERE created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY call_type;

-- 查看某个 session 访问了哪些数据
-- SELECT * FROM access_logs WHERE session_id = 'xxx' ORDER BY created_at;

-- 统计最常被访问的数据
-- SELECT node_id, node_name, COUNT(*) as access_count 
-- FROM access_logs 
-- GROUP BY node_id, node_name 
-- ORDER BY access_count DESC 
-- LIMIT 10;




