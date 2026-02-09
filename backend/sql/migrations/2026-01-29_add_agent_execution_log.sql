-- Migration: Create agent_execution_log table
-- Description: Track execution history for scheduled and webhook agents

-- Create agent_execution_log table
-- Note: agent.id is TEXT type (UUID string), not native UUID
CREATE TABLE IF NOT EXISTS agent_execution_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  
  -- Trigger info
  trigger_type TEXT NOT NULL,           -- 'cron' | 'webhook' | 'manual'
  trigger_source TEXT,                  -- Additional info (e.g., webhook caller IP, cron job ID)
  
  -- Execution status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  
  -- Timing
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Results
  input_snapshot JSONB,                 -- Snapshot of task content/config at execution time
  output_summary TEXT,                  -- Brief summary of execution result
  error_message TEXT,                   -- Error details if failed
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_execution_log_agent_id 
  ON agent_execution_log(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_execution_log_agent_created 
  ON agent_execution_log(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_execution_log_status 
  ON agent_execution_log(status);

CREATE INDEX IF NOT EXISTS idx_agent_execution_log_trigger_type 
  ON agent_execution_log(trigger_type);

-- RLS (Row Level Security)
ALTER TABLE agent_execution_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access execution logs of their own agents
DROP POLICY IF EXISTS agent_execution_log_user_policy ON agent_execution_log;
CREATE POLICY agent_execution_log_user_policy ON agent_execution_log
  FOR ALL
  USING (agent_id IN (SELECT id FROM agent WHERE user_id = auth.uid()))
  WITH CHECK (agent_id IN (SELECT id FROM agent WHERE user_id = auth.uid()));

-- Comments
COMMENT ON TABLE agent_execution_log IS 'Execution history for scheduled and webhook agents';
COMMENT ON COLUMN agent_execution_log.trigger_type IS 'How the execution was triggered: cron, webhook, or manual';
COMMENT ON COLUMN agent_execution_log.trigger_source IS 'Additional trigger info (webhook IP, job ID, etc.)';
COMMENT ON COLUMN agent_execution_log.status IS 'Execution status: pending, running, success, failed, skipped';
COMMENT ON COLUMN agent_execution_log.input_snapshot IS 'Snapshot of input data at execution time';
COMMENT ON COLUMN agent_execution_log.output_summary IS 'Brief summary of execution result';
COMMENT ON COLUMN agent_execution_log.error_message IS 'Error details if execution failed';

