-- ============================================================================
-- Migration: 重构 content_nodes.type 为结构化字段
-- Date: 2026-02-05
-- 
-- 设计：
--   storage_type (4种): folder | json | file | sync
--   source: 同步来源（仅 sync 类型有值）
--   resource_type: 资源细分（仅 sync 类型有值）
--
-- 存储规则：
--   folder → 无数据
--   json   → content (JSONB)
--   file   → s3_key (S3)
--   sync   → 根据 source/resource_type 决定
-- ============================================================================

-- Step 1: 添加字段（如果不存在）
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS storage_type TEXT;
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE content_nodes ADD COLUMN IF NOT EXISTS resource_type TEXT;

-- Step 2: 删除旧约束
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_storage_type;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_sync_has_source;
ALTER TABLE content_nodes ALTER COLUMN storage_type DROP NOT NULL;
ALTER TABLE content_nodes ALTER COLUMN source DROP NOT NULL;

-- Step 3: 数据迁移
UPDATE content_nodes SET
    storage_type = CASE type
        WHEN 'folder' THEN 'folder'
        WHEN 'json' THEN 'json'
        WHEN 'markdown' THEN 'file'
        WHEN 'image' THEN 'file'
        WHEN 'pdf' THEN 'file'
        WHEN 'video' THEN 'file'
        WHEN 'file' THEN 'file'
        WHEN 'pending' THEN 'file'
        ELSE 'sync'
    END,
    source = CASE type
        WHEN 'github_repo' THEN 'github'
        WHEN 'github_issue' THEN 'github'
        WHEN 'github_file' THEN 'github'
        WHEN 'notion_page' THEN 'notion'
        WHEN 'notion_database' THEN 'notion'
        WHEN 'gmail_inbox' THEN 'gmail'
        WHEN 'google_sheets_sync' THEN 'google_sheets'
        WHEN 'google_calendar_sync' THEN 'google_calendar'
        WHEN 'google_docs_sync' THEN 'google_docs'
        WHEN 'google_drive_sync' THEN 'google_drive'
        WHEN 'airtable_base' THEN 'airtable'
        WHEN 'airtable_table' THEN 'airtable'
        WHEN 'linear_project' THEN 'linear'
        WHEN 'linear_issue' THEN 'linear'
        WHEN 'slack_channel' THEN 'slack'
        ELSE NULL
    END,
    resource_type = CASE type
        WHEN 'github_repo' THEN 'repo'
        WHEN 'github_issue' THEN 'issue'
        WHEN 'github_file' THEN 'file'
        WHEN 'notion_page' THEN 'page'
        WHEN 'notion_database' THEN 'database'
        WHEN 'gmail_inbox' THEN 'inbox'
        WHEN 'google_sheets_sync' THEN 'sync'
        WHEN 'google_calendar_sync' THEN 'sync'
        WHEN 'google_docs_sync' THEN 'sync'
        WHEN 'google_drive_sync' THEN 'sync'
        WHEN 'airtable_base' THEN 'base'
        WHEN 'airtable_table' THEN 'table'
        WHEN 'linear_project' THEN 'project'
        WHEN 'linear_issue' THEN 'issue'
        WHEN 'slack_channel' THEN 'channel'
        ELSE NULL
    END
WHERE storage_type IS NULL OR storage_type = '';

-- Step 4: 添加约束
ALTER TABLE content_nodes ALTER COLUMN storage_type SET NOT NULL;

ALTER TABLE content_nodes ADD CONSTRAINT chk_storage_type 
CHECK (storage_type IN ('folder', 'json', 'file', 'sync'));

ALTER TABLE content_nodes ADD CONSTRAINT chk_sync_has_source 
CHECK (storage_type != 'sync' OR source IS NOT NULL);

-- Step 5: 创建索引
DROP INDEX IF EXISTS idx_content_nodes_storage_type;
DROP INDEX IF EXISTS idx_content_nodes_source;
DROP INDEX IF EXISTS idx_content_nodes_project_source;

CREATE INDEX idx_content_nodes_storage_type ON content_nodes(storage_type);
CREATE INDEX idx_content_nodes_source ON content_nodes(source) WHERE source IS NOT NULL;
CREATE INDEX idx_content_nodes_project_source ON content_nodes(project_id, source) WHERE source IS NOT NULL;

-- Step 6: 注释
COMMENT ON COLUMN content_nodes.storage_type IS 'folder | json | file | sync';
COMMENT ON COLUMN content_nodes.source IS '同步来源: github | notion | gmail | google_sheets | ...';
COMMENT ON COLUMN content_nodes.resource_type IS '资源类型: repo | page | database | inbox | ...';

-- ============================================================================
-- 旧 type 字段暂时保留，后续版本删除：
-- ALTER TABLE content_nodes DROP CONSTRAINT content_nodes_type_check;
-- ALTER TABLE content_nodes DROP COLUMN type;
-- ============================================================================
