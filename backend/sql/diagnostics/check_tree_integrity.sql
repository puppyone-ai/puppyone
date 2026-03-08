-- ============================================================
-- Tree Integrity Diagnostics (Post Phase 2b — id_path only)
-- ============================================================
-- Run these queries against the database to detect data issues.
-- parent_id no longer exists; all checks use id_path + depth.
-- ============================================================

-- 1. id_path 最后一段应该等于节点自身 ID
SELECT id, name, project_id, id_path
FROM content_nodes
WHERE id != split_part(
    trim(trailing '/' from id_path),
    '/',
    array_length(string_to_array(trim(both '/' from id_path), '/'), 1)
);

-- 2. id_path 中包含自身 ID 出现多次（环的直接信号）
SELECT id, name, project_id, id_path
FROM content_nodes
WHERE array_length(
    array_positions(
        string_to_array(trim(both '/' from id_path), '/'),
        id
    ), 1
) > 1;

-- 3. id_path 为空或默认值 '/'（数据不完整）
SELECT id, name, project_id, id_path
FROM content_nodes
WHERE id_path IS NULL OR id_path = '/' OR id_path = '';

-- 4. 祖先段引用不存在的节点（孤儿路径段）
WITH path_segments AS (
    SELECT
        cn.id,
        cn.name,
        cn.project_id,
        cn.id_path,
        unnest(string_to_array(trim(both '/' from cn.id_path), '/')) AS segment
    FROM content_nodes cn
)
SELECT DISTINCT ps.id, ps.name, ps.project_id, ps.id_path, ps.segment AS missing_ancestor
FROM path_segments ps
LEFT JOIN content_nodes anc ON anc.id = ps.segment
WHERE anc.id IS NULL
  AND ps.segment != ps.id;

-- 5. 父节点存在但属于不同 project（跨项目路径）
SELECT cn.id, cn.name, cn.project_id, cn.id_path, parent_node.project_id AS parent_project_id
FROM content_nodes cn
JOIN content_nodes parent_node
    ON parent_node.id = split_part(
        trim(both '/' from cn.id_path),
        '/',
        array_length(string_to_array(trim(both '/' from cn.id_path), '/'), 1) - 1
    )
WHERE cn.depth >= 2
  AND cn.project_id != parent_node.project_id;

-- 6. UNIQUE 约束冲突检测（同目录同名）
SELECT project_id, parent_path(id_path) AS parent_p, name, count(*) AS cnt
FROM content_nodes
GROUP BY project_id, parent_path(id_path), name
HAVING count(*) > 1;

-- 7. 统计概览
SELECT
    count(*) AS total_nodes,
    count(*) FILTER (WHERE depth = 1) AS root_nodes,
    count(*) FILTER (WHERE id_path IS NULL OR id_path = '/' OR id_path = '') AS missing_id_path,
    max(depth) AS max_depth
FROM content_nodes;
