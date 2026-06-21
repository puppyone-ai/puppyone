import type { DataNode, DataNodeKind, DataPort, Workspace } from "@puppyone/shared-ui";
import type {
  GitCommitDetail,
  GitStatusSnapshot,
  GitWorkingDiffScope,
  LastWorkspaceResult,
  WorkspaceCreateEntryKind,
  WorkspaceCreateEntryResult,
} from "../types/electron";

export type { Workspace };
export type FileKind = DataNodeKind;
export type FileNode = DataNode;

export function createLocalDataPort(rootPath: string): DataPort {
  return {
    listChildren: (folderPath) => loadFolderChildren(rootPath, folderPath),
    readFile: async (path) => ({
      ...(await getDesktopBridge().readFile({ rootPath, path })),
      url: buildLocalFileUrl(rootPath, path),
    }),
    getFileUrl: (path) => buildLocalFileUrl(rootPath, path),
    writeFile: (path, content) => getDesktopBridge().writeFile({ rootPath, path, content }),
    renameNode: (path, nextName) => getDesktopBridge().renameEntry({ rootPath, path, nextName }).then(() => undefined),
    deleteNode: (path) => getDesktopBridge().deleteEntry({ rootPath, path }).then(() => undefined),
  };
}

export async function loadFolderChildren(rootPath: string, folderPath: string | null): Promise<FileNode[]> {
  return getDesktopBridge().listFolderChildren({
    rootPath,
    folderPath,
  });
}

export async function getLastWorkspace(): Promise<LastWorkspaceResult> {
  return getDesktopBridge().getLastWorkspace();
}

export async function rememberLastWorkspace(folderPath: string): Promise<void> {
  await getDesktopBridge().rememberLastWorkspace(folderPath);
}

export async function forgetLastWorkspace(): Promise<void> {
  await getDesktopBridge().forgetLastWorkspace();
}

export async function selectWorkspaceFolder(): Promise<Workspace | null> {
  return getDesktopBridge().selectFolder();
}

export async function workspaceFromPath(folderPath: string): Promise<Workspace> {
  return getDesktopBridge().workspaceFromPath(folderPath);
}

export async function createWorkspaceEntry(
  rootPath: string,
  request: {
    parentPath: string | null;
    name: string;
    kind: WorkspaceCreateEntryKind;
    content?: string;
  },
): Promise<WorkspaceCreateEntryResult> {
  return getDesktopBridge().createEntry({ rootPath, ...request });
}

export async function getWorkspaceGitStatus(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().getGitStatus({ rootPath });
}

export async function initializeWorkspaceGitRepository(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().initGitRepository({ rootPath });
}

export async function getWorkspaceGitCommitDetail(rootPath: string, commitId: string): Promise<GitCommitDetail> {
  return getDesktopBridge().getGitCommitDetail({ rootPath, commitId });
}

export async function getWorkspaceGitFileDiff(
  rootPath: string,
  path: string,
  scope: GitWorkingDiffScope,
): Promise<GitCommitDetail> {
  return getDesktopBridge().getGitFileDiff({ rootPath, path, scope });
}

export async function stageWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stageGitPaths({ rootPath, paths });
}

export async function unstageWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().unstageGitPaths({ rootPath, paths });
}

export async function discardWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().discardGitPaths({ rootPath, paths });
}

export async function commitWorkspaceGit(rootPath: string, message: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().commitGit({ rootPath, message });
}

export async function checkoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().checkoutGitBranch({ rootPath, branchName, remote });
}

export async function stashAndCheckoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stashAndCheckoutGitBranch({ rootPath, branchName, remote });
}

export async function commitAndCheckoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().commitAndCheckoutGitBranch({ rootPath, branchName, remote });
}

export async function createWorkspaceGitBranch(rootPath: string, branchName: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().createGitBranch({ rootPath, branchName });
}

export async function fetchWorkspaceGit(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().fetchGit({ rootPath });
}

export async function pullWorkspaceGit(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().pullGit({ rootPath });
}

export async function pushWorkspaceGit(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().pushGit({ rootPath });
}

export function findFileNode(nodes: FileNode[], path: string | null): FileNode | null {
  if (!path) return null;

  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const child = findFileNode(node.children, path);
      if (child) return child;
    }
  }

  return null;
}

export function listFolderChildren(nodes: FileNode[], folderPath: string | null): FileNode[] {
  if (!folderPath) return nodes;
  return findFileNode(nodes, folderPath)?.children ?? [];
}

export function hasLoadedFolder(nodes: FileNode[], folderPath: string | null): boolean {
  if (!folderPath) return nodes.length > 0;
  const node = findFileNode(nodes, folderPath);
  return node?.type === "folder" && Array.isArray(node.children);
}

export function attachFolderChildren(
  nodes: FileNode[],
  folderPath: string | null,
  children: FileNode[],
): FileNode[] {
  if (!folderPath) return children;

  return nodes.map((node) => {
    if (node.path === folderPath) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: attachFolderChildren(node.children, folderPath, children),
      };
    }
    return node;
  });
}

function getDesktopBridge() {
  if (!window.puppyoneDesktop) {
    throw new Error("puppyone desktop bridge is unavailable. Run the app with Electron.");
  }
  return window.puppyoneDesktop;
}

function buildLocalFileUrl(rootPath: string, relativePath: string): string {
  const encodedRoot = encodeURIComponent(rootPath);
  const encodedPath = relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `puppyone-local://file/${encodedRoot}/${encodedPath}`;
}
