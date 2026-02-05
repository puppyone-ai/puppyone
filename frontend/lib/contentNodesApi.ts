/**
 * Content Nodes API Client
 *
 * 用于与后端 /api/v1/nodes 端点交互
 * 支持嵌套文件夹结构
 */

import { apiRequest } from './apiClient';

// === Types ===

// 存储类型（新类型系统）
export type StorageType = 'folder' | 'json' | 'file' | 'sync';

// 同步来源（仅 sync 类型有值）
export type SyncSource = 
  | 'github' 
  | 'notion' 
  | 'gmail' 
  | 'google_sheets' 
  | 'google_calendar' 
  | 'google_docs' 
  | 'google_drive' 
  | 'airtable' 
  | 'linear' 
  | 'slack'
  | string; // 允许未来扩展

// 资源类型（仅 sync 类型有值）
export type ResourceType = 
  | 'repo' | 'issue' | 'file'  // GitHub
  | 'database' | 'page'         // Notion
  | 'inbox'                     // Gmail
  | 'sync'                      // Google services
  | 'base' | 'table'            // Airtable
  | 'project'                   // Linear
  | string;

// 旧节点类型（兼容）
export type LegacyNodeType = 
  | 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file' | 'pending'
  | 'github_repo' | 'github_issue' | 'notion_database' | 'notion_page'
  | 'gmail_inbox' | 'google_sheets_sync' | 'google_calendar_sync'
  | string;

// 同步状态
export type SyncStatus = 'not_connected' | 'idle' | 'syncing' | 'error';

export interface NodeInfo {
  id: string;
  name: string;
  project_id: string;
  id_path: string;
  parent_id: string | null;
  
  // 新类型系统
  storage_type: StorageType;
  source: SyncSource | null;       // 仅 sync 类型
  resource_type: ResourceType | null;  // 仅 sync 类型
  
  // 旧字段（兼容）
  type: LegacyNodeType;
  
  mime_type: string | null;
  size_bytes: number;
  
  // 同步相关字段
  sync_url: string | null;
  sync_id: string | null;
  sync_status: SyncStatus;
  sync_config: {
    mode?: 'manual' | 'auto';
    interval?: string;
    account?: string;
    last_error?: string;
    [key: string]: any;
  } | null;
  last_synced_at: string | null;
  
  // 计算属性
  is_synced: boolean;
  sync_source: SyncSource | null;  // 等同于 source
  
  created_at: string;
  updated_at: string;
}

export interface NodeDetail extends NodeInfo {
  content: any | null; // For JSON nodes
  s3_key: string | null;
  permissions: {
    public: boolean;
    inherit: boolean;
    agents: string[];
    users: string[];
  };
}

export interface NodeListResponse {
  nodes: NodeInfo[];
  total: number;
}

export interface UploadUrlResponse {
  node_id: string;
  upload_url: string;
  s3_key: string;
}

export interface DownloadUrlResponse {
  download_url: string;
  expires_in: number;
}

// === Helper Functions ===

/**
 * 判断节点是否为文件夹
 */
export function isFolder(node: NodeInfo): boolean {
  return node.storage_type === 'folder';
}

/**
 * 判断节点是否为 JSON 类型
 */
export function isJson(node: NodeInfo): boolean {
  return node.storage_type === 'json';
}

/**
 * 判断节点是否为文件类型
 */
export function isFile(node: NodeInfo): boolean {
  return node.storage_type === 'file';
}

/**
 * 判断节点是否为同步类型
 */
export function isSynced(node: NodeInfo): boolean {
  return node.storage_type === 'sync';
}

/**
 * 判断节点是否为 Markdown（本地或同步）
 */
export function isMarkdown(node: NodeInfo): boolean {
  return node.mime_type === 'text/markdown';
}

/**
 * 判断节点是否可索引（用于搜索）
 */
export function isIndexable(node: NodeInfo): boolean {
  if (node.storage_type === 'json') return true;
  if (node.mime_type === 'text/markdown') return true;
  return false;
}

// === API Functions ===

/**
 * 列出指定项目中父节点下的所有子节点
 * @param projectId 项目 ID
 * @param parentId 父节点 ID，null 表示列出项目根节点
 */
export async function listNodes(
  projectId: string,
  parentId?: string | null
): Promise<NodeListResponse> {
  const params = new URLSearchParams({ project_id: projectId });
  if (parentId) {
    params.set('parent_id', parentId);
  }
  return apiRequest<NodeListResponse>(`/api/v1/nodes/?${params.toString()}`);
}

