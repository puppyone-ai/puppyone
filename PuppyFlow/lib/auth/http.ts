import { cookies } from 'next/headers';
import { SERVER_ENV } from '@/lib/serverEnv';

const BANNED_FORWARD_HEADERS = new Set<string>([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'encoding',
  'upgrade',
  'content-length',
  'cookie',
  'authorization',
]);

export function getAuthCookieName(): string {
  // Fallback to legacy name if not configured
  return (SERVER_ENV as any).AUTH_COOKIE_NAME || 'access_token';
}

export function getAuthCookiePath(): string {
  return (SERVER_ENV as any).AUTH_COOKIE_PATH || '/';
}

function buildCookieMatchRegex(name: string): RegExp {
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  return new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`);
}

export function extractAuthHeader(request: Request): string | undefined {
  let authHeader = request.headers.get('authorization') || undefined;
  if (authHeader) return authHeader;

  // Try HttpOnly cookie first via next/headers
  try {
    const token = cookies().get(getAuthCookieName())?.value;
    if (token) return `Bearer ${token}`;
  } catch {
    // ignore, fallback to raw cookie parsing below
  }

  const rawCookie = request.headers.get('cookie') || '';
  if (rawCookie) {
    const match = rawCookie.match(buildCookieMatchRegex(getAuthCookieName()));
    if (match) return `Bearer ${decodeURIComponent(match[1])}`;
  }
  return undefined;
}

export function filterRequestHeadersAndInjectAuth(
  request: Request,
  original: Headers,
  options?: { includeServiceKey?: boolean; localFallback?: boolean }
): Record<string, string> {
  const newHeaders: Record<string, string> = {};

  original.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (BANNED_FORWARD_HEADERS.has(lower)) return;
    newHeaders[key] = value;
  });

  const derivedAuth = extractAuthHeader(request);
  if (derivedAuth) {
    newHeaders['authorization'] = derivedAuth;
  }

  const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  if (!newHeaders['authorization'] && options?.localFallback !== false) {
    if (mode !== 'cloud') {
      newHeaders['authorization'] = 'Bearer local-dev';
    }
  }

  if (options?.includeServiceKey && (SERVER_ENV as any).SERVICE_KEY) {
    newHeaders['x-service-key'] = (SERVER_ENV as any).SERVICE_KEY;
  }

  return newHeaders;
}
