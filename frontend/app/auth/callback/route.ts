import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase OAuth Callback - Route Handler (服务端)
 * 
 * 处理 PKCE 流程：
 * 1. 从 URL 获取 code 参数
 * 2. 在服务端用 code 交换 session
 * 3. 设置 cookie 后重定向到 /projects
 * 
 * 这是 Supabase 官方推荐的做法，比客户端处理更安全可靠。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/projects'

  if (code) {
    const cookieStore = await cookies()
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            cookieStore.delete({ name, ...options })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // 成功，重定向到目标页面
      return NextResponse.redirect(`${origin}${next}`)
    }
    
    // 失败，重定向到登录页并带上错误信息
    console.error('OAuth callback error:', error)
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // 没有 code，可能是旧的 implicit flow 或错误
  // 重定向到登录页
  return NextResponse.redirect(`${origin}/login`)
}

