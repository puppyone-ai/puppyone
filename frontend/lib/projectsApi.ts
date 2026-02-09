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
  nodes: NodeInfo[]; // 从 tables 改为 nodes
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
    preview_json: any;  // 已重命名: json_content -> preview_json
    s3_key: string | null;
    permissions: any;
    sync_url: string | null;
    sync_id: string | null;
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`);

  // 获取数据：优先从 preview_json 字段，否则从 S3 下载
  let data = node.preview_json;
  
  // 判断是否为非 JSON 类型（如 markdown），这些类型的内容不应通过 getTable 加载
  const nonJsonTypes = ['markdown', 'image', 'pdf', 'video', 'file'];
  const isNonJsonType = nonJsonTypes.some(t => node.type.includes(t));
  
  // 如果 content 为空但有 s3_key，从 S3 下载（仅对 JSON 类型）
  if (data == null && node.s3_key && !isNonJsonType) {
    try {
      const { download_url } = await apiRequest<{ download_url: string }>(
        `/api/v1/nodes/${nodeId}/download?project_id=${encodeURIComponent(projectId)}`
      );
      const response = await fetch(download_url);
      if (response.ok) {
        data = await response.json();
      }
    } catch (err) {
      console.error('Failed to load data from S3:', err);
    }
  }

  // 计算行数
  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      // 对于 Notion database，数据格式是 { imported_data: [...] }
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
    content: node.preview_json,  // 原始内容字段 (preview_json)
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

  // 使用 content nodes API 创建 JSON 节点
  // 注意: 请求参数仍使用 content，但响应返回 preview_json
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
    preview_json: any;  // 已重命名: content -> preview_json
    created_at: string;
    updated_at: string;
  }>('/api/v1/nodes/json', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const nodeContent = node.preview_json;
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
    preview_json: any;  // 已重命名: content -> preview_json
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });

  const data = node.preview_json;
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
  data: any // 任意 JSON 数据
): Promise<TableData> {
  // 使用 PUT /nodes/{id} 更新内容
  // apiRequest 已经自动提取了 response.data
  const node = await apiRequest<{
    id: string;
    name: string;
    type: string;
    project_id: string;
    preview_json: any;  // 已重命名: content -> preview_json
    created_at: string;
    updated_at: string;
  }>(`/api/v1/nodes/${nodeId}?project_id=${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ preview_json: data }),  // 已重命名: content -> preview_json
  });

  const nodeContent = node.preview_json;
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
