-- Migration: Add schedule agent fields to agent table
-- Description: Support for scheduled agents with trigger configuration and task content

-- 1. Add trigger_type column
-- Values: 'manual' (default), 'cron', 'webhook'
ALTER TABLE agent ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'manual';

-- 2. Add trigger_config column (JSONB)
-- For cron: { "schedule": "0 9 * * 1-5", "timezone": "Asia/Shanghai" }
-- For webhook: { "webhook_url": "https://...", "secret": "..." }
ALTER TABLE agent ADD COLUMN IF NOT EXISTS trigger_config JSONB;

-- 3. Add task_content column
-- Stores the todo/task instructions written directly by user
ALTER TABLE agent ADD COLUMN IF NOT EXISTS task_content TEXT;

-- 4. Add task_node_id column
-- References a content_node (e.g., todo.md file) for task instructions
-- Note: content_nodes.id is TEXT type, not UUID
ALTER TABLE agent ADD COLUMN IF NOT EXISTS task_node_id TEXT REFERENCES content_nodes(id) ON DELETE SET NULL;

-- 5. Add external_config column (JSONB)
-- Stores N8N/Zapier configuration (similar to MCP config)
-- Example: { "n8n_url": "...", "workflow_id": "...", "auth": {...} }
ALTER TABLE agent ADD COLUMN IF NOT EXISTS external_config JSONB;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_agent_trigger_type ON agent(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_task_node_id ON agent(task_node_id);

-- Add comments for documentation
COMMENT ON COLUMN agent.trigger_type IS 'Trigger type: manual, cron, or webhook';
COMMENT ON COLUMN agent.trigger_config IS 'Trigger configuration (cron schedule, webhook settings, etc.)';
COMMENT ON COLUMN agent.task_content IS 'User-written task/todo instructions';
COMMENT ON COLUMN agent.task_node_id IS 'Reference to a content_node containing task instructions';
COMMENT ON COLUMN agent.external_config IS 'External service configuration (N8N, Zapier, etc.)';

