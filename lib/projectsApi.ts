/**
 * Projects API 客户端
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'

export type ProjectInfo = {
  id: string
  name: string
  description?: string
  tables: TableInfo[]
}

export type TableInfo = {
  id: string
  name: string
  rows?: number
}

export type TableData = {
  id: string
  name: string
  rows: number
  data: Array<Record<string, any>>
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const data: ApiResponse<T> = await response.json()

  if (data.code !== 0) {
    // 创建一个包含详细错误信息的错误对象
    const error: any = new Error(data.message || 'API request failed')
    error.response = response
    error.data = data.data
    error.code = data.code
    throw error
  }

  return data.data
}

// 项目相关API
export async function getProjects(): Promise<ProjectInfo[]> {
  return apiRequest<ProjectInfo[]>('/api/v1/projects/')
}

export async function getProject(projectId: string): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`)
}

export async function createProject(
  name: string,
  description?: string
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>('/api/v1/projects/', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export async function updateProject(
  projectId: string,
  name?: string,
  description?: string
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, description }),
  })
}

export async function deleteProject(projectId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  })
}

// 表相关API
export async function getTable(
  projectId: string,
  tableId: string
): Promise<TableData> {
  return apiRequest<TableData>(`/api/v1/projects/${projectId}/tables/${tableId}`)
}

export async function createTable(
  projectId: string,
  name: string,
  data?: Array<Record<string, any>>
): Promise<TableData> {
  return apiRequest<TableData>(`/api/v1/projects/${projectId}/tables`, {
    method: 'POST',
    body: JSON.stringify({ name, data: data || [] }),
  })
}

export async function updateTable(
  projectId: string,
  tableId: string,
  name?: string
): Promise<TableData> {
  return apiRequest<TableData>(
    `/api/v1/projects/${projectId}/tables/${tableId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }
  )
}

export async function deleteTable(
  projectId: string,
  tableId: string
): Promise<void> {
  return apiRequest<void>(
    `/api/v1/projects/${projectId}/tables/${tableId}`,
    {
      method: 'DELETE',
    }
  )
}

export async function updateTableData(
  projectId: string,
  tableId: string,
  data: Array<Record<string, any>>
): Promise<TableData> {
  return apiRequest<TableData>(
    `/api/v1/projects/${projectId}/tables/${tableId}/data`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  )
}

