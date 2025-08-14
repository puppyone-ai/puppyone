// Verify user token by delegating to the private User System backend
// Reads token from Authorization header or access_token cookie

import { cookies } from 'next/headers';
import { SERVER_ENV } from '@/lib/serverEnv';
const USER_SYSTEM_BACKEND = SERVER_ENV.USER_SYSTEM_BACKEND;

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
      // not in a node runtime that supports next/headers (edge), try request cookie header
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

  const url = `${(USER_SYSTEM_BACKEND || '').replace(/\/$/, '')}/protected`;

  const upstream = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader,
    },
  });

  const body = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json';

  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': contentType },
  });
}


