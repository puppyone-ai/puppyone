/**
 * Connect API 客户端
 * 用于与后端 Connect 接口通信
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:9090'

export interface ParseUrlRequest {
  url: string
}

export interface DataField {
  name: string
  type: string
  sample_value?: any
}

export interface ParseUrlResponse {
  url: string
  source_type: string
  title?: string
  fields: DataField[]
  sample_data: Record<string, any>[]
  total_items: number
  data_structure: string
}

export interface ImportDataRequest {
  url: string
  project_id: number
  table_id?: number
  table_name?: string
  table_description?: string
}

export interface ImportDataResponse {
  success: boolean
  project_id: number
  table_id: number
  table_name: string
  items_imported: number
  message: string
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  message: string
}

/**
 * 获取认证token
 */
function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('supabase.auth.token')
  }
  return null
}

/**
 * 解析URL并返回数据预览
 */
export async function parseUrl(url: string): Promise<ParseUrlResponse> {
  const token = getAuthToken()
  
  const response = await fetch(`${API_BASE_URL}/api/v1/connect/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to parse URL' }))
    throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`)
  }

  const result: ApiResponse<ParseUrlResponse> = await response.json()
  
  if (!result.success) {
    throw new Error(result.message || 'Failed to parse URL')
  }

  return result.data
}

/**
 * 导入数据到项目表格
 */
export async function importData(params: ImportDataRequest): Promise<ImportDataResponse> {
  const token = getAuthToken()
  
  const response = await fetch(`${API_BASE_URL}/api/v1/connect/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to import data' }))
    throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`)
  }

  const result: ApiResponse<ImportDataResponse> = await response.json()
  
  if (!result.success) {
    throw new Error(result.message || 'Failed to import data')
  }

  return result.data
}

