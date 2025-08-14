import { FileWorkspaceStore } from './fileStore';
import { UserSystemWorkspaceStore } from './userSystemStore';
import { IWorkspaceStore } from './store';

const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();

export function getWorkspaceStore(): IWorkspaceStore {
  if (mode === 'cloud') {
    return new UserSystemWorkspaceStore();
  }
  // default to local file store
  return new FileWorkspaceStore();
}


