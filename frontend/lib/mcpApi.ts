/**
 * MCP API 客户端
 * 用于管理 MCP 实例的创建、查询、更新和删除
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ============================================
// 类型定义
// ============================================

// 后端支持的 8 种工具类型
export type McpToolType = 'get_data_schema' | 'get_all_data' | 'query_data' | 'create' | 'update' | 'delete' | 'preview' | 'select'

// MCP 工具权限类型（用于前端状态管理）
export interface McpToolPermissions {
  get_data_schema?: boolean
  get_all_data?: boolean
  query_data?: boolean
  preview?: boolean
  select?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}

// 工具定义（用于自定义工具名称和描述）
export interface McpToolDefinition {
  name: string
  description: string
}

// MCP 实例信息
export interface McpInstance {
  mcp_instance_id: string
  api_key: string
  user_id: string  // UUID 字符串格式
  project_id: number
  table_id: number
  json_pointer: string
  status: number  // 0=关闭, 1=开启
  port: number
  docker_info: Record<string, any>
  tools_definition: Record<McpToolType, McpToolDefinition> | null
  register_tools: McpToolType[] | null
  preview_keys: string[] | null
}

// 创建 MCP 实例请求
export interface McpCreateRequest {
  user_id: string  // UUID 字符串格式
  project_id: number
  table_id: number
  json_pointer?: string
  tools_definition: Record<McpToolType, McpToolDefinition>
  register_tools?: McpToolType[]
  preview_keys?: string[]
}

// 创建 MCP 实例响应
export interface McpCreateResponse {
  api_key: string
  url: string
}

// 更新 MCP 实例请求
export interface McpUpdateRequest {
  status?: number
  json_pointer?: string
  tools_definition?: Record<McpToolType, McpToolDefinition>
  register_tools?: McpToolType[]
  preview_keys?: string[]
}

// MCP 实例状态响应
export interface McpStatusResponse {
  status: number
  port: number
  docker_info: Record<string, any>
  json_pointer: string
  tools_definition: Record<McpToolType, McpToolDefinition>
  register_tools: McpToolType[]
  preview_keys: string[] | null
}

// API 通用响应格式
interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

// ============================================
// API 请求封装
// ============================================

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
    const error: any = new Error(data.message || 'API request failed')
    error.response = response
    error.data = data.data
    error.code = data.code
    throw error
  }

  return data.data
}

// ============================================
// MCP API 函数
// ============================================

/**
 * 获取用户的所有 MCP 实例
 */
export async function getMcpInstances(userId: number): Promise<McpInstance[]> {
  return apiRequest<McpInstance[]>(`/api/v1/mcp/list?user_id=${userId}`)
}

/**
 * 创建并启动 MCP 实例
 * @returns api_key 和 url
 */
export async function createMcpInstance(
  request: McpCreateRequest
): Promise<McpCreateResponse> {
  return apiRequest<McpCreateResponse>('/api/v1/mcp/', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

/**
 * 获取 MCP 实例状态
 */
export async function getMcpInstanceStatus(
  apiKey: string
): Promise<McpStatusResponse> {
  return apiRequest<McpStatusResponse>(`/api/v1/mcp/${apiKey}`)
}

/**
 * 更新 MCP 实例配置
 */
export async function updateMcpInstance(
  apiKey: string,
  request: McpUpdateRequest
): Promise<McpStatusResponse> {
  return apiRequest<McpStatusResponse>(`/api/v1/mcp/${apiKey}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  })
}

/**
 * 删除 MCP 实例
 */
export async function deleteMcpInstance(apiKey: string): Promise<void> {
  return apiRequest<void>(`/api/v1/mcp/${apiKey}`, {
    method: 'DELETE',
  })
}

// ============================================
// 工具函数
// ============================================

/**
 * 将前端权限配置转换为后端 register_tools 格式
 */
export function permissionsToRegisterTools(
  permissions: McpToolPermissions
): McpToolType[] {
  const tools: McpToolType[] = []
  if (permissions.get_data_schema) tools.push('get_data_schema')
  if (permissions.get_all_data) tools.push('get_all_data')
  if (permissions.query_data) tools.push('query_data')
  if (permissions.preview) tools.push('preview')
  if (permissions.select) tools.push('select')
  if (permissions.create) tools.push('create')
  if (permissions.update) tools.push('update')
  if (permissions.delete) tools.push('delete')
  return tools
}

/**
 * 将后端 register_tools 转换为前端权限配置
 */
export function registerToolsToPermissions(
  tools: McpToolType[] | null
): McpToolPermissions {
  if (!tools) return {}
  return {
    get_data_schema: tools.includes('get_data_schema'),
    get_all_data: tools.includes('get_all_data'),
    query_data: tools.includes('query_data'),
    preview: tools.includes('preview'),
    select: tools.includes('select'),
    create: tools.includes('create'),
    update: tools.includes('update'),
    delete: tools.includes('delete'),
  }
}

/**
 * 工具类型的显示信息
 */
export const TOOL_INFO: Record<McpToolType, { label: string; description: string }> = {
  get_data_schema: { label: 'Get Schema', description: '获取数据结构' },
  get_all_data: { label: 'Get All', description: '获取所有数据' },
  query_data: { label: 'Query', description: '查询数据（支持 JMESPath）' },
  preview: { label: 'Preview', description: '预览数据（轻量级）' },
  select: { label: 'Select', description: '批量选择数据' },
  create: { label: 'Create', description: '创建新元素' },
  update: { label: 'Update', description: '更新现有元素' },
  delete: { label: 'Delete', description: '删除元素' },
}

