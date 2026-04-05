import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  getServerApiBaseUrl,
  getServerSupabaseUrl,
  getSupabaseAnonKey,
  getRequestOrigin,
} from '@/lib/server-env';

/**
 * Supabase Auth Callback - Route Handler (服务端)
 *
 * 仅处理 OAuth 登录回调（Google / GitHub）。
 * 邮件类流程（注册确认、密码重置）走 /auth/confirm。
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/home';
  const apiUrl = getServerApiBaseUrl();

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error('Auth callback exchange failed:', error?.message, error?.status);
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  try {
    const token = data.session.access_token;

    // Idempotent initialization: ensures profile + org + membership exist
    await fetch(`${apiUrl}/api/v1/auth/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.error('Auth initialization failed:', e);
  }

  // Always redirect to /home — template-based onboarding handles first-time UX
  return NextResponse.redirect(`${origin}${next}`);
}
