import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import os from 'os';
import { IWorkspaceStore, WorkspaceBasic } from './store';

function formatTimestampForFilename(timestamp: string): string {
  const isWindows = os.platform() === 'win32';
  if (isWindows) {
    const date = new Date(timestamp);
    return date
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace(/\+.*$/, '');
  }
  return timestamp;
}

const rootDir = () => path.join(process.cwd(), 'workspace_data');

export class FileWorkspaceStore implements IWorkspaceStore {
  async listWorkspaces(userId: string): Promise<WorkspaceBasic[]> {
    const saveDir = rootDir();
    if (!fs.existsSync(saveDir)) {
      await fsPromises.mkdir(saveDir, { recursive: true });
      return [];
    }
    const directories = await fsPromises.readdir(saveDir, {
      withFileTypes: true,
    });
    const workspaces: WorkspaceBasic[] = [];
    for (const dir of directories) {
      if (dir.isDirectory()) {
        const latestFile = path.join(saveDir, dir.name, 'latest.json');
        let workspaceName = 'Untitled Workspace';
        if (fs.existsSync(latestFile)) {
          try {
            const data = await fsPromises.readFile(latestFile, 'utf-8');
            const json = JSON.parse(data);
            workspaceName = json.workspaceName || workspaceName;
          } catch {
            // ignore
          }
        }
        workspaces.push({
          workspace_id: dir.name,
          workspace_name: workspaceName,
        });
      }
    }
    return workspaces;
  }

  async createWorkspace(
    userId: string,
    payload: { workspace_id: string; workspace_name: string }
  ): Promise<WorkspaceBasic> {
    const saveDir = rootDir();
    await fsPromises.mkdir(saveDir, { recursive: true });
    const workspaceDir = path.join(saveDir, payload.workspace_id);
    await fsPromises.mkdir(workspaceDir, { recursive: true });
    // initialize latest.json with name
    const latestFile = path.join(workspaceDir, 'latest.json');
    if (!fs.existsSync(latestFile)) {
      await fsPromises.writeFile(
        latestFile,
        JSON.stringify(
          { workspaceName: payload.workspace_name, blocks: [], edges: [] },
          null,
          2
        )
      );
    }
    return {
      workspace_id: payload.workspace_id,
      workspace_name: payload.workspace_name,
    };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspaceDir = path.join(rootDir(), workspaceId);
    if (fs.existsSync(workspaceDir)) {
      await fsPromises.rm(workspaceDir, { recursive: true, force: true });
    }
  }

  async renameWorkspace(
    workspaceId: string,
    newName: string
  ): Promise<WorkspaceBasic> {
    const workspaceDir = path.join(rootDir(), workspaceId);
    const latestFile = path.join(workspaceDir, 'latest.json');
    let current = { workspaceName: newName } as any;
    if (fs.existsSync(latestFile)) {
      const data = await fsPromises.readFile(latestFile, 'utf-8');
      current = JSON.parse(data);
    }
    current.workspaceName = newName;
    await fsPromises.writeFile(latestFile, JSON.stringify(current, null, 2));
    return { workspace_id: workspaceId, workspace_name: newName };
  }

  async getLatestHistory(workspaceId: string): Promise<any | null> {
    const latestFile = path.join(rootDir(), workspaceId, 'latest.json');
    if (!fs.existsSync(latestFile)) return null;
    const data = await fsPromises.readFile(latestFile, 'utf-8');
    return JSON.parse(data);
  }

  async addHistory(
    workspaceId: string,
    data: { history: any; timestamp: string }
  ): Promise<void> {
    const workspaceDir = path.join(rootDir(), workspaceId);
    await fsPromises.mkdir(workspaceDir, { recursive: true });
    const formattedTimestamp = formatTimestampForFilename(data.timestamp);
    const historyFile = path.join(workspaceDir, `${formattedTimestamp}.json`);
    await fsPromises.writeFile(
      historyFile,
      JSON.stringify(data.history, null, 2)
    );
    const latestFile = path.join(workspaceDir, 'latest.json');
    await fsPromises.writeFile(
      latestFile,
      JSON.stringify(data.history, null, 2)
    );
  }
}
