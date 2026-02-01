-- Agent Execution Logs (Unified)
-- Records all Agent activities: bash, tool calls, LLM calls
-- Grouped by chat_session for complete audit trail

CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Context: Who and Where
    user_id UUID,
    agent_id UUID,
    session_id UUID,          -- chat_session id (关键！用于分组)
    
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

-- Index for querying by session (most common: "show me everything in this session")
CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs (session_id, created_at ASC);

-- Index for filtering by call type
CREATE INDEX IF NOT EXISTS idx_agent_logs_type ON agent_logs (call_type, created_at DESC);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs (created_at DESC);

-- Index for agent-specific queries
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs (agent_id, created_at DESC);

-- Drop old bash_logs table if exists (migration)
-- DROP TABLE IF EXISTS bash_logs;

