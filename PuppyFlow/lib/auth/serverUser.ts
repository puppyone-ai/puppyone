import { SERVER_ENV } from '@/lib/serverEnv';
import { extractAuthHeader } from '@/lib/auth/http';

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

  const authHeader = extractAuthHeader(request);
  if (!authHeader) {
    console.warn('[Auth] getCurrentUserId: no auth header derived');
    throw new Error('No auth token');
  }

  // Cloud mode: Verify token directly against User System backend to avoid
  // relying on request.url origin (which can be misreported behind proxies)
  const url = `${SERVER_ENV.USER_SYSTEM_BACKEND}/verify_token`;
  const verifyHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: authHeader,
  };
  if (SERVER_ENV.SERVICE_KEY) {
    verifyHeaders['X-Service-Key'] = SERVER_ENV.SERVICE_KEY;
  }

  try {
    console.info('[Auth] verify start', {
      url,
      headerKeys: Object.keys(verifyHeaders),
      mode: (process.env.DEPLOYMENT_MODE || '').toLowerCase(),
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: verifyHeaders,
    });
    if (!res.ok) throw new Error(`verify failed: ${res.status}`);

    const body = await res.json();
    const userId = body?.user_id || body?.user?.user_id || body?.userId;
    if (!userId) throw new Error('user_id not found from verify');
    return String(userId);
  } catch (err: any) {
    const code = err?.cause?.code || err?.code;
    console.error('[Auth] verify failed', {
      url,
      code,
      message: err?.message,
    });
    throw err;
  }
}
