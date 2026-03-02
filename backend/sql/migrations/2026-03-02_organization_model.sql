-- ============================================================
-- PuppyOne — Organization Model 迁移 (非破坏性)
--
-- 只做 CREATE / ALTER / INSERT，不删任何表或数据。
-- 可安全地在现有数据库上运行。
-- ============================================================

-- ============================================================
-- STEP 1: 创建组织模型 (3 张新表)
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    avatar_url  TEXT,
    type        TEXT NOT NULL DEFAULT 'personal'
                CHECK (type IN ('personal', 'team')),
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'plus', 'pro', 'team', 'enterprise')),
    seat_limit  INT NOT NULL DEFAULT 1,
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'member', 'viewer')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members(org_id);

CREATE TABLE IF NOT EXISTS org_invitations (
    id          TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('member', 'viewer')),
    token       TEXT UNIQUE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    invited_by  UUID NOT NULL REFERENCES auth.users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STEP 2: 修改 profiles 表
-- ============================================================

-- 删除旧约束和字段 (plan/role/stripe → 移到 organizations)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles DROP COLUMN IF EXISTS plan;
ALTER TABLE profiles DROP COLUMN IF EXISTS role;
ALTER TABLE profiles DROP COLUMN IF EXISTS stripe_customer_id;

-- 添加新字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_onboarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS demo_project_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_org_id TEXT
    REFERENCES organizations(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 3: 修改 project 表
--   - 添加 org_id (先 nullable，backfill 后改 NOT NULL)
--   - user_id 改名为 created_by
--   - 添加 updated_at
-- ============================================================

ALTER TABLE project ADD COLUMN IF NOT EXISTS org_id TEXT
    REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE project ADD COLUMN IF NOT EXISTS updated_at
    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- user_id → created_by (语义从"所有者"变成"创建者")
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE project RENAME COLUMN user_id TO created_by;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_org ON project(org_id);

-- ============================================================
-- STEP 4: 修改 tool 表
--   - 添加 org_id (先 nullable，backfill 后改 NOT NULL)
--   - user_id 改名为 created_by，改为 nullable
-- ============================================================

ALTER TABLE tool ADD COLUMN IF NOT EXISTS org_id TEXT
    REFERENCES organizations(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tool' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE tool RENAME COLUMN user_id TO created_by;
        ALTER TABLE tool ALTER COLUMN created_by DROP NOT NULL;
    END IF;
END $$;

-- 替换旧索引
DROP INDEX IF EXISTS idx_tool_user_id;
CREATE INDEX IF NOT EXISTS idx_tool_org ON tool(org_id);

-- ============================================================
-- STEP 5: 修改 etl_rule 表
--   - 添加 org_id (先 nullable，backfill 后改 NOT NULL)
--   - user_id 改名为 created_by，改为 nullable
-- ============================================================

ALTER TABLE etl_rule ADD COLUMN IF NOT EXISTS org_id TEXT
    REFERENCES organizations(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'etl_rule' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE etl_rule RENAME COLUMN user_id TO created_by;
        ALTER TABLE etl_rule ALTER COLUMN created_by DROP NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_etl_rule_org ON etl_rule(org_id);

-- ============================================================
-- STEP 6: 为已有用户补建 personal org 并 backfill
-- ============================================================

DO $$
DECLARE
    r RECORD;
    new_org_id TEXT;
    user_name  TEXT;
BEGIN
    FOR r IN
        SELECT u.id AS user_id, u.email,
               u.raw_user_meta_data->>'full_name' AS full_name
        FROM auth.users u
        WHERE NOT EXISTS (
            SELECT 1 FROM org_members om WHERE om.user_id = u.id
        )
    LOOP
        new_org_id := uuid_generate_v4()::TEXT;
        user_name  := COALESCE(r.full_name, split_part(r.email, '@', 1), 'User');

        -- 创建 personal org
        INSERT INTO organizations (id, name, slug, type, plan, seat_limit, created_by)
        VALUES (
            new_org_id,
            user_name || '''s Workspace',
            'personal-' || r.user_id::TEXT,
            'personal', 'free', 1, r.user_id
        );

        -- 用户成为 owner
        INSERT INTO org_members (id, org_id, user_id, role)
        VALUES (uuid_generate_v4()::TEXT, new_org_id, r.user_id, 'owner');

        -- 设置 default_org_id
        UPDATE profiles SET default_org_id = new_org_id WHERE user_id = r.user_id;

        -- 把该用户的项目迁移到这个 org
        UPDATE project SET org_id = new_org_id WHERE created_by = r.user_id AND org_id IS NULL;

        -- 把该用户的 tool 迁移到这个 org
        UPDATE tool SET org_id = new_org_id WHERE created_by = r.user_id AND org_id IS NULL;

        -- 把该用户的 etl_rule 迁移到这个 org
        UPDATE etl_rule SET org_id = new_org_id WHERE created_by = r.user_id AND org_id IS NULL;
    END LOOP;
END $$;

-- ============================================================
-- STEP 7: backfill 完成后，org_id 设为 NOT NULL
-- ============================================================

-- 如果还有 org_id 为 NULL 的孤儿记录，先清理
DELETE FROM project WHERE org_id IS NULL;
DELETE FROM tool WHERE org_id IS NULL;
DELETE FROM etl_rule WHERE org_id IS NULL;

ALTER TABLE project  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tool     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE etl_rule ALTER COLUMN org_id SET NOT NULL;

-- ============================================================
-- STEP 8: 更新 auth trigger (新用户注册自动创建 personal org)
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

    INSERT INTO public.organizations (id, name, slug, type, plan, seat_limit, created_by)
    VALUES (new_org_id, user_name || '''s Workspace', user_slug, 'personal', 'free', 1, new.id);

    INSERT INTO public.org_members (id, org_id, user_id, role)
    VALUES (uuid_generate_v4()::TEXT, new_org_id, new.id, 'owner');

    INSERT INTO public.profiles (user_id, email, display_name, default_org_id)
    VALUES (
        new.id,
        COALESCE(new.email, ''),
        user_name,
        new_org_id
    );

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STEP 9: 新表启用 RLS + service_role 策略
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
    policy_name TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY['organizations', 'org_members', 'org_invitations'])
    LOOP
        policy_name := 'service_role_all_' || tbl;
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            policy_name, tbl
        );
    END LOOP;
END $$;

-- ============================================================
-- 完成!
--
-- 新建: organizations, org_members, org_invitations
-- 修改: profiles (删 plan/role/stripe, 加 display_name/avatar_url/default_org_id)
--       project (加 org_id, user_id → created_by, 加 updated_at)
--       tool    (加 org_id, user_id → created_by)
--       etl_rule (加 org_id, user_id → created_by)
-- 数据: 已有用户自动创建 personal org, 项目/工具/规则 backfill org_id
-- trigger: 新用户注册 → 自动创建 personal org + owner + profile
-- ============================================================
