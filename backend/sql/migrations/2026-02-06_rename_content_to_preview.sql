-- ============================================================================
-- Migration: 重命名 json_content/md_content 为 preview_json/preview_md
-- Date: 2026-02-06
-- Purpose: 让字段命名更语义化，避免被误解为"仅特定文件类型使用"
-- ============================================================================
--
-- 变更说明：
--   json_content → preview_json  (JSON 格式的预览内容)
--   md_content   → preview_md    (Markdown/文本格式的预览内容)
--
-- 这两个字段的实际用途：
--   preview_json: JSON 文件内容、Google Sheets 数据、ETL 结构化提取结果等
--   preview_md:   Markdown 文件内容、OCR 提取的文本、Notion Page 导出等
--
-- ============================================================================

-- Step 1: 重命名字段
ALTER TABLE content_nodes RENAME COLUMN json_content TO preview_json;
ALTER TABLE content_nodes RENAME COLUMN md_content TO preview_md;

-- Step 2: 更新字段注释
COMMENT ON COLUMN content_nodes.preview_json IS 'JSON 格式的预览内容 (preview_type = "json" 时有值)。用于：JSON 文件内容、SaaS 同步的结构化数据、ETL 提取结果等';
COMMENT ON COLUMN content_nodes.preview_md IS 'Markdown/文本格式的预览内容 (preview_type = "markdown" 时有值)。用于：Markdown 文件内容、OCR 提取的文本、文档导出等';
COMMENT ON COLUMN content_nodes.preview_type IS '预览内容格式: NULL(无预览) | "json"(有 preview_json) | "markdown"(有 preview_md)';

-- ============================================================================
-- 验证查询：
-- 
-- SELECT column_name, data_type, 
--        (SELECT description FROM pg_catalog.pg_description 
--         WHERE objoid = 'content_nodes'::regclass 
--         AND objsubid = ordinal_position) as comment
-- FROM information_schema.columns 
-- WHERE table_name = 'content_nodes' 
--   AND column_name IN ('preview_json', 'preview_md', 'preview_type')
-- ORDER BY ordinal_position;
-- ============================================================================

