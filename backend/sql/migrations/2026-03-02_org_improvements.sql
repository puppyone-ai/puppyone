-- ============================================================
-- PuppyOne — Organization 模型优化
-- Date: 2026-03-02
--
-- 三个改动:
--   1. 去掉 personal/team 区分, 统一为 team
--   2. 加 project.visibility + project_members 表 (Project 级权限)
--   3. 修复 org_members.user_id FK → profiles(user_id)
--      让 PostgREST 能直接 join org_members → profiles
-- ============================================================

-- ============================================================
-- 1. 统一 organization type → 全部改为 team
-- ============================================================

-- 把所有 personal org 改成 team, seat_limit 至少 5
UPDATE organizations
SET type = 'team',
    seat_limit = GREATEST(seat_limit, 5)
WHERE type = 'personal';

-- 去掉旧 CHECK, 加新 CHECK (只允许 team)
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_type_check;
ALTER TABLE organizations
    ADD CONSTRAINT organizations_type_check CHECK (type IN ('team'));

-- 设置默认值
ALTER TABLE organizations ALTER COLUMN type SET DEFAULT 'team';

-- ============================================================
-- 2. Project 级权限: visibility + project_members
-- ============================================================

-- project 加 visibility 字段
ALTER TABLE project ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org'
    CHECK (visibility IN ('org', 'private'));

-- project_members 表: 显式的项目级成员
CREATE TABLE IF NOT EXISTS project_members (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'editor'
                CHECK (role IN ('admin', 'editor', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- RLS + service_role 策略
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS service_role_all_project_members ON project_members';
    EXECUTE 'CREATE POLICY service_role_all_project_members ON project_members FOR ALL TO service_role USING (true) WITH CHECK (true)';
END $$;

-- ============================================================
-- 3. 修复 FK: org_members.user_id → profiles(user_id)
--    让 PostgREST 能直接 join org_members → profiles
-- ============================================================

-- 先找到并删除旧的 FK (org_members.user_id → auth.users)
DO $$
DECLARE
    fk_name TEXT;
BEGIN
    SELECT tc.constraint_name INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'org_members'
        AND kcu.column_name = 'user_id'
        AND tc.table_schema = 'public'
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE org_members DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

-- 加新 FK: org_members.user_id → profiles(user_id)
-- profiles.user_id 已经是 PK 且 references auth.users(id),
-- 所以传递性保证了数据完整性
ALTER TABLE org_members
    ADD CONSTRAINT org_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

-- ============================================================
-- 4. 更新 handle_new_user trigger (新用户 → type='team')
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    new_org_id TEXT;
    user_slug  TEXT;
    user_name  TEXT;
BEGIN
    new_org_id := uuid_generate_v4()::TEXT;
    user_name  := COALESCE(
        new.raw_user_meta_data->>'full_name',
        split_part(new.email, '@', 1),
        'User'
    );
    user_slug  := 'personal-' || new.id::TEXT;

    -- 先创建 profile (org_members FK 依赖它)
    INSERT INTO public.profiles (user_id, email, display_name, default_org_id)
    VALUES (new.id, COALESCE(new.email, ''), user_name, new_org_id);

    -- 创建 team org (不再区分 personal/team)
    INSERT INTO public.organizations (id, name, slug, type, plan, seat_limit, created_by)
    VALUES (new_org_id, user_name || '''s Workspace', user_slug, 'team', 'free', 5, new.id);

    -- 用户成为 owner
    INSERT INTO public.org_members (id, org_id, user_id, role)
    VALUES (uuid_generate_v4()::TEXT, new_org_id, new.id, 'owner');

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 完成!
-- ============================================================
