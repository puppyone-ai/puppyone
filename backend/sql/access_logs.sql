-- Access Logs Table
-- Records each time a context node is accessed (sent to sandbox)
-- This is the "data egress" audit trail

CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- When
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Who
    user_id UUID,
    agent_id UUID,
    session_id UUID,  -- chat_session id
    
    -- What
    node_id UUID NOT NULL,
    node_type TEXT,
    node_name TEXT,
    
    -- Context
    project_id UUID
);

-- Index for time-series queries (most important)
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs (created_at DESC);

-- Index for filtering by agent
CREATE INDEX IF NOT EXISTS idx_access_logs_agent ON access_logs (agent_id, created_at DESC);

-- Index for filtering by node
CREATE INDEX IF NOT EXISTS idx_access_logs_node ON access_logs (node_id, created_at DESC);

-- Optional: Auto-cleanup old logs (keep 90 days)
-- You can set up a cron job or use pg_cron to run:
-- DELETE FROM access_logs WHERE created_at < NOW() - INTERVAL '90 days';

