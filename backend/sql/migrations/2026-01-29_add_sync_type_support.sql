-- ============================================================================
-- Migration: 支持 SaaS 同步类型
-- 
-- 目的：
--   1. 扩展 type 字段支持同步类型（如 github_repo, notion_page）
--   2. 添加同步元数据字段（sync_url, sync_id, last_synced_at）
--   3. 添加相关索引
--
-- 类型命名规范：
--   - 基础类型: folder, json, markdown, image, pdf, video, file, pending
--   - 同步类型: {source}_{resource} 格式，如 github_repo, notion_database
-- ============================================================================

-- 1. 删除旧的 type 约束
ALTER TABLE public.content_nodes 
DROP CONSTRAINT IF EXISTS content_nodes_type_check;

-- 2. 添加新的 type 约束（支持同步类型）
-- 基础类型 + 同步类型（{source}_{resource} 格式）
ALTER TABLE public.content_nodes 
ADD CONSTRAINT content_nodes_type_check CHECK (
    -- 基础类型（精确匹配）
    type IN ('folder', 'json', 'markdown', 'image', 'pdf', 'video', 'file', 'pending')
    OR
    -- 同步类型（{source}_{resource} 格式，如 github_repo, notion_page）
    type ~ '^[a-z]+_[a-z_]+$'
);

-- 3. 添加同步元数据字段
ALTER TABLE public.content_nodes 
ADD COLUMN IF NOT EXISTS sync_url TEXT;

ALTER TABLE public.content_nodes 
ADD COLUMN IF NOT EXISTS sync_id TEXT;

ALTER TABLE public.content_nodes 
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 4. 添加索引

-- 索引：按 type 的来源前缀查询（如查所有 github_* 类型）
-- 使用表达式索引提取第一个下划线前的部分
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_source 
ON public.content_nodes ((split_part(type, '_', 1))) 
WHERE type LIKE '%_%';

-- 索引：sync_url 查询（用于检查是否已同步某个 URL）
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_url 
ON public.content_nodes (sync_url) 
WHERE sync_url IS NOT NULL;

-- 索引：sync_id 查询（用于通过外部 ID 查找）
CREATE INDEX IF NOT EXISTS idx_content_nodes_sync_id 
ON public.content_nodes (sync_id) 
WHERE sync_id IS NOT NULL;

-- 5. 更新注释
COMMENT ON COLUMN public.content_nodes.type IS 
'节点类型。
基础类型: folder, json, markdown, image, pdf, video, file, pending
同步类型: {source}_{resource} 格式，如:
  - github_repo, github_issue, github_file
  - notion_database, notion_page
  - airtable_table
  - linear_project, linear_issue
  - sheets_table';

COMMENT ON COLUMN public.content_nodes.sync_url IS 
'同步来源 URL（仅同步类型有值），如 https://github.com/owner/repo';

COMMENT ON COLUMN public.content_nodes.sync_id IS 
'外部平台资源 ID（仅同步类型有值），如 GitHub repo ID, Notion page ID';

COMMENT ON COLUMN public.content_nodes.last_synced_at IS 
'上次同步时间（仅同步类型有值）';

-- 6. 创建辅助函数：判断是否为同步类型
CREATE OR REPLACE FUNCTION is_synced_node_type(node_type TEXT) 
RETURNS BOOLEAN AS $$
BEGIN
    RETURN node_type LIKE '%_%';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 7. 创建辅助函数：获取同步来源
CREATE OR REPLACE FUNCTION get_sync_source(node_type TEXT) 
RETURNS TEXT AS $$
BEGIN
    IF node_type LIKE '%_%' THEN
        RETURN split_part(node_type, '_', 1);
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 8. 创建辅助函数：获取资源类型
CREATE OR REPLACE FUNCTION get_sync_resource(node_type TEXT) 
RETURNS TEXT AS $$
BEGIN
    IF node_type LIKE '%_%' THEN
        -- 去掉第一个下划线前的部分，返回剩余部分
        RETURN substring(node_type FROM position('_' IN node_type) + 1);
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 验证查询示例（可在执行后测试）
-- ============================================================================
-- 
-- -- 查询所有 GitHub 同步的数据
-- SELECT * FROM content_nodes WHERE get_sync_source(type) = 'github';
-- 
-- -- 查询所有同步数据
-- SELECT * FROM content_nodes WHERE is_synced_node_type(type);
-- 
-- -- 查询所有"渲染为文件夹"的数据（需要应用层配置）
-- SELECT * FROM content_nodes WHERE type IN ('folder', 'github_repo', 'drive_folder');
-- ============================================================================

