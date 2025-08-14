import { cookies } from 'next/headers';

export async function getCurrentUserId(request: Request): Promise<string> {
  // local mode shortcut
  if ((process.env.DEPLOYMENT_MODE || '').toLowerCase() === 'local') {
    return 'local-user';
  }

  let authHeader = request.headers.get('authorization');
  if (!authHeader) {
    try {
      const token = cookies().get('access_token')?.value;
      if (token) authHeader = `Bearer ${token}`;
    } catch {
      const rawCookie = request.headers.get('cookie') || '';
      const match = rawCookie.match(/(?:^|;\s*)access_token=([^;]+)/);
      if (match) authHeader = `Bearer ${decodeURIComponent(match[1])}`;
    }
  }

  if (!authHeader) throw new Error('No auth token');

  // Call internal verify endpoint
  const url = new URL('/api/auth/verify', request.url).toString();
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'content-type': 'application/json', authorization: authHeader },
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);

  const body = await res.json();
  const userId = body?.user_id || body?.user?.user_id || body?.userId;
  if (!userId) throw new Error('user_id not found from verify');
  return String(userId);
}


