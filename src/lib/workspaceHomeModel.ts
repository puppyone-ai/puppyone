import type { HomepageProjectSort } from "../preferenceStorage";
import type { Workspace } from "@puppyone/shared-ui";
import type { getRecentWorkspaces } from "./localFiles";

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
  /**
   * A local folder's link to the Cloud project it was put in the Cloud as.
   * Only a mark and a way to open that other project; never merges them.
   */
  linkedCloudProject?: Readonly<{ id: string; name: string }>;
  lastModifiedAt?: string | null;
  lastOpenedAt?: string | null;
};

export function projectHomeItemLocation(item: ProjectHomeItem): "local" | "cloud" {
  return item.localPath ? "local" : "cloud";
}

export const PROJECT_HOME_PLACES = ["local", "cloud"] as const;
export type ProjectHomePlace = typeof PROJECT_HOME_PLACES[number];

/** The places that hold at least one of these projects. */
export function projectHomeLocations(items: readonly ProjectHomeItem[]) {
  return new Set(items.map(projectHomeItemLocation));
}

function modificationTime(item: ProjectHomeItem) {
  const time = Date.parse(item.lastModifiedAt ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Narrows and orders projects, leaving equals in the order the catalog gave them. */
export function viewProjectHomeItems(items: readonly ProjectHomeItem[], { places, sort, locale, untitled }: {
  /** The places to show, any of them; none chosen means every place. */
  places: ReadonlySet<ProjectHomePlace>;
  sort: HomepageProjectSort;
  locale: string;
  untitled: string;
}) {
  const shown = items.filter((item) => places.size === 0 || places.has(projectHomeItemLocation(item)));
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
