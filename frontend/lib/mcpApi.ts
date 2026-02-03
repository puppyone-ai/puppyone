/**
 * MCP API 客户端
 * 用于管理 MCP 实例、Tool 实体和 Binding 关系的创建、查询、更新和删除
 *
 * ## 架构说明（v2）
 * - Tool：独立实体，包含 table_id、json_path、type、name 等
 * - MCP v2：轻量级入口，只有 api_key、name、status
 * - Binding：MCP 与 Tool 的多对多关系，可启用/禁用
 */

import { apiRequest, get, post, put, del } from './apiClient';

// ============================================
// 类型定义
// ============================================

// 后端支持的工具类型
// NOTE: shell_access 和 shell_access_readonly 已移至 agent_bash 表管理，不再是 Tool 类型
export type McpToolType =
  | 'get_data_schema'
  | 'get_all_data'
  | 'query_data'
  | 'search'
  | 'create'
  | 'update'
  | 'delete'
  | 'preview'
  | 'select'
  | 'custom_script';

// 工具分类
export type ToolCategory = 'builtin' | 'custom';

// MCP 工具权限类型（用于前端状态管理）
// NOTE: shell_access 权限现在由 agent_bash 表管理，不在这里
export interface McpToolPermissions {
  get_data_schema?: boolean;
  get_all_data?: boolean;
  query_data?: boolean;
  search?: boolean;
  preview?: boolean;
  select?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

// AccessPoint definition (Shared)
export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

// 工具定义（用于自定义工具名称和描述）- 保留用于前端状态
export interface McpToolDefinition {
  name: string;
  description: string;
}

// ============================================
// Tool 类型定义（v2 新增）
// ============================================

/**
 * Tool 实体 - 独立的工具定义
 */
export interface Tool {
  id: string;
  user_id: string;
  created_at: string;

  node_id: string | null;  // 绑定的 content_nodes 节点 ID
  json_path: string;
  type: McpToolType;
  name: string;
  alias?: string | null;
  description?: string | null;

  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;

  // 新增字段
  category: ToolCategory;  // 工具分类：builtin 或 custom
  script_type?: string | null;  // 脚本类型：python, javascript, shell
  script_content?: string | null;  // 脚本代码内容
}

/**
 * 创建 Tool 请求
 */
export interface ToolCreateRequest {
  node_id?: string | null;  // 绑定的 content_nodes 节点 ID
  json_path?: string; // 默认 ""
  type: McpToolType;
  name: string;
  alias?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // 新增字段
  category?: ToolCategory;  // 默认 'builtin'
  script_type?: string;
  script_content?: string;
}

/**
 * 更新 Tool 请求
 */
export interface ToolUpdateRequest {
  node_id?: string | null;
  json_path?: string;
  type?: McpToolType;
  name?: string;
  alias?: string | null;
  description?: string | null;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // 新增字段
  category?: ToolCategory;
  script_type?: string | null;
  script_content?: string | null;
}

// ============================================
// MCP v2 类型定义（v2 新增）
// ============================================

/**
 * MCP v2 实例 - 轻量级入口
 */
export interface McpV2Instance {
  id: number;
  user_id: string;
  api_key: string;
  name: string | null;
  status: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 创建 MCP v2 请求（不带绑定）
 */
export interface McpV2CreateRequest {
  name?: string;
}

/**
 * 更新 MCP v2 请求
 */
export interface McpV2UpdateRequest {
  name?: string;
  status?: boolean;
}

/**
 * Binding 请求项
 */
export interface BindingRequest {
  tool_id: string;
  status: boolean;
}

/**
 * 创建 MCP v2 并绑定 Tool 请求（推荐使用）
 */
export interface McpV2CreateWithBindingsRequest {
  name?: string;
  bindings: BindingRequest[];
}

/**
 * 创建 MCP v2 并绑定 Tool 响应
 */
export interface McpV2CreateWithBindingsResponse {
  id: number;
  api_key: string;
  tool_ids: string[];
}

/**
 * 已绑定的 Tool 信息（包含 binding 状态）
 * 对应后端 BoundToolOut schema
 */
export interface BoundTool {
  tool_id: string;
  binding_id: number;
  binding_status: boolean;

  created_at: string;
  user_id: string;

  name: string;
  type: McpToolType;
  node_id: string | null;  // 改为 node_id
  json_path: string;

  alias?: string | null;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;

