import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getServerSupabaseUrl, getSupabaseAnonKey, getRequestOrigin } from '@/lib/server-env';

/**
 * Supabase Email Verification - Route Handler (服务端)
 *
 * 处理所有邮件类回调（无需 PKCE，用 token_hash 直接验证）：
 * - 注册邮箱确认 (type=signup)
 * - 密码重置 (type=recovery → 重定向到 /reset-password)
 * - 邮箱变更确认 (type=email_change)
 *
 * 邮件链接格式：/auth/confirm?token_hash=xxx&type=recovery&next=/reset-password
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = getRequestOrigin(request);
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const next = requestUrl.searchParams.get('next') ?? '/home';

  if (!token_hash || !type) {
    console.error('Auth confirm: missing token_hash or type');
    return NextResponse.redirect(`${origin}/login?error=invalid_confirmation_link`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    getServerSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.delete({ name, ...options });
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    console.error('Auth confirm verifyOtp failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
  }

  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
