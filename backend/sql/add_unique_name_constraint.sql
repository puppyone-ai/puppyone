-- ============================================================
-- 为 content_nodes 添加同目录名称唯一约束 (POSIX 语义)
-- 
-- 步骤:
--   1. 清理已有的重复名称节点 (追加序号后缀)
--   2. 创建唯一索引 (project_id, parent_id, name)
-- ============================================================

-- 步骤 1: 清理已有重复数据
-- 找出同目录下同名节点 (保留 created_at 最早的，其余追加序号)
DO $$
DECLARE
    grp RECORD;          -- 外层循环：重复组
    node RECORD;         -- 内层循环：组内各行
    grp_project_id TEXT; -- 缓存外层的 project_id
    grp_parent_id TEXT;  -- 缓存外层的 parent_id
    grp_name TEXT;       -- 缓存外层的 name
    row_num INT;
    new_name TEXT;
    suffix INT;
BEGIN
    -- 遍历所有重复组 (project_id + parent_id + name 相同且数量 > 1)
    FOR grp IN
        SELECT project_id, parent_id, name
        FROM content_nodes
        GROUP BY project_id, parent_id, name
        HAVING COUNT(*) > 1
    LOOP
        -- 缓存外层值，避免被内层循环覆盖
        grp_project_id := grp.project_id;
        grp_parent_id  := grp.parent_id;
        grp_name       := grp.name;
        row_num := 0;

        -- 遍历重复组中的每一行 (按 created_at 排序，保留最早的)
        FOR node IN
            SELECT id, name
            FROM content_nodes
            WHERE project_id = grp_project_id
              AND name = grp_name
              AND (
                  (parent_id IS NULL AND grp_parent_id IS NULL)
                  OR parent_id = grp_parent_id
              )
            ORDER BY created_at ASC
        LOOP
            row_num := row_num + 1;
            IF row_num > 1 THEN
                -- 为重复节点追加 " (N)" 后缀
                suffix := row_num - 1;
                new_name := node.name || ' (' || suffix || ')';
                
                -- 如果追加后缀的名称也已存在，继续递增
                WHILE EXISTS (
                    SELECT 1 FROM content_nodes cn2
                    WHERE cn2.project_id = grp_project_id
                      AND cn2.name = new_name
                      AND (
                          (cn2.parent_id IS NULL AND grp_parent_id IS NULL)
                          OR cn2.parent_id = grp_parent_id
                      )
                      AND cn2.id != node.id
                ) LOOP
                    suffix := suffix + 1;
                    new_name := node.name || ' (' || suffix || ')';
                END LOOP;
                
                UPDATE content_nodes SET name = new_name WHERE id = node.id;
                RAISE NOTICE 'Renamed duplicate node % from "%" to "%"', node.id, node.name, new_name;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 步骤 2: 添加唯一索引
-- 注意: PostgreSQL 中 NULL 值不参与唯一索引比较
-- 所以用 COALESCE(parent_id, '__root__') 将根节点的 NULL parent_id 映射为固定值
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_nodes_unique_name
ON content_nodes (project_id, COALESCE(parent_id, '__root__'), name);
