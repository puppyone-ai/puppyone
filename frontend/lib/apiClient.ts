import { createBrowserClient } from '@supabase/ssr'

/**
 * 统一的 API 客户端
 * 自动附加 Authorization header
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// 创建一个独立的 Supabase 客户端用于获取 Token
// 它会自动读取 Cookie，无需等待 AuthProvider
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * 获取当前 access token
 */
async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * 暴露给其他 API 客户端使用
 */
export async function getApiAccessToken(): Promise<string | null> {
  return getAuthToken()
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/**
 * 带认证的 API 请求
 */
export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const token = await getAuthToken()
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  
  // 如果有 token，添加 Authorization header
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  // 处理 401 未授权
  if (response.status === 401) {
    const error: any = new Error('未登录或登录已过期')
    error.response = response
    error.code = 401
    throw error
  }

  const data: ApiResponse<T> = await response.json()

  if (data.code !== 0) {
    const error: any = new Error(data.message || 'API request failed')
    error.response = response
    error.data = data.data
    error.code = data.code
    throw error
  }

  return data.data
}

/**
 * GET 请求
 */
export function get<T>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'GET' })
}

/**
 * POST 请求
 */
export function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * PUT 请求
 */
export function put<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * DELETE 请求
 */
export function del<T>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'DELETE' })
}
