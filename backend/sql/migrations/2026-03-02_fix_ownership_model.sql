-- ============================================================
-- PuppyOne — 修复所有权模型 (5 张表)
-- Date: 2026-03-02
--
-- 5 张表的 user_id 是"谁拥有"语义，但它们是项目级共享资源。
-- 统一改为 created_by（"谁创建的"，审计字段），
-- 后端查询改用 project_id 过滤。
--
-- 受影响的表：
--   mcp, db_connections, context_publish, syncs, uploads
-- ============================================================


-- ============================================================
-- 1. mcp: user_id → created_by (nullable)
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mcp' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE mcp RENAME COLUMN user_id TO created_by;
    END IF;
END $$;

ALTER TABLE mcp ALTER COLUMN created_by DROP NOT NULL;


-- ============================================================
-- 2. db_connections: user_id → created_by (nullable)
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'db_connections' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE db_connections RENAME COLUMN user_id TO created_by;
    END IF;
END $$;

ALTER TABLE db_connections ALTER COLUMN created_by DROP NOT NULL;


-- ============================================================
-- 3. context_publish: user_id → created_by (nullable)
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'context_publish' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE context_publish RENAME COLUMN user_id TO created_by;
    END IF;
END $$;

ALTER TABLE context_publish ALTER COLUMN created_by DROP NOT NULL;


-- ============================================================
-- 4. syncs: user_id → created_by (already nullable)
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'syncs' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE syncs RENAME COLUMN user_id TO created_by;
    END IF;
END $$;


-- ============================================================
-- 5. uploads: user_id → created_by (nullable)
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'uploads' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE uploads RENAME COLUMN user_id TO created_by;
    END IF;
END $$;

ALTER TABLE uploads ALTER COLUMN created_by DROP NOT NULL;


-- ============================================================
-- 完成!
--
-- 5 张表: mcp, db_connections, context_publish, syncs, uploads
-- user_id → created_by (nullable, 审计字段)
--
-- 后端代码需要同步修改：
--   查询逻辑从 .eq("user_id", ...) 改为 .eq("project_id", ...)
--   模型字段从 user_id 改为 created_by
-- ============================================================
