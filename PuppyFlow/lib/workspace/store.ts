export type WorkspaceBasic = { workspace_id: string; workspace_name: string };

export interface IWorkspaceStore {
  listWorkspaces(userId: string, opts?: { authHeader?: string }): Promise<WorkspaceBasic[]>;
  createWorkspace(
    userId: string,
    payload: { workspace_id: string; workspace_name: string },
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic>;
  deleteWorkspace(workspaceId: string, opts?: { authHeader?: string }): Promise<void>;
  renameWorkspace(
    workspaceId: string,
    newName: string,
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic>;
  getLatestHistory(workspaceId: string, opts?: { authHeader?: string }): Promise<any | null>;
  addHistory(
    workspaceId: string,
    data: { history: any; timestamp: string },
    opts?: { authHeader?: string }
  ): Promise<void>;
}


