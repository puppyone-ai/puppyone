import { getHomeProjectGroup, type ProjectHomeItem, type RecentWorkspaceHomeItem } from "../../app-shell/workspaceHomeModel";
import type { DesktopCloudProject } from "../../../lib/cloudApi";
import { isTrustedCloudGitOrigin } from "../workspace/workspaceGitRemote";
import { cloudHistoryTargetKey } from "./homepageCloudHistory";

const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const rank = { both: 0, cloud: 1, local: 2 };

/** A cached locator is a display hint only. Opening still authorizes the exact target. */
export function buildHomepageProjects({ local, cloud, apiBaseUrl, history = new Map() }: {
  local: readonly RecentWorkspaceHomeItem[];
  cloud: readonly DesktopCloudProject[];
  apiBaseUrl: string;
  history?: ReadonlyMap<string, string>;
}): ProjectHomeItem[] {
  const remaining = new Map(cloud.map((project) => [project.id, project]));
  // Prefer the most recently used checkout; do not collapse distinct local folders.
  const items: ProjectHomeItem[] = [...local].sort((a, b) => time(b.lastOpenedAt) - time(a.lastOpenedAt)).map(({ workspace, lastOpenedAt }) => {
    const remote = workspace.puppyoneGitRemote;
    // A scoped checkout is not the same workspace as the catalog's project root.
    const match = remote && !remote.scopeId && workspace.hydrationState === "ready"
      && isTrustedCloudGitOrigin(remote.origin, apiBaseUrl) ? remaining.get(remote.projectId) : undefined;
    if (match) remaining.delete(match.id);
    const cloudOpened = match ? history.get(cloudHistoryTargetKey({ kind: "project_root", project_id: match.id })) : null;
    return { id: `local:${workspace.path}`, label: workspace.name, localPath: workspace.path,
      lastOpenedAt: time(cloudOpened) > time(lastOpenedAt) ? cloudOpened : lastOpenedAt,
      ...(match ? { cloudProjectId: match.id } : {}) };
  });
  for (const project of remaining.values()) {
    items.push({ id: `cloud:${project.id}`, label: project.name, localPath: "", cloudProjectId: project.id,
      lastOpenedAt: history.get(cloudHistoryTargetKey({ kind: "project_root", project_id: project.id })) });
  }
  return items.sort((a, b) => rank[getHomeProjectGroup(a)] - rank[getHomeProjectGroup(b)]
    || time(b.lastOpenedAt) - time(a.lastOpenedAt) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
