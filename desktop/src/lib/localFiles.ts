import { invoke } from "@tauri-apps/api/core";

export type Workspace = {
  id: string;
  name: string;
  path: string;
  status: "protected" | "recording" | "paused";
  commitCount?: number;
  cloudState?: "local" | "syncing" | "synced";
};

export type FileKind =
  | "folder"
  | "markdown"
  | "json"
  | "image"
  | "pdf"
  | "video"
  | "file";

export type FileNode = {
  id: string;
  name: string;
  path: string;
  type: FileKind;
  size?: string | null;
  modified?: string | null;
  status?: "clean" | "modified" | "created" | "deleted" | "moved";
  preview?: string | null;
  content?: string | null;
  children?: FileNode[] | null;
};

export async function loadFolderChildren(rootPath: string, folderPath: string | null): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_folder_children", {
    rootPath,
    folderPath,
  });
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
