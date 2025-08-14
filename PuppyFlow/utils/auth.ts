import { SYSTEM_URLS } from '@/config/urls';
import { NextRequest } from 'next/server';

// 验证token并设置cookie（处理OAuth回调）
export async function verifyAndSetToken(
  token: string
): Promise<{ isValid: boolean; status: number }> {
  try {
    const fullUrl = `/api/auth/verify`;

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const result = {
      status: response.status,
      isValid: response.status === 200,
    };

    if (result.isValid) {
      // 验证成功，设置cookie
      const cookieValue = `access_token=${token}; Path=/; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
      document.cookie = cookieValue;
    }

    return result;
  } catch (error) {
    console.error('Token verification error:', error);
    return {
      status: 500,
      isValid: false,
    };
  }
}

// Token验证函数
export async function verifyToken(request?: NextRequest) {
  try {
    const fullUrl = `/api/auth/verify`;

    // 构建请求头，如果是在中间件中调用，则需要手动传递cookie
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (request) {
      const token = request.cookies.get('access_token')?.value;
      if (token) {
        headers['Cookie'] = `access_token=${token}`;
      }
    }

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: headers,
      // 如果不是从中间件调用（即在客户端调用），则使用credentials: 'include'
      credentials: request ? undefined : 'include',
    });

    return {
      status: response.status,
      isValid: response.status === 200,
    };
  } catch (error) {
    console.error('Network error during token verification:', error);
    return {
      status: 500,
      isValid: false,
    };
  }
}
