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
  nodes: NodeInfo[];  // 从 tables 改为 nodes
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
  rows: number;
  data: any; // 任意 JSON 数据（对象、数组、字符串、数字等）
};

// 项目相关API
export async function getProjects(): Promise<ProjectInfo[]> {
  return apiRequest<ProjectInfo[]>('/api/v1/projects/');
}

export async function getProject(projectId: string): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`);
}

export async function createProject(
  name: string,
  description?: string
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>('/api/v1/projects/', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
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
  // 调用 content nodes API 获取节点详情
  // apiRequest 已经自动提取了 response.data，所以这里直接是 node 对象
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    id_path: string;
    parent_id: string | null;
    content: any;
    s3_key: string | null;
    permissions: any;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}`);

  // 转换后端格式到前端期望的格式
  const data = node.content;
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

export async function createTable(
  projectId: string | null,
  name: string,
  data?: Record<string, any> | Array<Record<string, any>>,
  parentId?: string | null
): Promise<TableData> {
  if (!projectId) {
    throw new Error('projectId is required for creating JSON node');
  }

  // 使用 content nodes API 创建 JSON 节点
  const body: Record<string, any> = {
    name,
    project_id: projectId,
    content: data ?? {},
  };
  if (parentId) {
    body.parent_id = parentId;
  }

  // apiRequest 已经自动提取了 response.data
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content: any;
    created_at: string;
    updated_at: string;
  }>('/api/v1/nodes/json', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const nodeContent = node.content;
  let rows = 0;
  if (nodeContent != null) {
    if (Array.isArray(nodeContent)) {
      rows = nodeContent.length;
    } else if (typeof nodeContent === 'object') {
      rows = Object.keys(nodeContent).length;
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    rows,
    data: nodeContent ?? null,
  };
}

export async function updateTable(
  projectId: string,
  nodeId: string,
  name?: string
): Promise<TableData> {
  // 使用 content nodes API 更新节点名称
  // apiRequest 已经自动提取了 response.data
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content: any;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });

  const data = node.content;
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
  return apiRequest<void>(`/api/v1/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

export async function updateTableData(
  projectId: string,
  nodeId: string,
  data: any // 任意 JSON 数据
): Promise<TableData> {
  // 使用 PUT /nodes/{id} 更新内容
  // apiRequest 已经自动提取了 response.data
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    content: any;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}`, {
    method: 'PUT',
    body: JSON.stringify({ content: data }),
  });

  const nodeContent = node.content;
  let rows = 0;
  if (nodeContent != null) {
    if (Array.isArray(nodeContent)) {
      rows = nodeContent.length;
    } else if (typeof nodeContent === 'object') {
      rows = Object.keys(nodeContent).length;
    }
  }

  return {
    id: node.id,
    name: node.name || '',
    rows,
    data: nodeContent ?? null,
  };
}

// 获取用户的裸 Table（不属于任何 Project）
// 注意：在新架构中，所有节点都属于某个 Project，不存在 orphan tables
export async function getOrphanTables(): Promise<TableInfo[]> {
  // 返回空数组，因为新架构不支持 orphan tables
  return [];
}
