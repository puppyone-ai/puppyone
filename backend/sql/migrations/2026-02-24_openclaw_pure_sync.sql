-- ============================================================
-- Migration: OpenClaw — from Agent to pure Sync entity
-- Date: 2026-02-24 (revised)
--
-- Actual table structures (verified):
--   agents:     id, project_id, name, mcp_api_key, type, ...
--   agent_bash: id, agent_id, node_id, json_path, readonly, permission
--   syncs:      id, project_id, node_id, direction, provider, ...
--
-- Steps:
--   1. INSERT syncs from agents(type='devbox') + agent_bash
--   2. Delete agent_bash for devbox agents
--   3. Delete devbox agents
-- ============================================================

-- 1. Create sync records from devbox agents
INSERT INTO syncs (
    project_id,
    node_id,
    direction,
    provider,
    authority,
    config,
    access_key,
    trigger,
    conflict_strategy,
    status,
    created_at,
    updated_at
)
SELECT
    a.project_id,
    ba.node_id,
    'bidirectional',
    'openclaw',
    'mirror',
    jsonb_build_object('migrated_from_agent', a.id),
    a.mcp_api_key,
    '{"type": "realtime"}'::JSONB,
    'three_way_merge',
    'active',
    a.created_at,
    NOW()
FROM agents a
JOIN agent_bash ba ON ba.agent_id = a.id
WHERE a.type = 'devbox'
  AND NOT EXISTS (
      SELECT 1 FROM syncs s
      WHERE s.provider = 'openclaw'
        AND s.node_id = ba.node_id
  );

-- 2. Delete agent_bash records for devbox agents
DELETE FROM agent_bash
WHERE agent_id IN (
    SELECT id FROM agents WHERE type = 'devbox'
);

-- 3. Delete devbox agents
DELETE FROM agents
WHERE type = 'devbox';
