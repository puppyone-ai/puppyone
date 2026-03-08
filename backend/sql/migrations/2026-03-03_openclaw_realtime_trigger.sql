-- ============================================================
-- Normalize desktop-folder provider and trigger type
-- Date: 2026-03-03
--
-- 1. Rename provider 'openclaw' → 'filesystem'
-- 2. Set trigger.type = 'realtime' for all filesystem-family providers
-- ============================================================

-- 1. Unify provider name
UPDATE connections
SET provider = 'filesystem'
WHERE provider = 'openclaw';

-- 2. Ensure all filesystem-family syncs have realtime trigger
UPDATE connections
SET trigger = jsonb_set(
  COALESCE(trigger, '{}'::jsonb),
  '{type}',
  '"realtime"'::jsonb,
  true
)
WHERE provider IN ('filesystem', 'folder_access', 'folder_source')
  AND COALESCE(trigger ->> 'type', '') <> 'realtime';
