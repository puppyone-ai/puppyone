-- ============================================================================
-- Migration: 清理旧的 Gmail 导入数据
-- 
-- 背景：
--   旧架构为每封邮件创建一个 content_node（type: gmail_email）
--   新架构将所有邮件存在一个 JSONB 节点中（type: gmail_inbox）
--   需要清理旧数据以避免污染
--
-- 执行前请先运行 SELECT 查询确认要删除的数据
-- ============================================================================

-- Step 1: 查看要删除的 gmail_email 节点数量
SELECT 
    'gmail_email nodes' as type,
    COUNT(*) as count 
FROM content_nodes 
WHERE type = 'gmail_email';

-- Step 2: 查看要删除的 Gmail 文件夹数量
SELECT 
    'Gmail folders' as type,
    COUNT(*) as count 
FROM content_nodes 
WHERE type = 'folder' 
AND name LIKE 'Gmail - %';

-- Step 3: 查看详细信息（可选，用于确认）
-- SELECT id, name, type, created_at 
-- FROM content_nodes 
-- WHERE type = 'gmail_email' 
-- ORDER BY created_at DESC 
-- LIMIT 10;

-- ============================================================================
-- 确认无误后，执行以下删除语句
-- ============================================================================

-- Step 4: 删除所有 gmail_email 类型的节点
DELETE FROM content_nodes WHERE type = 'gmail_email';

-- Step 5: 删除 Gmail 文件夹
-- 注意：这会删除所有名称以 "Gmail - " 开头的文件夹
DELETE FROM content_nodes 
WHERE type = 'folder' 
AND name LIKE 'Gmail - %';

-- Step 6: 验证删除结果
SELECT 
    type,
    COUNT(*) as remaining_count
FROM content_nodes 
WHERE type IN ('gmail_email', 'gmail_inbox')
   OR (type = 'folder' AND name LIKE 'Gmail - %')
GROUP BY type;

-- 预期结果：应该返回 0 行或只有 gmail_inbox 类型（如果已经用新架构导入过）


