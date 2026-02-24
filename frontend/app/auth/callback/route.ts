import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase OAuth Callback - Route Handler (服务端)
 *
 * 处理流程：
 * 1. 从 URL 获取 code 参数
 * 2. 在服务端用 code 交换 session
 * 3. 检查用户 onboarding 状态
 * 4. 新用户 → 跳 /home（客户端 PreparingScreen 展示动画 + 完成 onboarding）
 *    老用户 → 跳 /home 或 next 参数指定的路径
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

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
      // 检查 onboarding 状态，新用户跳 /home 显示 PreparingScreen
      try {
        const token = data.session.access_token;
        
        const statusRes = await fetch(`${apiUrl}/api/v1/profile/onboarding/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const statusData = await statusRes.json();

        if (statusData.code === 0 && !statusData.data.has_onboarded) {
          // 新用户：跳转到 /home，由客户端 PreparingScreen 展示动画并完成 onboarding
          return NextResponse.redirect(`${siteUrl}/home`);
        }
      } catch (e) {
        console.error('Onboarding check failed:', e);
      }

      // 老用户或检查失败，正常跳转
      return NextResponse.redirect(`${siteUrl}${next}`);
    }

    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${siteUrl}/login?error=auth_callback_failed`);
  }

  return NextResponse.redirect(`${siteUrl}/login`);
}
