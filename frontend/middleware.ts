import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Next.js Middleware - 统一处理认证和路由保护
 * 
 * 优势：
 * 1. 服务端执行，无客户端闪烁
 * 2. 统一入口，避免每个页面重复 AuthGuard
 * 3. 更快的重定向（无需等待 JS 加载）
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // 创建 response 用于后续可能的 cookie 操作
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 创建 Supabase 服务端客户端
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // 获取当前 session
  const { data: { session } } = await supabase.auth.getSession()

  // ============================================
  // 路由规则
  // ============================================

  // 1. 首页 "/" → 重定向到 /projects
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/projects', request.url))
  }

  // 2. 已登录用户访问 /login → 重定向到 /projects
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/projects', request.url))
  }

  // 3. 未登录用户访问受保护页面 → 重定向到 /login
  const protectedRoutes = ['/projects', '/tools', '/connect', '/mcp', '/etl']
  const isProtectedRoute = protectedRoutes.some(route => 
    pathname === route || pathname.startsWith(route + '/')
  )
  
  if (!session && isProtectedRoute) {
    const loginUrl = new URL('/login', request.url)
    // 可选：保存原始 URL，登录后跳回
    // loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

/**
 * Matcher 配置 - 指定 middleware 生效的路由
 * 
 * 排除：
 * - /_next (Next.js 内部资源)
 * - /api (API 路由)
 * - /auth/callback (Supabase OAuth 回调)
 * - /oauth/callback (Notion OAuth 回调)
 * - 静态文件
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (images, etc)
     * - auth/callback (Supabase OAuth)
     * - oauth/callback (Notion OAuth)
     * - api routes
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|auth/callback|oauth/callback|api).*)',
  ],
}

