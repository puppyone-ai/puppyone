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
  /** Default git branch for new GitHub bindings & MUT clones. The
   *  backend defaults to ``'main'``; legacy projects may not have the
   *  field yet, hence optional on the wire. */
  bound_git_branch?: string;
  nodes: NodeInfo[];
  updated_at?: string;
  access_point_count?: number;
};

export interface UpdateProjectPayload {
  name?: string;
  description?: string;
  bound_git_branch?: string;
}

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
  seed?: boolean,
  template?: string
): Promise<ProjectInfo> {
  return apiRequest<ProjectInfo>('/api/v1/projects/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      org_id: orgId,
      seed: seed ?? false,
      template: template ?? null,
    }),
  });
}

export interface ProjectTemplatePreviewNode {
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'file';
}

export interface ProjectTemplateInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  preview?: ProjectTemplatePreviewNode[];
}

export async function getProjectTemplates(): Promise<ProjectTemplateInfo[]> {
  return apiRequest<ProjectTemplateInfo[]>('/api/v1/projects/templates/list');
}

export async function updateProject(
  projectId: string,
  payloadOrName?: UpdateProjectPayload | string,
  description?: string,
): Promise<ProjectInfo> {
  // Backwards-compat: legacy callers passed positional ``(name, description)``.
  // New callers pass a single ``{ name?, description?, bound_git_branch? }``
  // object so additional fields don't force an N-arg signature blow-up.
  const body: UpdateProjectPayload =
    typeof payloadOrName === 'object' && payloadOrName !== null
      ? payloadOrName
      : { name: payloadOrName, description };
  return apiRequest<ProjectInfo>(`/api/v1/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  });
}

// 表/节点相关API - 使用 Tree API (path-based)
export async function getTable(
  projectId: string,
  nodePath: string
): Promise<TableData> {
  const { stat, readFile } = await import('@/lib/contentTreeApi');
  const s = await stat(projectId, nodePath);

  const nonJsonTypes = ['markdown', 'image', 'pdf', 'video', 'file'];
  const isNonJsonType = nonJsonTypes.some(t => s.type.includes(t));

  let data: any = null;

  if (!isNonJsonType) {
    const content = await readFile(projectId, nodePath);
    data = content.content;
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
    id: nodePath,
    name: s.name || '',
    type: s.type,
    rows,
    data: data ?? null,
    content: data,
    sync_url: null,
  };
}

export async function createTable(
  projectId: string | null,
  name: string,
  data?: Record<string, any> | Array<Record<string, any>>,
  parentPath?: string | null
): Promise<TableData> {
  if (!projectId) {
    throw new Error('projectId is required for creating JSON node');
  }

  const { writeFile } = await import('@/lib/contentTreeApi');
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  await writeFile(projectId, fullPath, data ?? {}, 'json');

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
    id: fullPath,
    name: name || '',
    rows,
    data: inputData,
  };
}

export async function updateTable(
  projectId: string,
  nodePath: string,
  name?: string
): Promise<TableData> {
  const { moveFile, readFile } = await import('@/lib/contentTreeApi');

  let currentPath = nodePath;
  if (name) {
    const parentDir = nodePath.includes('/') ? nodePath.substring(0, nodePath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${name}` : name;
    await moveFile(projectId, nodePath, newPath);
    currentPath = newPath;
  }

  const content = await readFile(projectId, currentPath);
  const data = content.content;
  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: currentPath,
    name: name || currentPath.split('/').pop() || '',
    rows,
    data: data ?? null,
  };
}

export async function deleteTable(
  projectId: string,
  nodePath: string
): Promise<void> {
  const { removeFile } = await import('@/lib/contentTreeApi');
  await removeFile(projectId, nodePath);
}

export async function updateTableData(
  projectId: string,
  nodePath: string,
  data: any
): Promise<TableData> {
  const { writeFile } = await import('@/lib/contentTreeApi');
  await writeFile(projectId, nodePath, data, 'json');

  let rows = 0;
  if (data != null) {
    if (Array.isArray(data)) {
      rows = data.length;
    } else if (typeof data === 'object') {
      rows = Object.keys(data).length;
    }
  }

  return {
    id: nodePath,
    name: nodePath.split('/').pop() || '',
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
