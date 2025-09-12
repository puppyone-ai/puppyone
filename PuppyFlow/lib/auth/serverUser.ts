import { cookies } from 'next/headers';
import { SERVER_ENV } from '@/lib/serverEnv';

export async function getCurrentUserId(request: Request): Promise<string> {
  // Non-cloud deployments do not require user verification
  // Treat any mode other than explicit 'cloud' as local/dev
  if ((process.env.DEPLOYMENT_MODE || '').toLowerCase() !== 'cloud') {
    return 'local-user';
  }

  const allowWithoutServiceKey =
    (process.env.ALLOW_VERIFY_WITHOUT_SERVICE_KEY || '').toLowerCase() ===
    'true';
  if (!process.env.SERVICE_KEY && !allowWithoutServiceKey) {
    throw new Error(
      'Cloud mode requires SERVICE_KEY (or set ALLOW_VERIFY_WITHOUT_SERVICE_KEY=true for dev)'
    );
  }

  let authHeader = request.headers.get('authorization');
  if (!authHeader) {
    try {
      const token = cookies().get(SERVER_ENV.AUTH_COOKIE_NAME)?.value;
      if (token) authHeader = `Bearer ${token}`;
    } catch {
      const rawCookie = request.headers.get('cookie') || '';
      const name = SERVER_ENV.AUTH_COOKIE_NAME.replace(
        /[-[\]{}()*+?.,\\^$|#\s]/g,
        '\\$&'
      );
      const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
      if (match) authHeader = `Bearer ${decodeURIComponent(match[1])}`;
    }
  }

  if (!authHeader) throw new Error('No auth token');

  // Cloud mode: Call internal verify endpoint
  const url = new URL('/api/auth/verify', request.url).toString();
  const verifyHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: authHeader,
  };
  // Include service key for internal verification when configured
  if (SERVER_ENV.SERVICE_KEY) {
    verifyHeaders['x-service-key'] = SERVER_ENV.SERVICE_KEY;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: verifyHeaders,
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status}`);

  const body = await res.json();
  const userId = body?.user_id || body?.user?.user_id || body?.userId;
  if (!userId) throw new Error('user_id not found from verify');
  return String(userId);
}