/**
 * 获取节点详情
 */
export async function getNode(nodeId: string): Promise<NodeDetail> {
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}`);
}

/**
 * 按 id_path 获取节点
 */
export async function getNodeByIdPath(
  projectId: string,
  idPath: string
): Promise<NodeDetail> {
  const params = new URLSearchParams({
    project_id: projectId,
    id_path: idPath,
  });
  return apiRequest<NodeDetail>(
    `/api/v1/nodes/by-id-path/?${params.toString()}`
  );
}

/**
 * 创建文件夹
 */
export async function createFolder(
  name: string,
  projectId: string,
  parentId?: string | null
): Promise<NodeDetail> {
  const body: { name: string; project_id: string; parent_id?: string | null } =
    {
      name,
      project_id: projectId,
    };
  if (parentId) {
    body.parent_id = parentId;
  }

  return apiRequest<NodeDetail>('/api/v1/nodes/folder', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * 创建 JSON 节点
 */
export async function createJsonNode(
  name: string,
  projectId: string,
  content: any,
  parentId?: string | null
): Promise<NodeDetail> {
  const body: {
    name: string;
    project_id: string;
    content: any;
    parent_id?: string | null;
  } = {
    name,
    project_id: projectId,
    content,
  };
  if (parentId) {
    body.parent_id = parentId;
  }

  return apiRequest<NodeDetail>('/api/v1/nodes/json', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * 创建 Markdown 节点
 */
export async function createMarkdownNode(
  name: string,
  projectId: string,
  content: string = '',
  parentId?: string | null
): Promise<NodeDetail> {
  const body: { name: string; project_id: string; content: string; parent_id?: string | null } = {
    name,
    project_id: projectId,
    content,
  };
  if (parentId) {
    body.parent_id = parentId;
  }

  return apiRequest<NodeDetail>('/api/v1/nodes/markdown', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * 准备文件上传（获取预签名 URL）
 */
export async function prepareUpload(
  name: string,
  projectId: string,
  contentType: string,
  parentId?: string | null
): Promise<UploadUrlResponse> {
  const params = new URLSearchParams({
    name,
    project_id: projectId,
    content_type: contentType,
  });
  if (parentId) {
    params.set('parent_id', parentId);
  }

  return apiRequest<UploadUrlResponse>(
    `/api/v1/nodes/upload?${params.toString()}`,
    {
      method: 'POST',
    }
  );
}

/**
 * 更新节点
 */
export async function updateNode(
  nodeId: string,
  updates: { name?: string; content?: any }
): Promise<NodeDetail> {
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * 移动节点
 */
export async function moveNode(
  nodeId: string,
  newParentId: string | null
): Promise<NodeDetail> {
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}/move`, {
    method: 'POST',
    body: JSON.stringify({ new_parent_id: newParentId }),
  });
}

/**
 * 删除节点
 */
export async function deleteNode(nodeId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

/**
 * 获取下载 URL
 */
export async function getDownloadUrl(
  nodeId: string
): Promise<DownloadUrlResponse> {
  return apiRequest<DownloadUrlResponse>(`/api/v1/nodes/${nodeId}/download`);
}

// === 批量创建 API ===

export interface BulkCreateNodeItem {
  temp_id: string;
  name: string;
  type: 'folder' | 'json' | 'file';  // 现在使用 storage_type
  parent_temp_id: string | null;
  content?: any;  // file 类型时为 markdown 字符串，json 类型时为 dict
}

export interface BulkCreateResultItem {
  temp_id: string;
  node_id: string;
  name: string;
  type: StorageType;
}

export interface BulkCreateResponse {
  created: BulkCreateResultItem[];
  total: number;
}

/**
 * 批量创建节点（用于文件夹上传）
 * 
 * @param projectId 项目 ID
 * @param nodes 节点列表，每个包含 temp_id, name, type(storage_type), parent_temp_id, content
 * @param parentId 整体挂载到哪个父节点下，null 表示项目根目录
 */
export async function bulkCreateNodes(
  projectId: string,
  nodes: BulkCreateNodeItem[],
  parentId?: string | null
): Promise<BulkCreateResponse> {
  const body: {
    project_id: string;
    nodes: BulkCreateNodeItem[];
    parent_id?: string | null;
  } = {
    project_id: projectId,
    nodes,
  };
  if (parentId) {
    body.parent_id = parentId;
  }

  return apiRequest<BulkCreateResponse>('/api/v1/nodes/bulk-create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
