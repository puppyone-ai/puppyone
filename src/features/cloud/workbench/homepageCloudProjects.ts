import type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../../app-shell/workspaceHomeModel";
import type { DesktopCloudProject } from "../../../lib/cloudApi";
import { isTrustedCloudGitOrigin } from "../workspace/workspaceGitRemote";
import { latestProjectModifiedAt } from "./homepageCloudActivity";

const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/** One flat list: location affects the icon/actions, never the sort rank. */
export function buildHomepageProjects({ local, cloud, apiBaseUrl, activity = new Map() }: {
  local: readonly RecentWorkspaceHomeItem[];
  cloud: readonly DesktopCloudProject[];
  apiBaseUrl: string;
  activity?: ReadonlyMap<string, string>;
}): ProjectHomeItem[] {
  const remaining = new Map(cloud.map((project) => [project.id, project]));
  // Keep distinct checkouts. Prefer the most recently modified matching checkout.
  const items: ProjectHomeItem[] = [...local].sort((a, b) => time(b.workspace.lastModifiedAt) - time(a.workspace.lastModifiedAt)
    || a.workspace.path.localeCompare(b.workspace.path)).map(({ workspace }) => {
    const remote = workspace.puppyoneGitRemote;
    // A scoped checkout is not the same workspace as the catalog's project root.
    const match = remote && !remote.scopeId && workspace.hydrationState === "ready"
      && isTrustedCloudGitOrigin(remote.origin, apiBaseUrl) ? remaining.get(remote.projectId) : undefined;
    if (match) remaining.delete(match.id);
    return { id: `local:${workspace.path}`, label: workspace.name, localPath: workspace.path,
      lastModifiedAt: latestProjectModifiedAt(workspace.lastModifiedAt, match?.updated_at, match && activity.get(match.id)),
      ...(match ? { cloudProjectId: match.id } : {}) };
  });
  for (const project of remaining.values()) {
    items.push({ id: `cloud:${project.id}`, label: project.name, localPath: "", cloudProjectId: project.id,
      lastModifiedAt: latestProjectModifiedAt(project.updated_at, activity.get(project.id)) });
  }
  return items.sort((a, b) => time(b.lastModifiedAt) - time(a.lastModifiedAt)
    || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
