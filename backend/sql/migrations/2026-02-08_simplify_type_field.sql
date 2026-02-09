-- Migration: Simplify ContentNode type field
-- Date: 2026-02-08
--
-- Changes:
--   1. Expand type field to include specific sync sources (github_repo, notion_page, etc.)
--   2. Remove source column (merged into type)
--   3. Remove preview_type column (deprecated, use type + preview_json/preview_md presence)
--   4. Remove CHECK constraints on type for flexibility (2000+ potential values)
--
-- New architecture:
--   - Native types: folder, json, markdown, file
--   - Sync types: github_repo, notion_page, gmail_thread, google_calendar_event, google_sheets, airtable_base, ...
--   - type field directly determines frontend rendering
--
-- ================================
-- THIS MIGRATION HAS BEEN EXECUTED
-- ================================

-- Step 1: Drop existing constraints first
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_preview_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_sync_has_source;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_sync_oauth_user;

-- Step 2: Merge type + source → new type values
UPDATE content_nodes SET type = CASE
  WHEN type = 'sync' AND source = 'github' THEN 'github_repo'
  WHEN type = 'sync' AND source = 'notion' THEN 'notion_page'
  WHEN type = 'sync' AND source = 'gmail' THEN 'gmail_thread'
  WHEN type = 'sync' AND source = 'google_calendar' THEN 'google_calendar_event'
  WHEN type = 'sync' AND source = 'google_sheets' THEN 'google_sheets'
  WHEN type = 'sync' AND source = 'airtable' THEN 'airtable_base'
  WHEN type = 'sync' AND source IS NOT NULL THEN source
  ELSE type
END;

-- Step 3: Drop deprecated columns
ALTER TABLE content_nodes DROP COLUMN IF EXISTS source;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS preview_type;
-- Note: renderer_id was never added to production, only planned

-- Step 4: Add new constraint (sync_oauth_user_id required for non-native types)
ALTER TABLE content_nodes ADD CONSTRAINT chk_sync_oauth_user 
CHECK (
  type IN ('folder', 'json', 'markdown', 'file') 
  OR sync_oauth_user_id IS NOT NULL
);

-- Step 5: Update column comment
COMMENT ON COLUMN content_nodes.type IS 
'Node type. Native: folder, json, markdown, file. Sync: github_repo, notion_page, gmail_thread, google_calendar_event, google_sheets, airtable_base, and more. This field directly determines frontend rendering.';
