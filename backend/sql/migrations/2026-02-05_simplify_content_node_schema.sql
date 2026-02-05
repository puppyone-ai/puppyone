-- ============================================================================
-- Migration: 简化 content_nodes 表结构
-- Date: 2026-02-05
-- Status: COMPLETED
-- ============================================================================
-- 
-- 最终表结构：
--
-- | 字段          | 类型   | 说明                                              |
-- |--------------|--------|---------------------------------------------------|
-- | type         | TEXT   | 节点类型: folder | json | markdown | file | sync  |
-- | source       | TEXT   | 数据来源: NULL(本地) | github | notion | ...      |
-- | preview_type | TEXT   | 可预览内容: NULL | json | markdown               |
-- | json_content | JSONB  | JSON 内容（type=json 或 sync 时）                 |
-- | md_content   | TEXT   | Markdown 内容（type=markdown 时）                 |
-- | s3_key       | TEXT   | S3 文件路径（type=file/markdown/sync 时）         |
--
-- ============================================================================

-- Step 1: 删除依赖的 view
DROP VIEW IF EXISTS content_nodes_with_type_info CASCADE;

-- Step 2: 删除所有旧约束
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_storage_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_sync_has_source;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_preview_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS content_nodes_type_check;

-- Step 3: 添加 preview_type 字段
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS preview_type TEXT;

-- Step 4: 更新 type 字段值（统一为 5 种）
UPDATE content_nodes SET type = CASE
    WHEN type = 'folder' THEN 'folder'
    WHEN type = 'json' THEN 'json'
    WHEN type = 'markdown' THEN 'markdown'
    WHEN type IN ('gmail_inbox', 'google_sheets_sync', 'google_calendar_sync', 'google_docs_sync', 
                  'google_drive_sync', 'github_repo', 'github_issue', 'github_file', 
                  'notion_page', 'notion_database', 'airtable_base', 'airtable_table',
                  'linear_project', 'linear_issue', 'slack_channel') THEN 'sync'
    WHEN type IN ('pending', 'image', 'pdf', 'video', 'file') THEN 'file'
    WHEN type ~ '^[a-z]+_[a-z_]+$' THEN 'sync'
    ELSE 'file'
END;

-- Step 5: 填充 preview_type
UPDATE content_nodes SET preview_type = CASE
    WHEN json_content IS NOT NULL THEN 'json'
    WHEN md_content IS NOT NULL THEN 'markdown'
    ELSE NULL
END;

-- Step 6: 添加新约束
ALTER TABLE content_nodes ADD CONSTRAINT chk_type 
CHECK (type IN ('folder', 'json', 'markdown', 'sync', 'file'));

ALTER TABLE content_nodes ADD CONSTRAINT chk_preview_type 
CHECK (preview_type IS NULL OR preview_type IN ('json', 'markdown'));

ALTER TABLE content_nodes ADD CONSTRAINT chk_sync_has_source 
CHECK (type != 'sync' OR source IS NOT NULL);

-- Step 7: 删除冗余字段
ALTER TABLE content_nodes DROP COLUMN IF EXISTS storage_type;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS resource_type;

-- Step 8: 更新索引
DROP INDEX IF EXISTS idx_content_nodes_storage_type;
DROP INDEX IF EXISTS idx_content_nodes_resource_type;
DROP INDEX IF EXISTS idx_content_nodes_type;

CREATE INDEX IF NOT EXISTS idx_content_nodes_type ON content_nodes(type);
CREATE INDEX IF NOT EXISTS idx_content_nodes_preview_type ON content_nodes(preview_type) WHERE preview_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_nodes_source ON content_nodes(source) WHERE source IS NOT NULL;

-- Step 9: 添加注释
COMMENT ON COLUMN content_nodes.type IS '节点类型: folder(文件夹), json(JSON内容), markdown(Markdown内容), sync(外部同步), file(文件)';
COMMENT ON COLUMN content_nodes.source IS '数据来源: NULL(本地), github, notion, gmail, google_calendar, google_sheets, etc.';
COMMENT ON COLUMN content_nodes.preview_type IS '可预览内容类型: NULL(无预览), json(有json_content), markdown(有md_content)';
COMMENT ON COLUMN content_nodes.json_content IS 'JSON 结构化数据 (type=json 或 sync 时)';
COMMENT ON COLUMN content_nodes.md_content IS 'Markdown/文本内容 (type=markdown 时)';
COMMENT ON COLUMN content_nodes.s3_key IS '二进制文件 S3 路径 (type=file/markdown/sync 时)';

-- ============================================================================
-- 验证查询：
-- 
-- SELECT type, source, preview_type, COUNT(*) as count
-- FROM content_nodes
-- GROUP BY type, source, preview_type
-- ORDER BY type, source;
-- ============================================================================
