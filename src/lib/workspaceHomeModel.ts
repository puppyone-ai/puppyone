import type { HomepageProjectSort } from "../preferenceStorage";
import type { Workspace } from "@puppyone/shared-ui";
import type { getRecentWorkspaces } from "./localFiles";

export type CloudSpace = Readonly<{
  id: string;
  name: string;
  kind: "personal" | "team";
  canCreateProjects: boolean;
  /** The plan this space is on, when billing has published one; projects here use it. */
  planId?: string | null;
}>;

export type RecentWorkspaceHomeItem = {
  workspace: Workspace;
  lastOpenedAt?: string | null;
};

/**
 * One project on the Homepage and in project navigation. A local folder and
 * its Cloud project are two projects (puppy-issues ADR-001), so an entry is
 * either a local folder (`localPath`) or a Cloud project (`cloudProjectId`),
 * never both.
 */
export type ProjectHomeItem = {
  id: string;
  label: string;
  /** Empty for a Cloud project; never a synthetic local path. */
  localPath: string;
  /** Present only on a Cloud project's own entry. */
  cloudProjectId?: string;
  /** The organization a Cloud project's own entry belongs to, when the catalog states it. */
  cloudOrganizationId?: string;
  /**
   * A local folder's link to the Cloud project it was put in the Cloud as.
   * Only a mark and a way to open that other project; never merges them.
   */
  linkedCloudProject?: Readonly<{ id: string; name: string }>;
  /** What this account may do to a Cloud project's own entry. */
  cloudActions?: Readonly<{ rename: boolean; delete: boolean }>;
  lastModifiedAt?: string | null;
  lastOpenedAt?: string | null;
  /**
   * The id this local folder was opened to the owner's other computers under, as
   * recorded when it was shared. Whether it still is comes from this computer's catalog.
   */
  hostFolderId?: string;
};

export function projectHomeItemLocation(item: ProjectHomeItem): "local" | "cloud" {
  return item.localPath ? "local" : "cloud";
}

function modificationTime(item: ProjectHomeItem) {
  const time = Date.parse(item.lastModifiedAt ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Orders projects, leaving equals in the order the catalog gave them. */
export function viewProjectHomeItems(items: readonly ProjectHomeItem[], { sort, locale, untitled }: {
  sort: HomepageProjectSort;
  locale: string;
  untitled: string;
}) {
  const shown = [...items];
  if (sort === "name") {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    return shown.sort((a, b) => collator.compare(getProjectName(a, untitled), getProjectName(b, untitled)));
  }
  return shown.sort((a, b) => {
    const [newer, older] = [modificationTime(b), modificationTime(a)];
    if (newer === older) return 0;
    return newer > older ? 1 : -1;
  });
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

/**
 * A re-read of the recent list has names and paths but no dates, which is most of
 * what orders it. What hydration learned stands until hydration learns it again.
 */
export function keepHydratedRecentItems(next: RecentWorkspaceHomeItem[], current: readonly RecentWorkspaceHomeItem[]) {
  const known = new Map(current.map(({ workspace }) => [workspace.path, workspace]));
  return next.map((item) => {
    const previous = known.get(item.workspace.path);
    if (previous?.hydrationState !== "ready" || item.workspace.hydrationState !== "metadata") return item;
    const { commitCount, lastModifiedAt, hydrationState } = previous;
    return { ...item, workspace: { ...item.workspace, commitCount, lastModifiedAt, hydrationState } };
  });
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

/**
 * A display path short enough for one line: its root and its last `tail` folders,
 * with the folders between them elided (`~/…/Clients/2026`).
 */
export function compactDisplayPath(displayPath: string, tail = 2): string {
  const separator = displayPath.includes("\\") && !displayPath.includes("/") ? "\\" : "/";
  const parts = displayPath.split(separator);
  // parts[0] is the root: "~", "" for "/", or a drive such as "C:".
  if (parts.length <= tail + 2) return displayPath;
  return [parts[0], "…", ...parts.slice(-tail)].join(separator);
}

export function getProjectName(item: ProjectHomeItem, fallback: string): string {
  const label = item.label.trim();
  if (label && label !== item.localPath) return label;

  const normalizedPath = item.localPath.length > 1
    ? item.localPath.replace(/\/+$/, "")
    : item.localPath;
  return normalizedPath.split("/").at(-1) || label || fallback;
}
