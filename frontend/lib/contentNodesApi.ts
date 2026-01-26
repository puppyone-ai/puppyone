/**
 * Content Nodes API Client
 *
 * 用于与后端 /api/v1/nodes 端点交互
 * 支持嵌套文件夹结构
 */

import { apiRequest } from './apiClient';

// === Types ===

export interface NodeInfo {
  id: string;
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file';
  project_id: string;
  id_path: string;
  parent_id: string | null;
  mime_type: string | null;
  size_bytes: number;
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
  return apiRequest<NodeDetail>(`/api/v1/nodes/by-id-path/?${params.toString()}`);
}

/**
 * 创建文件夹
 */
export async function createFolder(
  name: string,
  projectId: string,
  parentId?: string | null
): Promise<NodeDetail> {
  const body: { name: string; project_id: string; parent_id?: string | null } = {
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
  const body: { name: string; project_id: string; content: any; parent_id?: string | null } = {
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
