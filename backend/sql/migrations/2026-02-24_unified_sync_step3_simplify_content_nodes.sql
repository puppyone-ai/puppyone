-- ============================================================
-- Unified Sync Architecture — Step 3: 精简 content_nodes
-- Date: 2026-02-24
--
-- 前置条件：Step 1 + Step 2 已运行（新表已创建，数据已迁移）
--
-- 操作：
--   1. 将 sync 类型的 content_nodes.type 归一化为原生类型
--   2. 删除 sync 相关字段
--   3. 添加新的类型约束
-- ============================================================


-- ============================================================
-- STEP 1: 归一化 content_nodes.type
-- ============================================================
-- 将 sync 类型 (google_sheets, github_repo, ...) 转为原生类型 (json, markdown, file)
-- 根据实际存储的内容判断目标类型

-- 先移除旧约束
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_sync_oauth_user;
ALTER TABLE content_nodes DROP CONSTRAINT IF EXISTS chk_type;

UPDATE content_nodes
SET type = CASE
    -- 已经是原生类型的不动
    WHEN type IN ('folder', 'json', 'markdown', 'file') THEN type
    -- 有 JSON 内容的归为 json
    WHEN preview_json IS NOT NULL THEN 'json'
    -- 有 Markdown 内容的归为 markdown
    WHEN preview_md IS NOT NULL THEN 'markdown'
    -- 有 S3 文件的归为 file
    WHEN s3_key IS NOT NULL THEN 'file'
    -- 默认归为 json（大多数 sync 源产生的是结构化数据）
    ELSE 'json'
END
WHERE type NOT IN ('folder', 'json', 'markdown', 'file');


-- ============================================================
-- STEP 2: 添加新的类型约束
-- ============================================================

ALTER TABLE content_nodes
    ADD CONSTRAINT chk_content_nodes_type
    CHECK (type IN ('folder', 'json', 'markdown', 'file'));


-- ============================================================
-- STEP 3: 删除 sync 相关字段
-- ============================================================
-- 这些字段的数据已在 Step 2 中迁移到 syncs 表

-- 删除 FK 约束先
ALTER TABLE content_nodes
    DROP CONSTRAINT IF EXISTS fk_content_nodes_sync_source;

-- 删除 sync 相关索引
DROP INDEX IF EXISTS idx_content_nodes_sync_source_id;
DROP INDEX IF EXISTS idx_content_nodes_sync_resource;

-- 删除字段
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_url;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_id;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_config;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_status;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_oauth_user_id;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS last_synced_at;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS sync_source_id;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS external_resource_id;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS remote_hash;
ALTER TABLE content_nodes DROP COLUMN IF EXISTS last_sync_version;


-- ============================================================
-- 完成 Step 3
--
-- content_nodes 当前字段：
--   id, project_id, created_by, parent_id, name, type,
--   id_path, preview_json, preview_md, s3_key, mime_type,
--   size_bytes, permissions, current_version, content_hash,
--   created_at, updated_at
--
-- type 仅允许：'folder', 'json', 'markdown', 'file'
--
-- 验证：
--   SELECT type, count(*) FROM content_nodes GROUP BY 1;
--   -- 应该只看到 folder, json, markdown, file
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'content_nodes' ORDER BY ordinal_position;
--   -- 不应包含任何 sync_* 字段
--
-- 如需回滚（需要先恢复字段，再从 syncs 表反向填充）：
--   这一步难以自动回滚，建议执行前备份：
--   CREATE TABLE content_nodes_backup AS SELECT * FROM content_nodes;
-- ============================================================
