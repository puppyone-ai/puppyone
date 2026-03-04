-- ============================================================
-- PuppyOne — 修复用户注册 (handle_new_user 触发器)
-- Date: 2026-03-04
--
-- 问题: 旧触发器在 profile 插入时设置 default_org_id，
--       但此时 organization 尚未创建，导致 FK 违约:
--       "database error saving new users"
--
-- 方案: 触发器只做最小化的事 — 创建 profile 记录。
--       组织/成员初始化移交应用层 (UserInitializationService)，
--       幂等且可重试，通过 /auth/initialize 或 onboarding 流程调用。
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email, display_name)
    VALUES (
        new.id,
        COALESCE(new.email, ''),
        COALESCE(
            new.raw_user_meta_data->>'full_name',
            split_part(new.email, '@', 1),
            'User'
        )
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
