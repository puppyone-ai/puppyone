import type { DataNode, DataNodeKind, DataPort, Workspace } from "@puppyone/data-core";
import type { GitStatusSnapshot } from "../types/electron";

export type { Workspace };
export type FileKind = DataNodeKind;
export type FileNode = DataNode;

export function createLocalDataPort(rootPath: string): DataPort {
  return {
    listChildren: (folderPath) => loadFolderChildren(rootPath, folderPath),
    readFile: (path) => getDesktopBridge().readFile({ rootPath, path }),
    writeFile: (path, content) => getDesktopBridge().writeFile({ rootPath, path, content }),
  };
}

export async function loadFolderChildren(rootPath: string, folderPath: string | null): Promise<FileNode[]> {
  return getDesktopBridge().listFolderChildren({
    rootPath,
    folderPath,
  });
}

export async function selectWorkspaceFolder(): Promise<Workspace | null> {
  return getDesktopBridge().selectFolder();
}

export async function workspaceFromPath(folderPath: string): Promise<Workspace> {
  return getDesktopBridge().workspaceFromPath(folderPath);
}

export async function getWorkspaceGitStatus(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().getGitStatus({ rootPath });
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
    throw new Error("PuppyOne Desktop bridge is unavailable. Run the app with Electron.");
  }
  return window.puppyoneDesktop;
}
