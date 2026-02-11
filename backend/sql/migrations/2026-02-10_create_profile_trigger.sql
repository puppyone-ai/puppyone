-- ============================================
-- Profile Auto-Creation Trigger
-- ============================================
-- 
-- 当新用户在 auth.users 中创建时，自动在 profiles 表创建对应记录
-- 支持所有登录方式：Email、Google OAuth、GitHub OAuth 等
--
-- 执行方式：在 Supabase Dashboard → SQL Editor 中执行此脚本
-- ============================================

-- 1. 创建触发器函数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- 以表所有者权限执行，绕过 RLS
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    email,
    role,
    plan,
    has_onboarded,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    -- 优先使用 email 字段，如果为空则从 OAuth metadata 中获取
    COALESCE(
      NEW.email,
      NEW.raw_user_meta_data ->> 'email',
      ''  -- 最后 fallback 为空字符串
    ),
    'user',
    'free',
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;  -- 如果已存在则跳过，避免重复创建
  
  RETURN NEW;
END;
$$;

-- 2. 删除旧的触发器（如果存在）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 3. 创建触发器
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. 添加注释
COMMENT ON FUNCTION public.handle_new_user() IS 
  'Auto-creates a profile record when a new user signs up via any auth method (Email, Google, GitHub, etc.)';

-- ============================================
-- 验证触发器创建成功
-- ============================================
-- SELECT tgname, tgrelid::regclass, tgtype, proname
-- FROM pg_trigger t
-- JOIN pg_proc p ON t.tgfoid = p.oid
-- WHERE tgrelid = 'auth.users'::regclass;
