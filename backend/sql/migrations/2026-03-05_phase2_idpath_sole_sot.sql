-- ============================================================
-- Phase 1 + Phase 2a: id_path as Sole Source of Truth
-- ============================================================
--
-- Prerequisite: content_nodes table exists with columns:
--   id, project_id, created_by, parent_id, name, type,
--   id_path, preview_json, preview_md, s3_key, mime_type,
--   size_bytes, permissions, created_at, updated_at,
--   current_version, content_hash
--
-- This migration adds:
--   1. depth generated column (computed from id_path)
--   2. Composite index for children-by-idpath queries
--   3. move_node_atomic() RPC for atomic node moves
--   4. auto_set_parent_id() trigger (auto-maintains parent_id from id_path)
--   5. check_no_cycle() trigger (id_path-based cycle prevention)
--   6. count_children_batch() RPC for batch child counting
--
-- See: docs/content-node-tree-architecture.md
-- ============================================================

-- ============================================================
-- 1. Add depth generated column
-- ============================================================

ALTER TABLE content_nodes
ADD COLUMN IF NOT EXISTS depth INT GENERATED ALWAYS AS (
    array_length(string_to_array(trim(both '/' from id_path), '/'), 1)
) STORED;

-- ============================================================
-- 2. Indexes
-- ============================================================

-- Index for depth-based queries (project_id, depth)
CREATE INDEX IF NOT EXISTS idx_content_nodes_project_depth
    ON content_nodes(project_id, depth);

-- Composite index for children lookup:
--   WHERE project_id = X AND depth = N AND id_path LIKE 'prefix/%'
CREATE INDEX IF NOT EXISTS idx_content_nodes_children_lookup
    ON content_nodes(project_id, depth, id_path text_pattern_ops);

-- ============================================================
-- 3. move_node_atomic() RPC
--    Atomically moves a node and all its descendants in one tx.
--    parent_id is auto-maintained by the auto_set_parent_id trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION move_node_atomic(
    p_node_id TEXT,
    p_project_id TEXT,
    p_new_parent_id TEXT,   -- kept for signature compat, ignored by trigger
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

    -- Update the moved node (trigger auto-sets parent_id from new id_path)
    UPDATE content_nodes
    SET id_path = p_new_id_path
    WHERE id = p_node_id;

    -- Update all descendants (trigger auto-sets each node's parent_id)
    UPDATE content_nodes
    SET id_path = p_new_id_path || substring(id_path from length(v_old_id_path) + 1)
    WHERE project_id = p_project_id
      AND id_path LIKE v_old_id_path || '/%';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. auto_set_parent_id() trigger
--    Derives parent_id from id_path on every INSERT/UPDATE.
--    parent_id = second-to-last segment of id_path, or NULL for root.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_set_parent_id() RETURNS TRIGGER AS $$
DECLARE
    parts TEXT[];
BEGIN
    parts := string_to_array(trim(both '/' from NEW.id_path), '/');
    IF array_length(parts, 1) >= 2 THEN
        NEW.parent_id := parts[array_length(parts, 1) - 1];
    ELSE
        NEW.parent_id := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_set_parent_id ON content_nodes;
CREATE TRIGGER trg_auto_set_parent_id
    BEFORE INSERT OR UPDATE OF id_path ON content_nodes
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_parent_id();

-- ============================================================
-- 5. check_no_cycle() trigger
--    Validates id_path doesn't contain the node's own ID
--    in its ancestor segments (structural cycle prevention).
-- ============================================================

CREATE OR REPLACE FUNCTION check_no_cycle() RETURNS TRIGGER AS $$
DECLARE
    parts TEXT[];
    node_id TEXT;
    i INT;
BEGIN
    IF NEW.id_path IS NULL OR NEW.id_path = '' THEN
        RETURN NEW;
    END IF;

    parts := string_to_array(trim(both '/' from NEW.id_path), '/');

    IF array_length(parts, 1) IS NULL THEN
        RETURN NEW;
    END IF;

    -- Last segment is the node itself
    node_id := parts[array_length(parts, 1)];

    -- Check: node's ID must not appear in ancestor segments
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
        IF parts[i] = node_id THEN
            RAISE EXCEPTION 'Circular reference: node % cannot be its own ancestor', node_id;
        END IF;
    END LOOP;

    -- Depth sanity check
    IF array_length(parts, 1) > 100 THEN
        RAISE EXCEPTION 'Tree depth exceeded maximum (100) for node %', node_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_no_cycle ON content_nodes;
CREATE TRIGGER trg_check_no_cycle
    BEFORE INSERT OR UPDATE OF id_path ON content_nodes
    FOR EACH ROW
    EXECUTE FUNCTION check_no_cycle();

-- ============================================================
-- 6. count_children_batch() RPC
--    Batch-counts direct children using id_path + depth JOIN.
-- ============================================================

CREATE OR REPLACE FUNCTION count_children_batch(p_parent_ids TEXT[])
RETURNS TABLE(parent_id TEXT, child_count BIGINT) AS $$
    SELECT p.id AS parent_id, COUNT(c.id) AS child_count
    FROM content_nodes p
    LEFT JOIN content_nodes c
        ON c.project_id = p.project_id
        AND c.id_path LIKE p.id_path || '/%'
        AND c.depth = p.depth + 1
    WHERE p.id = ANY(p_parent_ids)
    GROUP BY p.id;
$$ LANGUAGE sql STABLE;
