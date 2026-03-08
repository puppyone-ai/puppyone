const DEFAULT_PUBLIC_API_URL = 'http://localhost:9090';
const DEFAULT_PUBLIC_SUPABASE_URL = 'http://localhost:8000';

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
 *   1. NEXT_PUBLIC_SITE_URL env var (explicit override)
 *   2. x-forwarded-host + x-forwarded-proto headers (set by most proxies)
 *   3. host header
 *   4. request.url fallback
 */
export function getRequestOrigin(request: Request): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
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
