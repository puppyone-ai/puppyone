import { get, post, put, del } from './apiClient';

export interface SandboxMountPermissions {
  read: boolean;
  write: boolean;
  exec: boolean;
}

export interface SandboxMount {
  node_id: string;
  mount_path: string;
  permissions: SandboxMountPermissions;
}

export interface SandboxResourceLimits {
  memory_mb: number;
  cpu_shares: number;
}

export interface SandboxEndpoint {
  id: string;
  project_id: string;
  node_id: string | null;
  name: string;
  description: string | null;
  access_key: string;
  mounts: SandboxMount[];
  runtime: 'alpine' | 'python' | 'node';
  timeout_seconds: number;
  resource_limits: SandboxResourceLimits;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listSandboxEndpoints(projectId: string): Promise<SandboxEndpoint[]> {
  return get<SandboxEndpoint[]>(`/api/v1/sandbox-endpoints?project_id=${projectId}`);
}

export async function getSandboxEndpoint(id: string): Promise<SandboxEndpoint> {
  return get<SandboxEndpoint>(`/api/v1/sandbox-endpoints/${id}`);
}

export async function getSandboxEndpointByNode(nodeId: string): Promise<SandboxEndpoint | null> {
  try {
    return await get<SandboxEndpoint>(`/api/v1/sandbox-endpoints/by-node/${nodeId}`);
  } catch {
    return null;
  }
}

export async function createSandboxEndpoint(params: {
  project_id: string;
  name?: string;
  node_id?: string;
  description?: string;
  mounts?: { node_id: string; mount_path?: string; permissions?: Partial<SandboxMountPermissions> }[];
  runtime?: 'alpine' | 'python' | 'node';
  timeout_seconds?: number;
  resource_limits?: Partial<SandboxResourceLimits>;
}): Promise<SandboxEndpoint> {
  return post<SandboxEndpoint>('/api/v1/sandbox-endpoints', params);
}

export async function updateSandboxEndpoint(id: string, params: Partial<{
  name: string;
  description: string;
  node_id: string;
  status: string;
  mounts: { node_id: string; mount_path?: string; permissions?: Partial<SandboxMountPermissions> }[];
  runtime: 'alpine' | 'python' | 'node';
  timeout_seconds: number;
  resource_limits: Partial<SandboxResourceLimits>;
}>): Promise<SandboxEndpoint> {
  return put<SandboxEndpoint>(`/api/v1/sandbox-endpoints/${id}`, params);
}

export async function deleteSandboxEndpoint(id: string): Promise<void> {
  await del(`/api/v1/sandbox-endpoints/${id}`);
}

export async function regenerateSandboxEndpointKey(id: string): Promise<SandboxEndpoint> {
  return post<SandboxEndpoint>(`/api/v1/sandbox-endpoints/${id}/regenerate-key`, {});
}
