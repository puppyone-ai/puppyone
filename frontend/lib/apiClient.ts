import { createBrowserClient } from '@supabase/ssr';

/**
 * 统一的 API 客户端
 * 自动附加 Authorization header
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

function _initSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
    );
  }
  return createBrowserClient(url, key);
}

let _supabase: ReturnType<typeof _initSupabase> | null = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = _initSupabase();
  }
  return _supabase;
}

/**
 * Cached access token + expiry — kept in sync with auth state changes.
 *
 * PERFORMANCE (P-6): 10 concurrent SWR requests previously caused 10
 * sequential `getSession()` calls. We now subscribe to onAuthStateChange
 * so the cached token is updated proactively, and getAuthToken() returns
 * synchronously while the cache is fresh.
 */
let _cachedToken: string | null = null;
let _cacheValidUntilMs = 0;
let _authSubscribed = false;
let _inflightFetch: Promise<string | null> | null = null;

function _setCacheFromSession(session: { access_token?: string; expires_at?: number } | null | undefined) {
  if (session?.access_token) {
    _cachedToken = session.access_token;
    // expires_at is in seconds (epoch). Refresh 60s before actual expiry.
    _cacheValidUntilMs = session.expires_at ? session.expires_at * 1000 : Date.now() + 30_000;
  } else {
    _cachedToken = null;
    _cacheValidUntilMs = 0;
  }
}

function _ensureAuthSubscription() {
  if (_authSubscribed) return;
  _authSubscribed = true;
  try {
    getSupabase().auth.onAuthStateChange((_event, session) => {
      _setCacheFromSession(session as any);
    });
  } catch {
    // ignore — fall back to per-call getSession()
  }
}

async function getAuthToken(): Promise<string | null> {
  _ensureAuthSubscription();

  // Fast path: cache fresh (60s buffer before expiry)
  if (_cachedToken && Date.now() < _cacheValidUntilMs - 60_000) {
    return _cachedToken;
  }

  // Coalesce: concurrent callers share a single in-flight getSession().
  if (_inflightFetch) return _inflightFetch;
  _inflightFetch = (async () => {
    try {
      const { data } = await getSupabase().auth.getSession();
      _setCacheFromSession(data.session as any);
      return _cachedToken;
    } finally {
      _inflightFetch = null;
    }
  })();
  return _inflightFetch;
}

/**
 * 暴露给其他 API 客户端使用
 */
export async function getApiAccessToken(): Promise<string | null> {
  return getAuthToken();
}

// Alias for backward compatibility
export const getAccessToken = getApiAccessToken;

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 带认证的 API 请求
 */
export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const token = await getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // 如果有 token，添加 Authorization header
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // 处理 401 未授权
  if (response.status === 401) {
    const error: any = new Error('未登录或登录已过期');
    error.response = response;
    error.code = 401;
    throw error;
  }

  // Handle HTTP error status codes (4xx/5xx) — FastAPI HTTPException returns {"detail": ...}
  if (!response.ok) {
    let body: any = null;
    try { body = JSON.parse(await response.text()); } catch {}

    // Puppyone custom format: {"code": N, "message": "...", "data": null}
    // FastAPI standard format: {"detail": "..." | {...}}
    const puppyoneMsg: string | undefined = body?.message;
    const fastApiDetail = body?.detail;

    // Extract the human-readable message
    let errorMsg = `HTTP ${response.status}`;
    if (puppyoneMsg) {
      errorMsg = puppyoneMsg;
    } else if (typeof fastApiDetail === 'string') {
      errorMsg = fastApiDetail;
    } else if (fastApiDetail?.message) {
      errorMsg = fastApiDetail.message;
    }

    // Detect duplicate: check multiple signals
    const isDuplicate = response.status === 409 && (
      fastApiDetail?.error === 'duplicate_access_point' ||
      (typeof puppyoneMsg === 'string' && (
        puppyoneMsg.includes('duplicate_access_point') ||
        puppyoneMsg.includes('already exists')
      ))
    );

    // If it's a dup, extract the inner message from Python dict string
    // e.g. "{'error': '...', 'message': 'A sync already exists...'}"
    let cleanMsg = errorMsg;
    if (isDuplicate && puppyoneMsg) {
      const m = puppyoneMsg.match(/['"]message['"]\s*:\s*['"](.*?)['"]\s*[,}]/s);
      if (m) cleanMsg = m[1];
    }

    const error: any = new Error(cleanMsg);
    error.status = response.status;
    error.code = body?.code ?? response.status;
    error.detail = fastApiDetail ?? body;
    error.isDuplicate = isDuplicate;
    throw error;
  }

  const data: ApiResponse<T> = await response.json();

  if (data.code !== 0) {
    const error: any = new Error(data.message || 'API request failed');
    error.response = response;
    error.data = data.data;
    error.code = data.code;
    throw error;
  }

  return data.data;
}

/**
 * GET 请求
 */
export function get<T>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'GET' });
}

/**
 * POST 请求
 */
export function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * PUT 请求
 */
export function put<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * DELETE 请求
 */
export function del<T>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'DELETE' });
}

/**
 * PATCH 请求
 */
export function patch<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}
