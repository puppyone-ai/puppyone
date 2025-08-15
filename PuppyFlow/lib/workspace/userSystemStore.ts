import { IWorkspaceStore, WorkspaceBasic } from './store';
import { SERVER_ENV } from '@/lib/serverEnv';

function authHeaders(authHeader?: string): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  if (SERVER_ENV.SERVICE_KEY) headers['X-Service-Key'] = SERVER_ENV.SERVICE_KEY;
  return headers;
}

export class UserSystemWorkspaceStore implements IWorkspaceStore {
  private base = SERVER_ENV.USER_SYSTEM_BACKEND.replace(/\/$/, '');

  async listWorkspaces(userId: string, opts?: { authHeader?: string }): Promise<WorkspaceBasic[]> {
    const res = await fetch(`${this.base}/get_user_workspaces/${userId}`, {
      method: 'GET',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`listWorkspaces failed: ${res.status}`);
    const json = await res.json();
    return (json.workspaces || []) as WorkspaceBasic[];
  }

  async createWorkspace(
    userId: string,
    payload: { workspace_id: string; workspace_name: string },
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic> {
    const res = await fetch(`${this.base}/create_workspace/${userId}`, {
      method: 'POST',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`createWorkspace failed: ${res.status}`);
    const json = await res.json();
    return { workspace_id: json.workspace_id, workspace_name: json.workspace_name };
  }

  async deleteWorkspace(workspaceId: string, opts?: { authHeader?: string }): Promise<void> {
    const res = await fetch(`${this.base}/delete_workspace/${workspaceId}`, {
      method: 'DELETE',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`deleteWorkspace failed: ${res.status}`);
  }

  async renameWorkspace(
    workspaceId: string,
    newName: string,
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic> {
    const res = await fetch(`${this.base}/update_workspace_name/${workspaceId}`, {
      method: 'PUT',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify({ new_name: newName }),
    });
    if (!res.ok) throw new Error(`renameWorkspace failed: ${res.status}`);
    const json = await res.json();
    return { workspace_id: json.workspace_id, workspace_name: json.workspace_name };
  }

  async getLatestHistory(workspaceId: string, opts?: { authHeader?: string }): Promise<any | null> {
    const res = await fetch(`${this.base}/get_latest_workspace_history/${workspaceId}`, {
      method: 'GET',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`getLatestHistory failed: ${res.status}`);
    const json = await res.json();
    return json.history ?? null;
  }

  async addHistory(
    workspaceId: string,
    data: { history: any; timestamp: string },
    opts?: { authHeader?: string }
  ): Promise<void> {
    const res = await fetch(`${this.base}/add_workspace_history/${workspaceId}`, {
      method: 'POST',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify({ history: data.history, timestep: data.timestamp }),
    });
    if (!res.ok) throw new Error(`addHistory failed: ${res.status}`);
  }
}


