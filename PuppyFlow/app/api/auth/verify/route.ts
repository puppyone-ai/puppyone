// Verify user token by delegating to the private User System backend (service-to-service)
// Reads token from Authorization header or access_token cookie

import { cookies } from 'next/headers';
import { SERVER_ENV } from '@/lib/serverEnv';

export async function GET(request: Request) {
  const hdrs = new Headers(request.headers);

  // Try to get token from Authorization header first
  let authHeader = hdrs.get('authorization');

  if (!authHeader) {
    // Fallback to cookie
    try {
      const cookieStore = cookies();
      const token = cookieStore.get('access_token')?.value;
      if (token) {
        authHeader = `Bearer ${token}`;
      }
    } catch {
      // Edge 兜底：从请求头里解析 cookie
      const rawCookie = hdrs.get('cookie') || '';
      const match = rawCookie.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (match) {
        authHeader = `Bearer ${decodeURIComponent(match[1])}`;
      }
    }
  }

  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No token provided' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = `${SERVER_ENV.USER_SYSTEM_BACKEND}/verify_token`;

  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: authHeader,
  };
  if (SERVER_ENV.USER_SYSTEM_SERVICE_KEY) {
    upstreamHeaders['X-Service-Key'] = SERVER_ENV.USER_SYSTEM_SERVICE_KEY;
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: upstreamHeaders,
    });

    const bodyText = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';

    return new Response(bodyText, {
      status: upstream.status,
      headers: { 'content-type': contentType },
    });
  } catch (err: any) {
    // 统一给出结构化错误，避免中间件只看到“fetch failed”
    return new Response(
      JSON.stringify({
        error: 'UPSTREAM_FETCH_FAILED',
        message: err?.message || 'fetch failed',
        backend_url: SERVER_ENV.USER_SYSTEM_BACKEND,
      }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
}

