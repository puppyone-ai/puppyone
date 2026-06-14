/**
 * Tool API 客户端
 * 管理 Tool 实体（绑定到数据节点的可调用能力）的增删改查 + 搜索索引构建。
 *
 * Tool：绑定到数据路径的能力，type ∈ get_data_schema / get_all_data / query_data /
 * search / create / update / delete / preview / select / custom_script。
 * 被项目级 Toolkit 与 chat runtime 使用。
 *
 * 注：旧的 MCP 实例 / 绑定 API（/api/v1/mcp/*）已退役 —— MCP endpoint 现由项目级
 * Access 页（mcpEndpointsApi + /api/v1/mcp-endpoints）管理。
 */

import { get, post, put, del } from './apiClient';

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

// ============================================
// Tool 类型定义
// ============================================

/**
 * Tool 实体 - 独立的工具定义
 */
export interface Tool {
  id: string;
  user_id: string;
  created_at: string;

  path: string | null;  // 绑定的节点路径
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
  path?: string | null;  // 绑定的节点路径
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
  path?: string | null;
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
// Search Index 类型定义
// ============================================

export interface SearchIndexTask {
  tool_id: string;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  started_at: string | null;
  finished_at: string | null;
  nodes_count: number | null;
  chunks_count: number | null;
  indexed_chunks_count: number | null;
  folder_path?: string | null;
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

// ============================================
// Tool API 函数
// ============================================

/**
 * 获取当前用户的所有 Tool
 */
export async function getTools(skip = 0, limit = 100): Promise<Tool[]> {
  return get<Tool[]>(`/api/v1/tools/?skip=${skip}&limit=${limit}`);
}

/**
 * 获取指定路径的所有 Tool
 */
export async function getToolsByPath(
  path: string,
  skip = 0,
  limit = 1000
): Promise<Tool[]> {
  return get<Tool[]>(
    `/api/v1/tools/by-path/${path}?skip=${skip}&limit=${limit}`
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
  return post<Tool>('/api/v1/tools/', request);
}

/**
 * 创建 Search Tool（异步索引版本）
 * 
 * 与 createTool 不同，此函数会触发后台异步索引构建（Chunking + Embedding + Upsert）。
 * 索引状态通过 getSearchIndexStatus() 轮询获取。
 */
export async function createSearchTool(request: ToolCreateRequest): Promise<Tool> {
  return post<Tool>('/api/v1/tools/search', request);
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

