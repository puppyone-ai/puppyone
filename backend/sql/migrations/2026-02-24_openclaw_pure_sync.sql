-- ============================================================
-- Migration: OpenClaw — from Agent to pure Sync entity
-- Date: 2026-02-24
--
-- Purpose:
--   OpenClaw CLI connections were stored as dual entities:
--     agents (type='devbox') + syncs (provider='openclaw')
--   This migration promotes syncs to the single source of truth
--   by copying the access key and cleaning up agent records.
--
-- Steps:
--   1. Copy agents.mcp_api_key → syncs.access_key for all
--      openclaw syncs that reference an agent_id in config.
--   2. Remove agent_id / agent_name from syncs.config (cleanup).
--   3. Delete agent_bash records for devbox agents.
--   4. Delete devbox agents from agents table.
-- ============================================================

-- 1. Copy access key from agents to syncs
UPDATE syncs s
SET access_key = a.mcp_api_key
FROM agents a
WHERE s.provider = 'openclaw'
  AND s.config->>'agent_id' = a.id
  AND s.access_key IS NULL
  AND a.mcp_api_key IS NOT NULL;

-- 2. Strip agent_id and agent_name from syncs.config
--    (keep other config like 'path')
UPDATE syncs
SET config = config - 'agent_id' - 'agent_name'
WHERE provider = 'openclaw'
  AND config ? 'agent_id';

-- 3. Delete agent_bash records for devbox agents
DELETE FROM agent_bash
WHERE agent_id IN (
    SELECT id FROM agents WHERE type = 'devbox'
);

-- 4. Delete devbox agents
DELETE FROM agents
WHERE type = 'devbox';