  // 新增字段
  category: ToolCategory;
  script_type?: string | null;
  script_content?: string | null;
}

// ============================================
// 旧版 MCP 类型定义（v1 兼容，标记为 deprecated）
// ============================================

/**
 * MCP 实例信息
 * @deprecated 使用 McpV2Instance 替代
 */
export interface McpInstance {
  mcp_instance_id: string;
  api_key: string;
  url?: string; // MCP 服务的完整 URL（从 POST /api/v1/mcp 响应获取）
  user_id: string; // UUID 字符串格式
  project_id: string;
  table_id: string;
  name: string | null;
  json_pointer: string;
  status: number; // 0=关闭, 1=开启
  port: number;
  docker_info: Record<string, any>;
  tools_definition: Record<McpToolType, McpToolDefinition> | null;
  register_tools: McpToolType[] | null;
  preview_keys: string[] | null;
}

/**
 * 创建 MCP 实例请求
 * @deprecated 使用 McpV2CreateWithBindingsRequest 替代
 */
export interface McpCreateRequest {
  user_id: string; // UUID 字符串格式
  project_id: string;
  table_id: string;
  name: string; // 必填
  json_pointer?: string;
  tools_definition: Record<McpToolType, McpToolDefinition>;
  register_tools?: McpToolType[];
  preview_keys?: string[];
}

/**
 * 创建 MCP 实例响应
 * @deprecated 使用 McpV2CreateWithBindingsResponse 替代
 */
export interface McpCreateResponse {
  api_key: string;
  url: string;
}

/**
 * 更新 MCP 实例请求
 * @deprecated 使用 McpV2UpdateRequest 替代
 */
export interface McpUpdateRequest {
  name?: string;
  status?: number;
  json_pointer?: string;
  tools_definition?: Record<McpToolType, McpToolDefinition>;
  register_tools?: McpToolType[];
  preview_keys?: string[];
}

/**
 * MCP 实例状态响应
 * @deprecated
 */
export interface McpStatusResponse {
  name: string | null;
  status: number;
  port: number;
  docker_info: Record<string, any>;
  json_pointer: string;
  tools_definition: Record<McpToolType, McpToolDefinition>;
  register_tools: McpToolType[];
  preview_keys: string[] | null;
}

// ============================================
// Search Index 类型定义 (新增)
// ============================================

export interface SearchIndexTask {
  tool_id: string;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  started_at: string | null;
  finished_at: string | null;
  nodes_count: number | null;
  chunks_count: number | null;
  indexed_chunks_count: number | null;
  folder_node_id?: string | null;
  total_files?: number | null;
  indexed_files?: number | null;
  last_error: string | null;
}

// ============================================
// MCP API 函数
// ============================================

/**
 * 获取 Search Tool 的索引构建状态
 */
export async function getSearchIndexStatus(
  toolId: string
): Promise<SearchIndexTask> {
  return get<SearchIndexTask>(`/api/v1/tools/${toolId}/search-index`);
}

/**
 * 获取用户的所有 MCP 实例
 * 注意: user_id 从 JWT token 中获取，无需传参
 */
export async function getMcpInstances(): Promise<McpInstance[]> {
  return apiRequest<McpInstance[]>('/api/v1/mcp/list');
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
  });
}

/**
 * 获取 MCP 实例状态
 */
export async function getMcpInstanceStatus(
  apiKey: string
): Promise<McpStatusResponse> {
  return apiRequest<McpStatusResponse>(`/api/v1/mcp/${apiKey}`);
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
  });
}

/**
 * 删除 MCP 实例
 */
export async function deleteMcpInstance(apiKey: string): Promise<void> {
  return apiRequest<void>(`/api/v1/mcp/${apiKey}`, {
    method: 'DELETE',
  });
}

// ============================================
// Tool API 函数（v2 新增）
// ============================================

/**
 * 获取当前用户的所有 Tool
 */
export async function getTools(skip = 0, limit = 100): Promise<Tool[]> {
  return get<Tool[]>(`/api/v1/tools?skip=${skip}&limit=${limit}`);
}

/**
 * 获取指定节点的所有 Tool
 */
export async function getToolsByNodeId(
  nodeId: string,
  skip = 0,
  limit = 1000
): Promise<Tool[]> {
  return get<Tool[]>(
    `/api/v1/tools/by-node/${nodeId}?skip=${skip}&limit=${limit}`
  );
}

/**
 * 获取指定 project 下的所有 Tool（聚合所有节点）
 */
export async function getToolsByProjectId(projectId: string): Promise<Tool[]> {
  return get<Tool[]>(`/api/v1/tools/by-project/${projectId}`);
}

/**
 * 获取单个 Tool
 */
export async function getTool(toolId: number): Promise<Tool> {
  return get<Tool>(`/api/v1/tools/${toolId}`);
}

/**
 * 创建 Tool
 */
export async function createTool(request: ToolCreateRequest): Promise<Tool> {
  return post<Tool>('/api/v1/tools', request);
}

/**
 * 更新 Tool
 */
