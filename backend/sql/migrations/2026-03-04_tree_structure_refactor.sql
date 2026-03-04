-- ============================================================
-- Tree Structure Refactor: id_path as Single Source of Truth
-- ============================================================
-- 
-- Goals:
--   1. Add depth generated column for efficient direct-children queries
--   2. Create move_node_atomic() RPC for atomic move operations
--   3. Add cycle prevention trigger on parent_id updates
--
-- See: docs/content-node-tree-architecture.md
-- ============================================================

-- 1. Add depth generated column (derived from id_path)
ALTER TABLE content_nodes
ADD COLUMN IF NOT EXISTS depth INT GENERATED ALWAYS AS (
    array_length(string_to_array(trim(both '/' from id_path), '/'), 1)
) STORED;

-- 2. Add composite index for children queries via id_path + depth
CREATE INDEX IF NOT EXISTS idx_content_nodes_project_depth
    ON content_nodes(project_id, depth);

-- 3. Atomic move RPC — single transaction for node + descendants
CREATE OR REPLACE FUNCTION move_node_atomic(
    p_node_id TEXT,
    p_project_id TEXT,
    p_new_parent_id TEXT,
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
    SET parent_id = p_new_parent_id,
        id_path   = p_new_id_path
    WHERE id = p_node_id;

    UPDATE content_nodes
    SET id_path = p_new_id_path || substring(id_path from length(v_old_id_path) + 1)
    WHERE project_id = p_project_id
      AND id_path LIKE v_old_id_path || '/%';
END;
$$ LANGUAGE plpgsql;

-- 4. Cycle prevention trigger
CREATE OR REPLACE FUNCTION check_no_cycle() RETURNS TRIGGER AS $$
DECLARE
    v_check_id TEXT;
    v_depth INT := 0;
    v_max_depth INT := 100;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_check_id := NEW.parent_id;
    WHILE v_check_id IS NOT NULL AND v_depth < v_max_depth LOOP
        IF v_check_id = NEW.id THEN
            RAISE EXCEPTION 'Circular reference: node % cannot be its own ancestor', NEW.id;
        END IF;
        SELECT parent_id INTO v_check_id FROM content_nodes WHERE id = v_check_id;
        v_depth := v_depth + 1;
    END LOOP;

    IF v_depth >= v_max_depth THEN
        RAISE EXCEPTION 'Tree depth exceeded maximum (possible cycle for node %)', NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_no_cycle ON content_nodes;
CREATE TRIGGER trg_check_no_cycle
    BEFORE INSERT OR UPDATE OF parent_id ON content_nodes
    FOR EACH ROW
    EXECUTE FUNCTION check_no_cycle();
