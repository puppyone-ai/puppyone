/**
 * Content Nodes API Client
 *
 * 用于与后端 /api/v1/nodes 端点交互
 * 支持嵌套文件夹结构
 */

import { apiRequest } from './apiClient';

// === Types ===

// 节点类型（5种）
export type NodeType = 'folder' | 'json' | 'markdown' | 'file' | 'sync';

// 数据来源（仅 sync 类型有值）
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

// 预览类型
export type PreviewType = 'json' | 'markdown' | null;

// 同步状态
export type SyncStatus = 'not_connected' | 'idle' | 'syncing' | 'error';

export interface NodeInfo {
  id: string;
  name: string;
  project_id: string;
  id_path: string;
  parent_id: string | null;
  
  // 类型字段
  type: NodeType;              // folder | json | markdown | file | sync
  source: SyncSource | null;   // 仅 sync 类型有值
  preview_type: PreviewType;   // json | markdown | null
  
  mime_type: string | null;
  size_bytes: number;
  
  // 同步相关字段（仅 type=sync 时有值）
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
  is_synced: boolean;          // type === 'sync'
  sync_source: SyncSource | null;  // 等同于 source（仅 sync 时有值）
  
  created_at: string;
  updated_at: string;
}

export interface NodeDetail extends NodeInfo {
  json_content: any | null;    // type=json 或 sync 时的 JSON 内容
  md_content: string | null;   // type=markdown 时的 Markdown 内容
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
  return node.type === 'folder';
}

/**
 * 判断节点是否为 JSON 类型
 */
export function isJson(node: NodeInfo): boolean {
  return node.type === 'json';
}

/**
 * 判断节点是否为 Markdown 类型
 */
export function isMarkdown(node: NodeInfo): boolean {
  return node.type === 'markdown';
}

/**
 * 判断节点是否为文件类型
 */
export function isFile(node: NodeInfo): boolean {
  return node.type === 'file';
}

/**
 * 判断节点是否为同步类型
 */
export function isSynced(node: NodeInfo): boolean {
  return node.type === 'sync';
}

/**
 * 判断节点是否有预览内容
 */
export function hasPreview(node: NodeInfo): boolean {
  return node.preview_type !== null;
}

/**
 * 判断节点是否可索引（用于搜索）
 */
export function isIndexable(node: NodeInfo): boolean {
  return node.type === 'json' || node.type === 'markdown' || node.preview_type !== null;
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
 * @param nodeId 节点 ID
 * @param projectId 项目 ID（用于权限检查）
 */
export async function getNode(nodeId: string, projectId: string): Promise<NodeDetail> {
  const params = new URLSearchParams({ project_id: projectId });
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}?${params.toString()}`);
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
 * @param nodeId 节点 ID
 * @param projectId 项目 ID（用于权限检查）
 * @param updates 更新内容
 */
export async function updateNode(
  nodeId: string,
  projectId: string,
  updates: { name?: string; json_content?: any }
): Promise<NodeDetail> {
  const params = new URLSearchParams({ project_id: projectId });
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}?${params.toString()}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * 移动节点
 * @param nodeId 节点 ID
 * @param projectId 项目 ID（用于权限检查）
 * @param newParentId 新的父节点 ID
 */
export async function moveNode(
  nodeId: string,
  projectId: string,
  newParentId: string | null
): Promise<NodeDetail> {
  const params = new URLSearchParams({ project_id: projectId });
  return apiRequest<NodeDetail>(`/api/v1/nodes/${nodeId}/move?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ new_parent_id: newParentId }),
  });
}

/**
 * 删除节点
 * @param nodeId 节点 ID
 * @param projectId 项目 ID（用于权限检查）
 */
export async function deleteNode(nodeId: string, projectId: string): Promise<void> {
  const params = new URLSearchParams({ project_id: projectId });
  return apiRequest<void>(`/api/v1/nodes/${nodeId}?${params.toString()}`, {
    method: 'DELETE',
  });
}

/**
 * 获取下载 URL
 * @param nodeId 节点 ID
 * @param projectId 项目 ID（用于权限检查）
 */
export async function getDownloadUrl(
  nodeId: string,
  projectId: string
): Promise<DownloadUrlResponse> {
  const params = new URLSearchParams({ project_id: projectId });
  return apiRequest<DownloadUrlResponse>(`/api/v1/nodes/${nodeId}/download?${params.toString()}`);
}

// === 批量创建 API ===

export interface BulkCreateNodeItem {
  temp_id: string;
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'file';  // 节点类型
  parent_temp_id: string | null;
  content?: any;  // markdown 类型时为字符串，json 类型时为 dict
}

export interface BulkCreateResultItem {
  temp_id: string;
  node_id: string;
  name: string;
  type: NodeType;
}

export interface BulkCreateResponse {
  created: BulkCreateResultItem[];
  total: number;
}

/**
 * 批量创建节点（用于文件夹上传）
 * 
 * @param projectId 项目 ID
 * @param nodes 节点列表，每个包含 temp_id, name, type, parent_temp_id, content
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