export async function updateTool(
  toolId: string,
  request: ToolUpdateRequest
): Promise<Tool> {
  return put<Tool>(`/api/v1/tools/${toolId}`, request);
}

/**
 * 删除 Tool
 */
export async function deleteTool(toolId: string): Promise<void> {
  return del<void>(`/api/v1/tools/${toolId}`);
}

// ============================================
// MCP v2 API 函数（v2 新增）
// ============================================

/**
 * 获取当前用户的所有 MCP v2 实例
 */
export async function getMcpV2Instances(
  skip = 0,
  limit = 100
): Promise<McpV2Instance[]> {
  return get<McpV2Instance[]>(`/api/v1/mcp/list?skip=${skip}&limit=${limit}`);
}

/**
 * 获取单个 MCP v2 实例
 */
export async function getMcpV2Instance(apiKey: string): Promise<McpV2Instance> {
  return get<McpV2Instance>(`/api/v1/mcp/${apiKey}`);
}

/**
 * 创建 MCP v2 实例（不带绑定）
 */
export async function createMcpV2(
  request: McpV2CreateRequest
): Promise<McpV2Instance> {
  return post<McpV2Instance>('/api/v1/mcp', request);
}

/**
 * Legacy MCP 创建请求（兼容 v1 API）
 */
export interface McpLegacyCreateRequest {
  name: string;
  project_id: string;
  table_id: string;
  json_pointer?: string;
  tools_definition?: Record<string, unknown>;
  register_tools?: string[];
}

/**
 * Legacy MCP 创建响应
 */
export interface McpLegacyCreateResponse {
  api_key: string;
  url: string;
  proxy_url: string;
  direct_url: string;
}

/**
 * 创建 MCP 实例（Legacy API - 需要 project_id 和 table_id）
 * 返回的格式会被转换为 McpV2Instance 兼容格式
 */
