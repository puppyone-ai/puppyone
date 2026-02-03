-- Migration: Add agent_id to chat_sessions
-- Run this on existing database to add agent_id support

-- Add agent_id column (nullable for backward compatibility)
ALTER TABLE chat_sessions 
ADD COLUMN IF NOT EXISTS agent_id UUID;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent ON chat_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_agent ON chat_sessions(user_id, agent_id);

-- Note: Existing sessions will have agent_id = NULL (playground mode)
-- New sessions created for specific agents will have agent_id set



