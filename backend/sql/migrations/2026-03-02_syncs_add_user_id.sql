-- ============================================================
-- Migration: syncs 表新增 user_id 列
-- Date: 2026-03-02
--
-- 将 user_id 从 config JSONB 提升为一等公民字段，
-- 确保 OAuth 凭据解析不会因缺少 user_id 而失败。
-- ============================================================

-- 1. 新增列（允许 NULL 是为了兼容 openclaw 等无 OAuth 的 connector）
ALTER TABLE syncs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. 从 config JSONB 迁移已有数据
UPDATE syncs
SET user_id = (config->>'user_id')::UUID
WHERE config->>'user_id' IS NOT NULL
  AND config->>'user_id' != ''
  AND user_id IS NULL;

-- 3. 删除无法迁移的孤儿记录（没有 user_id 的 OAuth sync 无法工作）
DELETE FROM syncs
WHERE user_id IS NULL
  AND provider NOT IN ('openclaw', 'url');

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_syncs_user_id ON syncs (user_id) WHERE user_id IS NOT NULL;

-- 5. 清理 config 中冗余的 user_id（可选）
UPDATE syncs
SET config = config - 'user_id'
WHERE config ? 'user_id';