export async function createMcpLegacy(
  request: McpLegacyCreateRequest
): Promise<McpV2Instance> {
  const response = await post<McpLegacyCreateResponse>('/api/v1/mcp', request);
  // 转换为 McpV2Instance 格式
  return {
    id: 0, // Legacy API 不返回 id
    user_id: '',
    api_key: response.api_key,
    name: request.name,
    status: true, // 新创建的实例默认是启用的
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 创建 MCP v2 实例并绑定 Tool（推荐使用）
 */
export async function createMcpV2WithBindings(
  request: McpV2CreateWithBindingsRequest
): Promise<McpV2CreateWithBindingsResponse> {
  return post<McpV2CreateWithBindingsResponse>(
    '/api/v1/mcp/with_bindings',
    request
  );
}

/**
 * 更新 MCP v2 实例
 */
export async function updateMcpV2(
  apiKey: string,
  request: McpV2UpdateRequest
): Promise<McpV2Instance> {
  return put<McpV2Instance>(`/api/v1/mcp/${apiKey}`, request);
}

/**
 * 删除 MCP v2 实例
 */
export async function deleteMcpV2(apiKey: string): Promise<void> {
  return del<void>(`/api/v1/mcp/${apiKey}`);
}

// ============================================
// Binding API 函数（v2 新增）
// ============================================

/**
 * 批量绑定 Tool 到 MCP v2
 */
export async function createBindings(
  apiKey: string,
  bindings: BindingRequest[]
): Promise<void> {
  return post<void>(`/api/v1/mcp/${apiKey}/bindings`, { bindings });
}

/**
 * 更新绑定状态（启用/禁用 Tool）
 */
export async function updateBinding(
  apiKey: string,
  toolId: number,
  status: boolean
): Promise<void> {
  return put<void>(`/api/v1/mcp/${apiKey}/bindings/${toolId}`, { status });
}

/**
 * 解绑 Tool
 */
export async function deleteBinding(
  apiKey: string,
  toolId: string
): Promise<void> {
  return del<void>(`/api/v1/mcp/${apiKey}/bindings/${toolId}`);
}

/**
 * 获取 MCP v2 实例绑定的所有 Tool
 * 使用 GET /api/v1/mcp/{api_key}/tools 端点
 */
export async function getBoundTools(
  apiKey: string,
  includeDisabled = false
): Promise<BoundTool[]> {
  const params = includeDisabled ? '?include_disabled=true' : '';
  return get<BoundTool[]>(`/api/v1/mcp/${apiKey}/tools${params}`);
}

// ============================================
// 工具函数
// ============================================

/**
 * 将前端权限配置转换为后端 register_tools 格式
 * NOTE: shell_access 由 agent_bash 表管理，不在这里
 */
export function permissionsToRegisterTools(
  permissions: McpToolPermissions
): McpToolType[] {
  const tools: McpToolType[] = [];
  if (permissions.get_data_schema) tools.push('get_data_schema');
  if (permissions.get_all_data) tools.push('get_all_data');
  if (permissions.query_data) tools.push('query_data');
  if (permissions.search) tools.push('search');
  if (permissions.preview) tools.push('preview');
  if (permissions.select) tools.push('select');
  if (permissions.create) tools.push('create');
  if (permissions.update) tools.push('update');
  if (permissions.delete) tools.push('delete');
  return tools;
}

/**
 * 将后端 register_tools 转换为前端权限配置
 * NOTE: shell_access 由 agent_bash 表管理，不在这里
 */
export function registerToolsToPermissions(
  tools: McpToolType[] | null
): McpToolPermissions {
  if (!tools) return {};
  return {
    get_data_schema: tools.includes('get_data_schema'),
    get_all_data: tools.includes('get_all_data'),
    query_data: tools.includes('query_data'),
    search: tools.includes('search'),
    preview: tools.includes('preview'),
    select: tools.includes('select'),
    create: tools.includes('create'),
    update: tools.includes('update'),
    delete: tools.includes('delete'),
  };
}

/**
 * 工具类型的显示信息
 * NOTE: shell_access 由 agent_bash 表管理，不在 Tool 类型中
 * NOTE: query_data (JMESPath) is kept for advanced JSON queries but not primary UI
 */
export const TOOL_INFO: Record<
  McpToolType,
  { label: string; description: string; appliesTo: string[] }
> = {
  // Primary tool - works on ALL content types
  search: { 
    label: 'Search', 
    description: 'AI-powered search across content',
    appliesTo: ['folder', 'json', 'markdown'],
  },
  // Read tools
  get_data_schema: { 
    label: 'Get Schema', 
    description: 'Get data structure',
    appliesTo: ['json'],
  },
  get_all_data: { 
    label: 'Get Content', 
    description: 'Retrieve all content',
    appliesTo: ['folder', 'json', 'markdown', 'image'],
  },
  query_data: { 
    label: 'Query (JMESPath)', 
    description: 'Advanced JSON query',
    appliesTo: ['json'],
  },
  preview: { 
    label: 'Preview', 
    description: 'Lightweight data preview',
    appliesTo: ['json'],
  },
  select: { 
    label: 'Select', 
    description: 'Batch select data items',
    appliesTo: ['json'],
  },
  // Write tools
  create: { 
    label: 'Add Element', 
    description: 'Add new element to data',
    appliesTo: ['json'],  // folder support coming soon
  },
  update: { 
    label: 'Edit Data', 
    description: 'Edit existing content',
    appliesTo: ['json', 'markdown'],
  },
  delete: { 
    label: 'Remove Element', 
    description: 'Remove element from data',
    appliesTo: ['json'],  // folder support coming soon
  },
  // Custom
  custom_script: {
    label: 'Custom Script',
    description: 'Custom tool with Python/JavaScript/Shell',
    appliesTo: ['folder', 'json', 'markdown', 'image'],
  },
};

// ============================================
// v2 便捷函数
// ============================================

/**
 * 根据权限配置批量创建 Tool 并绑定到新 MCP
 * 这是一个高层封装，简化创建流程
 */
export async function createToolsAndMcp(params: {
  nodeId: string;  // 改为 nodeId
  jsonPath?: string;
  permissions: McpToolPermissions;
  toolNamePrefix?: string;
  mcpName?: string;
  customDefinitions?: Record<McpToolType, McpToolDefinition>;
}): Promise<McpV2CreateWithBindingsResponse> {
  const {
    nodeId,
    jsonPath = '',
    permissions,
    toolNamePrefix = '',
    mcpName,
    customDefinitions,
  } = params;

  // 1. 根据权限获取需要创建的工具类型
  const toolTypes = permissionsToRegisterTools(permissions);

  if (toolTypes.length === 0) {
    throw new Error('至少需要选择一个工具权限');
  }

  // 2. 批量创建 Tool
  const createdTools = await Promise.all(
    toolTypes.map(type => {
      const customDef = customDefinitions?.[type];
      return createTool({
        node_id: nodeId,
        json_path: jsonPath,
        type: type,
        name: customDef?.name || `${toolNamePrefix}${type}`,
        description: customDef?.description || TOOL_INFO[type].description,
      });
    })
  );

  // 3. 创建 MCP 并绑定
  return createMcpV2WithBindings({
    name: mcpName,
    bindings: createdTools.map(t => ({ tool_id: t.id, status: true })),
  });
}

/**
 * 生成 MCP Server URL
 */
export function getMcpServerUrl(apiKey: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return `${baseUrl}/api/v1/mcp/server/${apiKey}`;
}
