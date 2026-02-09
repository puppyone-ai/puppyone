-- ============================================================================
-- Migration: 创建 db_connections 表
-- Date: 2026-02-07
-- Purpose: 存储用户的外部数据库连接信息（Supabase / PostgreSQL / MySQL 等）
-- ============================================================================

CREATE TABLE IF NOT EXISTS db_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- 连接基本信息
    name TEXT NOT NULL,                          -- 用户给连接取的名字
    provider TEXT NOT NULL DEFAULT 'supabase',   -- 数据库类型: supabase | postgres | mysql

    -- 连接配置（加密存储）
    -- Supabase: { "project_url": "https://xxx.supabase.co", "service_role_key": "eyJ..." }
    config JSONB NOT NULL DEFAULT '{}',

    -- 状态
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,

    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_db_connections_user_id ON db_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_db_connections_project_id ON db_connections(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_db_connections_user_project_name 
    ON db_connections(user_id, project_id, name);

-- 字段注释
COMMENT ON TABLE db_connections IS '外部数据库连接信息';
COMMENT ON COLUMN db_connections.provider IS '数据库类型: supabase | postgres | mysql';
COMMENT ON COLUMN db_connections.config IS '连接配置 (JSONB)，包含连接字符串或项目信息';
COMMENT ON COLUMN db_connections.is_active IS '连接是否有效';

-- ============================================================================
-- 启用 RLS
-- ============================================================================
ALTER TABLE db_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own connections"
    ON db_connections
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
