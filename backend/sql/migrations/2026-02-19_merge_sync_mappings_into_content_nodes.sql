-- ============================================================
-- Migration: Merge sync_mappings into content_nodes
--
-- Goal: Eliminate sync_mappings table. Move sync state tracking
--       directly onto content_nodes for simpler file CRUD.
--
-- Changes:
--   1. ADD sync_source_id, external_resource_id, remote_hash,
--      last_sync_version to content_nodes
--   2. MIGRATE data from sync_mappings → content_nodes
--   3. DROP sync_mappings table
--   4. ADD indexes
--
-- After this migration:
--   content_nodes = content + sync state (one table, one row per file)
--   sync_sources  = connection-level config (kept, low-frequency changes)
--   sync_mappings = GONE
--
-- ============================================================

-- ============================================================
-- STEP 1: Add new sync columns to content_nodes
-- ============================================================

-- Which sync_source this node belongs to (NULL = not synced via adapter)
ALTER TABLE content_nodes
    ADD COLUMN IF NOT EXISTS sync_source_id BIGINT;

-- External resource identifier within the source
-- filesystem: "config.json" (relative path)
-- notion: "page_abc123" (page ID)
-- github: "src/main.py" (path in repo)
ALTER TABLE content_nodes
    ADD COLUMN IF NOT EXISTS external_resource_id TEXT;

-- SHA-256 of the external content at last sync (for change detection)
ALTER TABLE content_nodes
    ADD COLUMN IF NOT EXISTS remote_hash TEXT;

-- PuppyOne version number at last sync (for push change detection)
ALTER TABLE content_nodes
    ADD COLUMN IF NOT EXISTS last_sync_version INT NOT NULL DEFAULT 0;

-- ============================================================
-- STEP 2: FK constraint (SET NULL on source deletion)
-- ============================================================

ALTER TABLE content_nodes
    ADD CONSTRAINT fk_content_nodes_sync_source
    FOREIGN KEY (sync_source_id) REFERENCES sync_sources(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 3: Migrate existing sync_mappings data into content_nodes
-- ============================================================

UPDATE content_nodes cn
SET
    sync_source_id       = sm.source_id,
    external_resource_id = sm.external_resource_id,
    remote_hash          = sm.remote_hash,
    last_sync_version    = sm.last_sync_version
FROM sync_mappings sm
WHERE cn.id = sm.node_id::text;

-- ============================================================
-- STEP 4: Indexes
-- ============================================================

-- Find all nodes belonging to a sync source (for pull_source)
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_source_id
    ON content_nodes(sync_source_id)
    WHERE sync_source_id IS NOT NULL;

-- Find a specific external resource within a source (uniqueness check)
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_resource
    ON content_nodes(sync_source_id, external_resource_id)
    WHERE sync_source_id IS NOT NULL;

-- ============================================================
-- STEP 5: Drop sync_mappings table
-- ============================================================

DROP TABLE IF EXISTS sync_mappings;

-- ============================================================
-- STEP 6: Document deprecated columns
-- (Keep for backward compat with import handlers, drop later)
-- ============================================================

COMMENT ON COLUMN content_nodes.sync_source_id IS 'FK to sync_sources. Which external data source this node syncs with. NULL = not actively synced.';
COMMENT ON COLUMN content_nodes.external_resource_id IS 'Resource identifier within the sync source (relative path, page ID, etc.)';
COMMENT ON COLUMN content_nodes.remote_hash IS 'SHA-256 of external content at last sync. Used for pull change detection.';
COMMENT ON COLUMN content_nodes.last_sync_version IS 'PuppyOne current_version at last sync. Used for push change detection.';
COMMENT ON COLUMN content_nodes.sync_url IS 'DEPRECATED: Import source URL. Kept for backward compat with import handlers.';
COMMENT ON COLUMN content_nodes.sync_id IS 'DEPRECATED: Overlaps with external_resource_id. Kept for backward compat.';

-- ============================================================
-- Final schema for sync-related fields on content_nodes:
--
-- | Field                 | Purpose                              | Writer          |
-- |-----------------------|--------------------------------------|-----------------|
-- | sync_source_id        | FK to sync_sources connection        | Adapter system  |
-- | external_resource_id  | External path/ID within source       | Adapter system  |
-- | remote_hash           | External content SHA-256              | Adapter system  |
-- | last_sync_version     | PuppyOne version at last sync        | Adapter system  |
-- | sync_status           | idle | syncing | synced | error      | Both systems    |
-- | sync_config           | Node-level sync overrides (JSONB)    | User config     |
-- | last_synced_at        | Timestamp of last sync               | Both systems    |
-- | sync_url              | (deprecated) Import source URL       | Import handlers |
-- | sync_id               | (deprecated) External platform ID    | Import handlers |
-- | sync_oauth_user_id    | OAuth user context                   | Import handlers |
-- ============================================================
