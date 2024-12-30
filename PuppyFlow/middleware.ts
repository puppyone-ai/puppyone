import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/utils/auth'
import { SYSTEM_URLS } from '@/config/urls'

// 定义一个中间件函数，用于处理请求
export async function middleware(request: NextRequest) {
  const userPageUrl = SYSTEM_URLS.USER_SYSTEM.FRONTEND
  const token = request.cookies.get('access_token')?.value

  // 检查环境变量以决定是否跳过中间件
  if (process.env.SKIP_MIDDLEWARE === 'true') {
    // console.log('Skipping middleware due to environment variable')
    return NextResponse.next()
  }

  // 检查环境变量以决定是否跳过中间件
  // if (process.env.NODE_ENV !== 'production') {
  //   // console.log(process.env.NODE_ENV)
  //   // console.log('Skipping middleware in non-production environment')
  //   return NextResponse.next()
  // }
  
  if (!token) {
    console.log('No token found, redirecting to:', userPageUrl)
    return NextResponse.redirect(userPageUrl)
  }

  const { isValid } = await verifyToken(token)
  
  if (isValid) {
    return NextResponse.next()
  }

  console.log('Token validation failed')
  return NextResponse.redirect(userPageUrl)
}

// 配置需要进行认证的路径
export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
} 