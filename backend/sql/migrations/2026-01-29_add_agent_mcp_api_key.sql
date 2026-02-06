-- Migration: Add mcp_api_key to agent table
-- Description: Allow Agent to be accessed via MCP protocol

-- Add mcp_api_key column to agent table
ALTER TABLE agent ADD COLUMN IF NOT EXISTS mcp_api_key TEXT UNIQUE;

-- Create index for fast lookup by mcp_api_key
CREATE INDEX IF NOT EXISTS idx_agent_mcp_api_key ON agent(mcp_api_key);

-- Comment
COMMENT ON COLUMN agent.mcp_api_key IS 'MCP API key for external access (Claude Desktop, Cursor, etc.)';




