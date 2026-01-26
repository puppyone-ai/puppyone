-- ============================================
-- 数据迁移：context_table -> content_nodes
-- 执行时间：2026-01-26
-- ============================================

-- Step 1: 清空 content_nodes 表（删除测试数据）
DELETE FROM content_nodes;

-- Step 2: 删除 context_table 中无效的数据
-- 删除没有 project_id 的裸 Table（8 条）
DELETE FROM context_table WHERE project_id IS NULL;

-- 删除没有 user_id 的数据（1 条）
DELETE FROM context_table WHERE user_id IS NULL;

-- 删除重复数据（同一 project 下同名的 table）
-- project_id=18, name='a test page' 有 2 条
-- project_id=33, name='test-folder' 有 3 条
DELETE FROM context_table 
WHERE (project_id = '18' AND name = 'a test page')
   OR (project_id = '33' AND name = 'test-folder');

-- Step 3: 迁移有效数据到 content_nodes
-- 使用 WITH 子句确保 id 和 id_path 使用同一个 UUID
INSERT INTO content_nodes (
    id,
    user_id,
    project_id,
    parent_id,
    name,
    type,
    id_path,
    content,
    permissions,
    created_at,
    updated_at
)
SELECT 
    new_id,
    user_id,
    project_id,
    NULL,                             -- parent_id 为空（根目录）
    COALESCE(name, 'Untitled'),       -- 名称，如果为空则用 Untitled
    'json',                           -- 类型固定为 json
    '/' || new_id,                    -- id_path 使用同一个 UUID
    data,                             -- JSON 数据
    '{"inherit": true}'::jsonb,       -- 默认权限
    created_at,
    COALESCE(updated_at, created_at)
FROM (
    SELECT 
        gen_random_uuid()::text as new_id,
        user_id,
        project_id,
        name,
        data,
        created_at,
        updated_at
    FROM context_table
    WHERE project_id IS NOT NULL AND user_id IS NOT NULL
) AS source;

-- Step 4: 验证迁移结果
-- SELECT COUNT(*) as migrated_count FROM content_nodes;

