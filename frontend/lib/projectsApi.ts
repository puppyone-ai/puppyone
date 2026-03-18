/**
 * Projects API 客户端
 */

import { apiRequest } from './apiClient';

export type NodeInfo = {
  id: string;
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file';
  rows?: number;
};

export type ProjectInfo = {
  id: string;
  name: string;
  description?: string;
  visibility?: 'org' | 'private';
  nodes: NodeInfo[];
};

// 保留 TableInfo 用于兼容性
export type TableInfo = {
  id: string;
  name: string;
  rows?: number;
};

export type TableData = {
  id: string;
  name: string;
  type?: string;
  rows: number;
  data: any; // 任意 JSON 数据（对象、数组、字符串、数字等）
  content?: any; // 原始 content 字段（用于 github_repo 等特殊类型）
  sync_url?: string | null; // 同步 URL
};

// 项目相关API
export async function getProjects(orgId?: string): Promise<ProjectInfo[]> {
  const params = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
  return apiRequest<ProjectInfo[]>(`/api/v1/projects/${params}`);
}

export async function getProject(projectId: string): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`);
}

export async function createProject(
  name: string,
  description?: string,
  orgId?: string,
  seed?: boolean
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>('/api/v1/projects/', {
    method: 'POST',
    body: JSON.stringify({ name, description, org_id: orgId, seed: seed ?? false }),
  });
}

export async function updateProject(
  projectId: string,
  name?: string,
  description?: string
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  });
}

// 表/节点相关API - 使用 /api/v1/nodes/ 路径（从 content_nodes 获取）
export async function getTable(
  projectId: string,
  nodeId: string
): Promise<TableData> {
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    id_path: string;
    parent_id: string | null;
    content_hash: string | null;
    s3_key: string | null;
    permissions: any;
    sync_url: string | null;
    sync_id: string | null;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`);

  const nonJsonTypes = ['markdown', 'image', 'pdf', 'video', 'file'];
  const isNonJsonType = nonJsonTypes.some(t => node.type.includes(t));

  let data: any = null;

  if (!isNonJsonType) {
    const { getNodeContent } = await import('@/lib/contentNodesApi');
    const content = await getNodeContent(nodeId, projectId);
    data = content.content_json;
  }

  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      const importedData = data.imported_data;
      if (Array.isArray(importedData)) {
        rows = importedData.length;
      } else {
        rows = Object.keys(data).length;
      }
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    type: node.type,
    rows,
    data: data ?? null,
    content: data,
    sync_url: node.sync_url,
  };
}

export async function createTable(
  projectId: string | null,
  name: string,
  data?: Record<string, any> | Array<Record<string, any>>,
  parentId?: string | null
): Promise<TableData> {
  if (!projectId) {
    throw new Error('projectId is required for creating JSON node');
  }

  const body: Record<string, any> = {
    name,
    project_id: projectId,
    content: data ?? {},
  };
  if (parentId) {
    body.parent_id = parentId;
  }

  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content_hash: string | null;
    created_at: string;
    updated_at: string;
  }>('/api/v1/nodes/json', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const inputData = data ?? {};
  let rows = 0;
  if (inputData != null) {
    if (Array.isArray(inputData)) {
      rows = inputData.length;
    } else if (typeof inputData === 'object') {
      rows = Object.keys(inputData).length;
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    rows,
    data: inputData,
  };
}

export async function updateTable(
  projectId: string,
  nodeId: string,
  name?: string
): Promise<TableData> {
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content_hash: string | null;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });

  const { getNodeContent } = await import('@/lib/contentNodesApi');
  const content = await getNodeContent(nodeId, projectId);
  const data = content.content_json;
  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    rows,
    data: data ?? null,
  };
}

export async function deleteTable(
  projectId: string,
  nodeId: string
): Promise<void> {
  // 使用 content nodes API 删除节点
  return apiRequest<void>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}

export async function updateTableData(
  projectId: string,
  nodeId: string,
  data: any
): Promise<TableData> {
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content_hash: string | null;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ content_json: data }),
  });

  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    rows,
    data: data ?? null,
  };
}

// 获取用户的裸 Table（不属于任何 Project）
// 注意：在新架构中，所有节点都属于某个 Project，不存在 orphan tables
export async function getOrphanTables(): Promise<TableInfo[]> {
  return [];
}

// ── Project Members ──

export type ProjectMember = {
  id: string;
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
};

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return apiRequest<ProjectMember[]>(`/api/v1/projects/${projectId}/members`);
}

export async function addProjectMember(projectId: string, userId: string, role: string = 'editor'): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role }),
  });
}

export async function updateProjectMemberRole(projectId: string, userId: string, role: string): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}/members/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export async function updateProjectVisibility(projectId: string, visibility: 'org' | 'private'): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  });
}
