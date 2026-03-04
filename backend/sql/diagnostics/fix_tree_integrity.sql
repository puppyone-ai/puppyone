-- ============================================================
-- Tree Integrity Fix (Post Phase 2b — id_path only)
-- ============================================================
-- Run AFTER check_tree_integrity.sql confirms issues exist.
-- parent_id no longer exists; all fixes operate on id_path.
-- ============================================================

-- STEP 1: Fix nodes whose id_path doesn't end with their own ID
-- Reset them to root (id_path = /{id})
UPDATE content_nodes
SET id_path = '/' || id
WHERE id != split_part(
    trim(trailing '/' from id_path),
    '/',
    array_length(string_to_array(trim(both '/' from id_path), '/'), 1)
);

-- STEP 2: Fix missing/default id_path
UPDATE content_nodes
SET id_path = '/' || id
WHERE id_path IS NULL OR id_path = '/' OR id_path = '';

-- STEP 3: Fix id_path containing own ID in ancestor position (cycle)
-- Reset to root to break the cycle
UPDATE content_nodes
SET id_path = '/' || id
WHERE array_length(
    array_positions(
        string_to_array(trim(both '/' from id_path), '/'),
        id
    ), 1
) > 1;

-- STEP 4: Verify — re-run the check
SELECT
    count(*) AS total_nodes,
    count(*) FILTER (WHERE depth = 1) AS root_nodes,
    count(*) FILTER (WHERE id_path IS NULL OR id_path = '/' OR id_path = '') AS missing_id_path,
    max(depth) AS max_depth
FROM content_nodes;
