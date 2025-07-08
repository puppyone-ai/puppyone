import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/utils/auth'
import { SYSTEM_URLS } from '@/config/urls'

// 获取cookie域名的辅助函数
function getCookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get('host')
  const env = process.env.NODE_ENV
  
  if (!host) return undefined
  
  // 生产环境：使用父域名 .puppyagent.com
  if (env === 'production' && host.includes('puppyagent.com')) {
    return '.puppyagent.com'
  }
  
  // 开发环境：检查是否是localhost的子域名
  if (host.includes('localhost')) {
    if (host === 'localhost:4000' || host === 'localhost:3000') {
      return undefined // 主域名，不设置domain
    } else {
      return '.localhost' // 子域名，使用.localhost
    }
  }
  
  // 其他环境或自定义域名：尝试提取父域名
  const parts = host.split('.')
  if (parts.length >= 2) {
    return '.' + parts.slice(-2).join('.')
  }
  
  return undefined
}

// 定义一个中间件函数，用于处理请求
export async function middleware(request: NextRequest) {
  const userPageUrl = SYSTEM_URLS.USER_SYSTEM.FRONTEND
  const token = request.cookies.get('access_token')?.value
  
  // 检查URL参数中的auth_token（OAuth回调处理）
  const url = new URL(request.url)
  const authTokenFromUrl = url.searchParams.get('auth_token')

  // 🔥 调试信息收集
  const debugInfo = {
    url: request.url,
    host: request.headers.get('host'),
    hasAuthToken: !!authTokenFromUrl,
    hasCookie: !!token,
    authTokenPrefix: authTokenFromUrl ? authTokenFromUrl.substring(0, 20) + '...' : null,
    userPageUrl,
    backendUrl: SYSTEM_URLS.USER_SYSTEM.BACKEND,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      USER_SYSTEM_FRONTEND_URL: process.env.USER_SYSTEM_FRONTEND_URL,
      SKIP_MIDDLEWARE: process.env.SKIP_MIDDLEWARE
    }
  };

  // 检查环境变量以决定是否跳过中间件
  if (process.env.SKIP_MIDDLEWARE === 'true') {
    return NextResponse.next()
  }

  // 🔥 调试模式检查
  const debugMode = process.env.DEBUG_AUTH === 'true';

  // 🚨 检查环境配置问题
  if (userPageUrl.includes('localhost:3000') && request.headers.get('host')?.includes('puppyagent.com')) {
    if (debugMode) {
      // 配置错误，在redirect URL中附加调试信息
      const debugUrl = new URL(userPageUrl);
      debugUrl.searchParams.set('debug_error', 'config_error');
      debugUrl.searchParams.set('expected_url', 'https://userserver.puppyagent.com');
      debugUrl.searchParams.set('actual_url', userPageUrl);
      return NextResponse.redirect(debugUrl.toString());
    } else {
      // 生产模式：静默重定向，不暴露调试信息
      return NextResponse.redirect(userPageUrl);
    }
  }

  // 优先处理URL中的auth_token（OAuth回调场景）
  if (authTokenFromUrl) {
    try {
      // 验证token
      const authServerUrl = SYSTEM_URLS.USER_SYSTEM.BACKEND
      const verifyPath = '/protected'
      const fullUrl = `${authServerUrl}${verifyPath}`

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenFromUrl}`,
        },
      })

      if (response.status === 200) {
        // 移除URL参数，重定向到干净的URL
        url.searchParams.delete('auth_token')
        const cleanUrl = url.toString()
        
        const redirectResponse = NextResponse.redirect(cleanUrl)
        
        // 设置cookie
        const cookieDomain = getCookieDomain(request)
        const cookieOptions = {
          path: '/',
          sameSite: 'lax' as const,
          maxAge: 24 * 60 * 60, // 24小时
          httpOnly: false, // 前端需要能读取
          domain: cookieDomain,
        }
        
        redirectResponse.cookies.set('access_token', authTokenFromUrl, cookieOptions)
        
        // 🔥 只在调试模式下设置调试cookie
        if (debugMode) {
          redirectResponse.cookies.set('debug_auth_success', 'true', { 
            path: '/', 
            maxAge: 60,
            httpOnly: false 
          });
        }
        
        return redirectResponse
      } else {
        if (debugMode) {
          // 验证失败，在redirect URL中附加调试信息
          const debugUrl = new URL(userPageUrl);
          debugUrl.searchParams.set('debug_error', 'token_verification_failed');
          debugUrl.searchParams.set('status', response.status.toString());
          debugUrl.searchParams.set('backend_url', fullUrl);
          debugUrl.searchParams.set('token_prefix', authTokenFromUrl.substring(0, 20));
          
          // 尝试获取响应内容
          try {
            const responseText = await response.text();
            debugUrl.searchParams.set('response', responseText.substring(0, 200));
          } catch (e) {
            debugUrl.searchParams.set('response', 'failed_to_read');
          }
          
          return NextResponse.redirect(debugUrl.toString());
        } else {
          return NextResponse.redirect(userPageUrl);
        }
      }
    } catch (error) {
      if (debugMode) {
        // 网络错误，在redirect URL中附加调试信息
        const debugUrl = new URL(userPageUrl);
        debugUrl.searchParams.set('debug_error', 'network_error');
        debugUrl.searchParams.set('error_message', error instanceof Error ? error.message : 'unknown');
        debugUrl.searchParams.set('backend_url', SYSTEM_URLS.USER_SYSTEM.BACKEND);
        return NextResponse.redirect(debugUrl.toString());
      } else {
        return NextResponse.redirect(userPageUrl);
      }
    }
  }

  // 统一验证模式：使用Authorization header验证
  if (token) {
    try {
      const authServerUrl = SYSTEM_URLS.USER_SYSTEM.BACKEND
      const response = await fetch(`${authServerUrl}/protected`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })

      if (response.status === 200) {
        return NextResponse.next()
      }
    } catch (error) {
      if (debugMode) {
        // Cookie验证失败的情况，在redirect URL中附加调试信息
        const debugUrl = new URL(userPageUrl);
        debugUrl.searchParams.set('debug_error', 'cookie_verification_failed');
        debugUrl.searchParams.set('has_cookie', 'true');
        debugUrl.searchParams.set('cookie_prefix', token.substring(0, 20));
        return NextResponse.redirect(debugUrl.toString());
      }
    }
  }

  if (debugMode) {
    // 没有任何认证信息的fallback
    const debugUrl = new URL(userPageUrl);
    debugUrl.searchParams.set('debug_error', 'no_auth');
    debugUrl.searchParams.set('has_auth_token', String(!!authTokenFromUrl));
    debugUrl.searchParams.set('has_cookie', String(!!token));
    return NextResponse.redirect(debugUrl.toString());
  } else {
    return NextResponse.redirect(userPageUrl);
  }
}

// 配置需要进行认证的路径
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
} 