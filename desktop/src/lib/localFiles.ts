import type { AiEditRequest, DataNode, DataNodeKind, DataPort, Workspace } from "@puppyone/shared-ui";
import type {
  GitCommitDetail,
  GitBranchGraphSnapshot,
  GitStatusSnapshot,
  GitWorkingDiffScope,
  LastWorkspaceResult,
  PuppyoneWorkspaceConfig,
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
    moveNode: (from, to) => getDesktopBridge().moveEntry({ rootPath, fromPath: from, toPath: to }).then(() => undefined),
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

export async function openExternalUrl(href: string): Promise<void> {
  await getDesktopBridge().openExternalUrl(href);
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

export async function getLatestAiEditReviewRequest(rootPath: string): Promise<AiEditRequest | null> {
  return getDesktopBridge().getLatestAiEditReviewRequest({ rootPath });
}

export function subscribeAiEditReviewUpdates(
  callback: (event: { rootPath: string; request: AiEditRequest }) => void,
): () => void {
  return getDesktopBridge().onAiEditReviewUpdated(callback);
}

export async function getWorkspaceGitStatus(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().getGitStatus({ rootPath });
}

export async function getWorkspaceGitBranchGraph(rootPath: string): Promise<GitBranchGraphSnapshot> {
  const bridge = getDesktopBridge();
  if (typeof bridge.getGitBranchGraph === "function") {
    try {
      return await bridge.getGitBranchGraph({ rootPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/No handler registered.*workspace:git-branch-graph|workspace:git-branch-graph/i.test(message)) {
        throw error;
      }
    }
  }
  const status = await bridge.getGitStatus({ rootPath });
  return toWorkspaceGitBranchGraphSnapshot(status);
}

export function toWorkspaceGitBranchGraphSnapshot(status: GitStatusSnapshot | GitBranchGraphSnapshot): GitBranchGraphSnapshot {
  return {
    isRepo: status.isRepo,
    branch: status.branch,
    headCommitId: status.headCommitId,
    branches: status.branches,
    commits: status.commits,
    allCommits: status.allCommits,
  };
}

export async function initializeWorkspaceGitRepository(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().initGitRepository({ rootPath });
}

export async function configureWorkspaceCloudRemote(
  rootPath: string,
  remoteUrl: string,
  remoteName = "puppyone",
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().configureGitCloudRemote({ rootPath, remoteUrl, remoteName });
}

export async function readPuppyoneWorkspaceConfig(rootPath: string): Promise<PuppyoneWorkspaceConfig> {
  return getDesktopBridge().readPuppyoneConfig({ rootPath });
}

export async function writePuppyoneWorkspaceConfig(
  rootPath: string,
  config: PuppyoneWorkspaceConfig,
): Promise<PuppyoneWorkspaceConfig> {
  return getDesktopBridge().writePuppyoneConfig({ rootPath, config });
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

export async function stageAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stageAllGitChanges({ rootPath });
}

export async function unstageWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().unstageGitPaths({ rootPath, paths });
}

export async function unstageAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().unstageAllGitChanges({ rootPath });
}

export async function discardWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().discardGitPaths({ rootPath, paths });
}

export async function discardAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().discardAllGitChanges({ rootPath });
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

export async function publishWorkspaceGitBranch(rootPath: string, remoteName?: string | null): Promise<GitStatusSnapshot> {
  return getDesktopBridge().publishGitBranch({ rootPath, remoteName });
}

export async function syncWorkspaceGit(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().syncGit({ rootPath });
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
