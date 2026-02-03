-- Migration: Add 'schedule' to agent_type_check constraint
-- Description: Update the agent type check constraint to allow 'schedule' type

-- Drop the existing check constraint
ALTER TABLE agent DROP CONSTRAINT IF EXISTS agent_type_check;

-- Add the updated check constraint with 'schedule' type
ALTER TABLE agent ADD CONSTRAINT agent_type_check 
  CHECK (type IN ('chat', 'devbox', 'webhook', 'schedule'));

-- Add comment for documentation
COMMENT ON CONSTRAINT agent_type_check ON agent IS 'Allowed agent types: chat, devbox, webhook, schedule';



