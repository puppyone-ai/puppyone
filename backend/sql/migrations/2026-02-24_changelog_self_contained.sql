-- ============================================================
-- Migration: Make sync_changelog self-contained (Dropbox SFJ model)
-- Date: 2026-02-24
--
-- Purpose:
--   1. Add folder_id + filename to sync_changelog so it is a
--      self-contained event log (no need to reverse-lookup node
--      names for delete events).
--   2. Clean up per-file sync records from the syncs table.
--      Folder-level providers (openclaw, filesystem) should only
--      have ONE sync record per folder, not one per file.
--
-- Design ref: Dropbox Server File Journal — each entry carries
--   the full path; clients use a cursor; server keeps no per-file
--   state per client.
-- ============================================================

-- 1. Enhance sync_changelog with folder_id + filename
ALTER TABLE sync_changelog ADD COLUMN IF NOT EXISTS folder_id TEXT;
ALTER TABLE sync_changelog ADD COLUMN IF NOT EXISTS filename  TEXT;

-- Index for folder-scoped cursor queries
CREATE INDEX IF NOT EXISTS idx_sync_changelog_folder_seq
    ON sync_changelog (folder_id, id)
    WHERE folder_id IS NOT NULL;

-- 2. Delete per-file sync records for folder-level providers.
--    Keep only records where node_id points to a folder.
--    Also clean orphaned records where the node no longer exists.

DELETE FROM syncs
WHERE provider IN ('filesystem', 'openclaw')
  AND id NOT IN (
      SELECT s.id
      FROM syncs s
      JOIN content_nodes cn ON cn.id::text = s.node_id
      WHERE s.provider IN ('filesystem', 'openclaw')
        AND cn.type = 'folder'
  );
