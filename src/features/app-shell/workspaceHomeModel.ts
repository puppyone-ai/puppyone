import type { Workspace } from "@puppyone/shared-ui";
import type { getRecentWorkspaces } from "../../lib/localFiles";

export type RecentWorkspaceHomeItem = {
  workspace: Workspace;
  lastOpenedAt?: string | null;
};

export type ProjectHomeItem = {
  id: string;
  label: string;
  /** Empty for a hosted-only entry; never a synthetic local path. */
  localPath: string;
  cloudProjectId?: string;
  lastOpenedLocation?: "local" | "cloud";
  lastModifiedAt?: string | null;
  lastOpenedAt?: string | null;
};

export function projectOpeningLocation(item: ProjectHomeItem): "local" | "cloud" {
  return item.cloudProjectId && (item.lastOpenedLocation === "cloud" || !item.localPath) ? "cloud" : "local";
}

export function mergeWorkspaceLists(current: Workspace[], incoming: Workspace[]) {
  const byLocation = new Map<string, Workspace>();
  for (const workspace of [...current, ...incoming]) {
    byLocation.set(workspace.path, workspace);
  }
  return Array.from(byLocation.values());
}

export function getRecentWorkspaceItems(
  result: Awaited<ReturnType<typeof getRecentWorkspaces>>,
): RecentWorkspaceHomeItem[] {
  if (result.items) return result.items;
  return result.workspaces.map((workspace) => ({
    workspace,
    lastOpenedAt: null,
  }));
}

export function getWorkspaceParentPathForDisplay(workspacePath: string): string {
  const trimmedPath = workspacePath.trim();
  if (!trimmedPath) return "";

  const normalizedPath = trimmedPath.length > 1
    ? trimmedPath.replace(/\/+$/, "")
    : trimmedPath;
  const separatorIndex = normalizedPath.lastIndexOf("/");
  if (separatorIndex < 0) return "";

  const parentPath = separatorIndex === 0
    ? "/"
    : normalizedPath.slice(0, separatorIndex);
  return getWorkspacePathForDisplay(parentPath);
}

export function getWorkspacePathForDisplay(workspacePath: string): string {
  return workspacePath.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

export function getProjectName(item: ProjectHomeItem, fallback: string): string {
  const label = item.label.trim();
  if (label && label !== item.localPath) return label;

  const normalizedPath = item.localPath.length > 1
    ? item.localPath.replace(/\/+$/, "")
    : item.localPath;
  return normalizedPath.split("/").at(-1) || label || fallback;
}
