-- ============================================================
-- 数据库诊断查询 — 查看当前所有表和数据情况
-- 在 Supabase SQL Editor 中运行
-- ============================================================

-- 1. 列出 public schema 下所有表及行数估算
SELECT
    schemaname,
    relname AS table_name,
    n_live_tup AS estimated_row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

-- 2. 每张表的详细列信息（列名、类型、是否可空、默认值）
SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

-- 3. 所有外键约束
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- 4. 所有索引
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 5. RLS 状态
SELECT
    relname AS table_name,
    relrowsecurity AS rls_enabled,
    relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
    AND relkind = 'r'
ORDER BY relname;

-- 6. 现有的 RLS 策略
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
