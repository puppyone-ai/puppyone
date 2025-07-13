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
    // 🔥 记录配置错误到服务器日志（总是记录，便于运维排查）
    console.error('🚨 Configuration Mismatch Detected:', {
      issue: 'production_host_with_dev_frontend_url',
      current_host: request.headers.get('host'),
      frontend_url: userPageUrl,
      suggestion: 'check_USER_SYSTEM_FRONTEND_URL_env_var',
      original_url: request.url,
      timestamp: new Date().toISOString()
    });

    if (debugMode) {
      // 🔧 调试模式：提供技术详细信息
      const debugUrl = new URL(userPageUrl);
      debugUrl.searchParams.set('debug_error', 'config_mismatch');
      debugUrl.searchParams.set('issue', 'production_host_with_dev_frontend_url');
      debugUrl.searchParams.set('current_host', request.headers.get('host') || 'unknown');
      debugUrl.searchParams.set('frontend_url', userPageUrl);
      debugUrl.searchParams.set('suggestion', 'check_USER_SYSTEM_FRONTEND_URL_env_var');
      return NextResponse.redirect(debugUrl.toString());
    } else {
      // 🎯 生产模式：给用户友好的错误信息
      const userFriendlyUrl = new URL(userPageUrl);
      userFriendlyUrl.searchParams.set('error', 'service_configuration');
      userFriendlyUrl.searchParams.set('message', 'Service temporarily unavailable. Please try again or contact support.');
      return NextResponse.redirect(userFriendlyUrl.toString());
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
        // 🔥 记录token验证失败到服务器日志
        console.error('🚨 Token Verification Failed:', {
          status: response.status,
          backend_url: fullUrl,
          token_prefix: authTokenFromUrl.substring(0, 20),
          original_url: request.url,
          timestamp: new Date().toISOString()
        });

        if (debugMode) {
          // 🔧 调试模式：提供技术详细信息
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
          // 🎯 生产模式：给用户友好的错误信息
          const userFriendlyUrl = new URL(userPageUrl);
          userFriendlyUrl.searchParams.set('error', 'authentication_failed');
          userFriendlyUrl.searchParams.set('message', 'Authentication failed. Please sign in again.');
          return NextResponse.redirect(userFriendlyUrl.toString());
        }
      }
    } catch (error) {
      // 🔥 记录网络错误到服务器日志
      console.error('🚨 Network Error in Auth Token Verification:', {
        error_message: error instanceof Error ? error.message : 'unknown',
        backend_url: SYSTEM_URLS.USER_SYSTEM.BACKEND,
        original_url: request.url,
        timestamp: new Date().toISOString()
      });

      if (debugMode) {
        // 🔧 调试模式：提供技术详细信息
        const debugUrl = new URL(userPageUrl);
        debugUrl.searchParams.set('debug_error', 'network_error');
        debugUrl.searchParams.set('error_message', error instanceof Error ? error.message : 'unknown');
        debugUrl.searchParams.set('backend_url', SYSTEM_URLS.USER_SYSTEM.BACKEND);
        return NextResponse.redirect(debugUrl.toString());
      } else {
        // 🎯 生产模式：给用户友好的错误信息
        const userFriendlyUrl = new URL(userPageUrl);
        userFriendlyUrl.searchParams.set('error', 'service_unavailable');
        userFriendlyUrl.searchParams.set('message', 'Service temporarily unavailable. Please try again later.');
        return NextResponse.redirect(userFriendlyUrl.toString());
      }
    }
  }

  // 统一验证模式：使用Authorization header验证
  if (token) {
    // 客户端早期检查Token格式
    if (token.split('.').length !== 3) {
      console.error('🚨 Client-side Token Format Invalid:', {
        cookie_prefix: token.substring(0, 20),
        original_url: request.url,
        timestamp: new Date().toISOString()
      });

      // 直接重定向，不请求后端
      if (debugMode) {
        const debugUrl = new URL(userPageUrl);
        debugUrl.searchParams.set('debug_error', 'client_token_malformed');
        return NextResponse.redirect(debugUrl.toString());
      } else {
        const userFriendlyUrl = new URL(userPageUrl);
        userFriendlyUrl.searchParams.set('error', 'authentication_failed');
        userFriendlyUrl.searchParams.set('message', 'Authentication failed due to an invalid token. Please sign in again.');
        return NextResponse.redirect(userFriendlyUrl.toString());
      }
    }
    
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
      } else {
        // 🔥 处理特定的错误响应
        let errorInfo = null;
        let responseText = '';
        try {
          // 先克隆响应，以防body被消耗
          const clonedResponse = response.clone();
          responseText = await clonedResponse.text();
          errorInfo = JSON.parse(responseText);
        } catch (e) {
          // 如果无法解析JSON，记录原始响应文本
          console.error('🚨 Failed to parse JSON from auth response:', {
            status: response.status,
            response_text: responseText.substring(0, 500), // 记录部分原始响应
            original_url: request.url,
          });
          // 使用一个默认的错误结构，让后续逻辑可以继续
          errorInfo = { error_code: 'BACKEND_RESPONSE_NOT_JSON', message: 'Backend returned non-JSON response' };
        }

        const errorCode = errorInfo?.error_code
        const shouldClearCookie = errorCode && ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_MALFORMED'].includes(errorCode)

        // 🔥 记录详细的认证失败信息到服务器日志（保持详细错误类型用于调试）
        console.error('🚨 Cookie Token Verification Failed:', {
          status: response.status,
          error_code: errorCode || 'unknown',
          error_message: errorInfo?.message || 'unknown',
          should_clear_cookie: shouldClearCookie,
          cookie_prefix: token.substring(0, 20),
          original_url: request.url,
          timestamp: new Date().toISOString()
        });

        // 🔥 根据错误类型决定是否清除cookie
        if (shouldClearCookie) {
          const redirectResponse = NextResponse.redirect(new URL(userPageUrl))
          
          // 清除无效的cookie
          const cookieDomain = getCookieDomain(request)
          
          if (cookieDomain) {
            redirectResponse.cookies.set('access_token', '', { 
              path: '/', 
              domain: cookieDomain,
              expires: new Date(0)
            })
          } else {
            redirectResponse.cookies.set('access_token', '', { 
              path: '/',
              expires: new Date(0)
            })
          }
          
          if (debugMode) {
            // 🔧 调试模式：提供技术详细信息
            const debugUrl = new URL(userPageUrl);
            debugUrl.searchParams.set('debug_error', 'invalid_token_cleared');
            debugUrl.searchParams.set('server_error_code', errorCode); // 服务器内部错误码
            debugUrl.searchParams.set('cookie_cleared', 'true');
            return NextResponse.redirect(debugUrl.toString());
          } else {
            // 🎯 生产模式：统一的用户侧错误类型（安全考虑）
            const userFriendlyUrl = new URL(userPageUrl);
            userFriendlyUrl.searchParams.set('error', 'authentication_failed');
            userFriendlyUrl.searchParams.set('message', 'Authentication failed. Please sign in again.');
            return NextResponse.redirect(userFriendlyUrl.toString());
          }
        }
        
        // 🔥 其他错误（如服务不可用）保持cookie，但重定向到登录页
        if (debugMode) {
          const debugUrl = new URL(userPageUrl);
          debugUrl.searchParams.set('debug_error', 'auth_service_error');
          debugUrl.searchParams.set('error_code', errorCode || 'unknown');
          debugUrl.searchParams.set('status', response.status.toString());
          debugUrl.searchParams.set('cookie_preserved', 'true');
          return NextResponse.redirect(debugUrl.toString());
        } else {
          const userFriendlyUrl = new URL(userPageUrl);
          userFriendlyUrl.searchParams.set('error', 'service_unavailable');
          userFriendlyUrl.searchParams.set('message', 'Authentication service temporarily unavailable. Please try again later.');
          return NextResponse.redirect(userFriendlyUrl.toString());
        }
      }
    } catch (error) {
      // 🔥 记录网络错误到服务器日志
      console.error('🚨 Network Error in Cookie Verification:', {
        error_message: error instanceof Error ? error.message : 'unknown',
        backend_url: SYSTEM_URLS.USER_SYSTEM.BACKEND,
        original_url: request.url,
        timestamp: new Date().toISOString()
      });

      if (debugMode) {
        // 🔧 调试模式：提供技术详细信息
        const debugUrl = new URL(userPageUrl);
        debugUrl.searchParams.set('debug_error', 'network_error');
        debugUrl.searchParams.set('error_message', error instanceof Error ? error.message : 'unknown');
        debugUrl.searchParams.set('backend_url', SYSTEM_URLS.USER_SYSTEM.BACKEND);
        return NextResponse.redirect(debugUrl.toString());
      } else {
        // 🎯 生产模式：给用户友好的错误信息
        const userFriendlyUrl = new URL(userPageUrl);
        userFriendlyUrl.searchParams.set('error', 'service_unavailable');
        userFriendlyUrl.searchParams.set('message', 'Service temporarily unavailable. Please try again later.');
        return NextResponse.redirect(userFriendlyUrl.toString());
      }
    }
  }

  // 🔥 最终fallback：没有有效认证信息
  console.info('ℹ️ No Valid Authentication Found:', {
    has_auth_token: !!authTokenFromUrl,
    has_cookie: !!token,
    original_url: request.url,
    timestamp: new Date().toISOString()
  });

  if (debugMode) {
    // 🔧 调试模式：提供技术详细信息
    const debugUrl = new URL(userPageUrl);
    debugUrl.searchParams.set('debug_error', 'no_auth');
    debugUrl.searchParams.set('has_auth_token', String(!!authTokenFromUrl));
    debugUrl.searchParams.set('has_cookie', String(!!token));
    return NextResponse.redirect(debugUrl.toString());
  } else {
    // 🎯 生产模式：给用户友好的提示信息
    const userFriendlyUrl = new URL(userPageUrl);
    userFriendlyUrl.searchParams.set('info', 'login_required');
    userFriendlyUrl.searchParams.set('message', 'Please sign in to access this application.');
    return NextResponse.redirect(userFriendlyUrl.toString());
  }
}

// 配置需要进行认证的路径
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
} 