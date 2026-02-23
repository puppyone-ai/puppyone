-- ============================================================
-- Migration: Create sync_changelog table
-- Date: 2026-02-22
--
-- Purpose: Global change log for cursor-based incremental sync.
--          Enables CLI/adapters to pull only changes since their
--          last known cursor (sequence number), eliminating the
--          need for full-table polling.
--
-- Design refs: Dropbox Delta API cursor model
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_changelog (
    id          BIGSERIAL   PRIMARY KEY,
    project_id  TEXT        NOT NULL,
    node_id     TEXT        NOT NULL,
    action      TEXT        NOT NULL DEFAULT 'update',
    node_type   TEXT,
    version     INT         NOT NULL DEFAULT 0,
    hash        TEXT,
    size_bytes  BIGINT      DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sync_changelog
    ADD CONSTRAINT chk_sync_changelog_action
    CHECK (action IN ('create', 'update', 'delete'));

CREATE INDEX idx_sync_changelog_project_seq
    ON sync_changelog (project_id, id);

CREATE INDEX idx_sync_changelog_cleanup
    ON sync_changelog (created_at);

ALTER TABLE sync_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_sync_changelog
    ON sync_changelog FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMENT ON TABLE sync_changelog IS
    'Append-only change log for cursor-based incremental sync. '
    'Each row represents a content_node mutation. Clients store '
    'the last-seen id as their cursor and pull only newer entries. '
    'Rows older than 30 days are periodically cleaned up; expired '
    'cursors trigger a full-sync reset.';
