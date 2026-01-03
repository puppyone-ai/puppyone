/**
 * Projects API 客户端
 */

import { apiRequest } from './apiClient';

export type ProjectInfo = {
  id: string;
  name: string;
  description?: string;
  tables: TableInfo[];
};

export type TableInfo = {
  id: string;
  name: string;
  rows?: number;
};

export type TableData = {
  id: string;
  name: string;
  rows: number;
  data: Array<Record<string, any>>;
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

// 表相关API - 使用独立的 /api/v1/tables/ 路径
export async function getTable(
  projectId: string,
  tableId: string
): Promise<TableData> {
  // projectId 参数保留以兼容调用方，但实际只用 tableId
  const result = await apiRequest<{
    id: number;
    name: string | null;
    project_id: number | null;
    description: string | null;
    data: any;
    created_at: string;
  }>(`/api/v1/tables/${tableId}`);

  // 转换后端格式到前端期望的格式
  const data = result.data;
  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: String(result.id),
    name: result.name || '',
    rows,
    data: data ?? [],
  };
}

export async function createTable(
  projectId: string,
  name: string,
  data?: Record<string, any> | Array<Record<string, any>>
): Promise<TableData> {
  const result = await apiRequest<{
    id: number;
    name: string | null;
    project_id: number | null;
    description: string | null;
    data: any;
    created_at: string;
  }>('/api/v1/tables/', {
    method: 'POST',
    body: JSON.stringify({
      project_id: Number(projectId),
      name,
      description: '',
      data: data ?? {},
    }),
  });

  const tableData = result.data;
  let rows = 0;
  if (tableData != null) {
    if (Array.isArray(tableData)) {
      rows = tableData.length;
    } else if (typeof tableData === 'object') {
      rows = Object.keys(tableData).length;
    }
  }

  return {
    id: String(result.id),
    name: result.name || '',
    rows,
    data: tableData ?? [],
  };
}

export async function updateTable(
  projectId: string,
  tableId: string,
  name?: string
): Promise<TableData> {
  // projectId 参数保留以兼容调用方
  const result = await apiRequest<{
    id: number;
    name: string | null;
    project_id: number | null;
    description: string | null;
    data: any;
    created_at: string;
  }>(`/api/v1/tables/${tableId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });

  const data = result.data;
  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: String(result.id),
    name: result.name || '',
    rows,
    data: data ?? [],
  };
}

export async function deleteTable(
  projectId: string,
  tableId: string
): Promise<void> {
  // projectId 参数保留以兼容调用方
  return apiRequest<void>(`/api/v1/tables/${tableId}`, {
    method: 'DELETE',
  });
}

export async function updateTableData(
  projectId: string,
  tableId: string,
  data: Array<Record<string, any>>
): Promise<TableData> {
  // projectId 参数保留以兼容调用方
  // 使用 PUT /tables/{id} 更新整个 data 字段
  const result = await apiRequest<{
    id: number;
    name: string | null;
    project_id: number | null;
    description: string | null;
    data: any;
    created_at: string;
  }>(`/api/v1/tables/${tableId}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  });

  const tableData = result.data;
  let rows = 0;
  if (tableData != null) {
    if (Array.isArray(tableData)) {
      rows = tableData.length;
    } else if (typeof tableData === 'object') {
      rows = Object.keys(tableData).length;
    }
  }

  return {
    id: String(result.id),
    name: result.name || '',
    rows,
    data: tableData ?? [],
  };
}
