const DEFAULT_PUBLIC_API_URL = 'http://localhost:9090';
const DEFAULT_PUBLIC_SUPABASE_URL = 'http://localhost:8000';

/**
 * True iff `next` is a safe same-origin relative path — i.e. safe to
 * concatenate onto an origin for a redirect without allowing an open
 * redirect to an attacker-controlled host.
 *
 * Rejects:
 *   - non-string / empty
 *   - anything not starting with `/` (absolute URLs, `http:…`, etc.)
 *   - `//evil.com` (protocol-relative — browsers treat as absolute)
 *   - `/\evil.com` (backslash variant some parsers normalise to `//`)
 */
export function isSafeRelativePath(next: string | null | undefined): next is string {
  if (!next || typeof next !== 'string') return false;
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//')) return false; // protocol-relative
  if (next.startsWith('/\\')) return false; // backslash → protocol-relative
  return true;
}

export function getServerApiBaseUrl(): string {
  return (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_PUBLIC_API_URL
  );
}

export function getServerSupabaseUrl(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    DEFAULT_PUBLIC_SUPABASE_URL
  );
}

export function getSupabaseAnonKey(): string {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }
  return anonKey;
}

/**
 * Resolve the public-facing origin for server-side redirects.
 *
 * Behind a reverse proxy (Railway, Vercel, etc.) `request.url` may reflect the
 * internal container address (e.g. http://localhost:8080). This helper checks,
 * in order:
 *   1. NEXT_PUBLIC_APP_URL env var (preferred, explicit)
 *   2. NEXT_PUBLIC_SITE_URL env var (legacy alias)
 *   3. x-forwarded-host + x-forwarded-proto headers (set by most proxies)
 *   4. host header
 *   5. request.url fallback
 */
export function getRequestOrigin(request: Request): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) return siteUrl.replace(/\/+$/, '');

  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return `${proto}://${forwardedHost}`;
  }

  const host = request.headers.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return `https://${host}`;
  }

  return new URL(request.url).origin;
}
