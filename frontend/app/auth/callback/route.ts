import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase OAuth Callback - Route Handler (服务端)
 *
 * 处理流程：
 * 1. 从 URL 获取 code 参数
 * 2. 在服务端用 code 交换 session
 * 3. 检查用户 onboarding 状态，如果未完成则完成 onboarding
 * 4. 设置 cookie 后重定向到正确的页面
 *
 * 注意：Onboarding 在这里处理，而不是在 React 组件中，
 * 因为这是服务端代码，只会执行一次，不受 React StrictMode 影响。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

    if (!error && data.session) {
      // ✅ 在服务端处理 Onboarding（只执行一次，不受 React StrictMode 影响）
      try {
        const token = data.session.access_token;
        
        // 1. 检查 onboarding 状态
        const statusRes = await fetch(`${apiUrl}/api/v1/profile/onboarding/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const statusData = await statusRes.json();

        if (statusData.code === 0 && !statusData.data.has_onboarded) {
          // 2. 新用户 - 完成 onboarding（创建 demo project）
          const completeRes = await fetch(`${apiUrl}/api/v1/profile/onboarding/complete`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });
          const completeData = await completeRes.json();

          if (completeData.code === 0 && completeData.data.redirect_to) {
            // 重定向到 demo project（带 welcome 参数显示引导）
            return NextResponse.redirect(`${siteUrl}${completeData.data.redirect_to}`);
          }
        }
      } catch (e) {
        console.error('Onboarding check failed:', e);
        // 即使 onboarding 检查失败，也继续正常流程
      }

      // 老用户或 onboarding 检查失败，重定向到 home
      return NextResponse.redirect(`${siteUrl}${next}`);
    }

    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${siteUrl}/login?error=auth_callback_failed`);
  }

  return NextResponse.redirect(`${siteUrl}/login`);
}
