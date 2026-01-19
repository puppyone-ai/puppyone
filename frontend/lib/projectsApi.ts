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
    data: data ?? null,
  };
}

export async function createTable(
  projectId: string | null,
  name: string,
  data?: Record<string, any> | Array<Record<string, any>>
): Promise<TableData> {
  const body: Record<string, any> = {
    name,
    description: '',
    data: data ?? {},
  };
  // 只有 projectId 存在时才传
  if (projectId) {
    body.project_id = projectId;
  }

  const result = await apiRequest<{
    id: number;
    name: string | null;
    project_id: number | null;
    user_id: string | null;
    description: string | null;
    data: any;
    created_at: string;
  }>('/api/v1/tables/', {
    method: 'POST',
    body: JSON.stringify(body),
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
    data: tableData ?? null,
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
    data: data ?? null,
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
  data: any // 任意 JSON 数据
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
    data: tableData ?? null,
  };
}

// 获取用户的裸 Table（不属于任何 Project）
export async function getOrphanTables(): Promise<TableInfo[]> {
  const result = await apiRequest<
    Array<{
      id: number;
      name: string | null;
      project_id: number | null;
      user_id: string | null;
      description: string | null;
      data: any;
      created_at: string;
    }>
  >('/api/v1/tables/orphan');

  return result.map(item => ({
    id: String(item.id),
    name: item.name || '',
    rows: item.data
      ? Array.isArray(item.data)
        ? item.data.length
        : typeof item.data === 'object'
          ? Object.keys(item.data).length
          : 0
      : 0,
  }));
}
