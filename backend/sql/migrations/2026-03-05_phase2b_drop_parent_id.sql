-- ============================================================
-- Phase 2b: Drop parent_id column entirely
-- ============================================================
--
-- Prerequisite: Phase 2a migration has been applied
--   (depth generated column, auto_set_parent_id trigger, etc.)
--
-- This migration:
--   1. Creates parent_path() helper for the new UNIQUE constraint
--   2. Replaces the old UNIQUE constraint (parent_id-based)
--      with a new one based on id_path
--   3. Drops auto_set_parent_id trigger and function (no longer needed)
--   4. Drops parent_id column (also removes FK and index)
--   5. Updates move_node_atomic() to remove parent_id parameter
--
-- See: docs/content-node-tree-architecture.md
-- ============================================================

-- ============================================================
-- 1. parent_path(): extract the parent's id_path from a node's id_path
--    Root nodes (id_path = '/uuid') → '__root__'
--    Non-root  (id_path = '/a/b')  → '/a'
-- ============================================================

CREATE OR REPLACE FUNCTION parent_path(p_id_path TEXT) RETURNS TEXT
IMMUTABLE LANGUAGE SQL AS $$
    SELECT CASE
        WHEN p_id_path ~ '^/[^/]+$' THEN '__root__'
        ELSE regexp_replace(p_id_path, '/[^/]+$', '')
    END;
$$;

-- ============================================================
-- 2. Replace UNIQUE constraint
--    Old: (project_id, COALESCE(parent_id, '__root__'), name)
--    New: (project_id, parent_path(id_path), name)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_nodes_unique_name_v2
    ON content_nodes (project_id, parent_path(id_path), name);

DROP INDEX IF EXISTS idx_content_nodes_unique_name;

-- ============================================================
-- 3. Drop auto_set_parent_id trigger & function
-- ============================================================

DROP TRIGGER IF EXISTS trg_auto_set_parent_id ON content_nodes;
DROP FUNCTION IF EXISTS auto_set_parent_id();

-- ============================================================
-- 4. Drop parent_id column
--    This also removes:
--    - FK constraint (parent_id REFERENCES content_nodes(id))
--    - idx_content_nodes_parent_id index
-- ============================================================

DROP INDEX IF EXISTS idx_content_nodes_parent_id;

ALTER TABLE content_nodes DROP COLUMN IF EXISTS parent_id;

-- ============================================================
-- 5. Update move_node_atomic() — remove p_new_parent_id param
-- ============================================================

CREATE OR REPLACE FUNCTION move_node_atomic(
    p_node_id TEXT,
    p_project_id TEXT,
    p_new_id_path TEXT
) RETURNS VOID AS $$
DECLARE
    v_old_id_path TEXT;
BEGIN
    SELECT id_path INTO v_old_id_path
    FROM content_nodes
    WHERE id = p_node_id
    FOR UPDATE;

    IF v_old_id_path IS NULL THEN
        RAISE EXCEPTION 'Node not found: %', p_node_id;
    END IF;

    UPDATE content_nodes
    SET id_path = p_new_id_path
    WHERE id = p_node_id;

    UPDATE content_nodes
    SET id_path = p_new_id_path || substring(id_path from length(v_old_id_path) + 1)
    WHERE project_id = p_project_id
      AND id_path LIKE v_old_id_path || '/%';
END;
$$ LANGUAGE plpgsql;
