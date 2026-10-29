import type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../../../lib/workspaceHomeModel";
import type { DesktopCloudProject } from "../../../lib/cloudApi";
import { isTrustedCloudGitOrigin } from "../workspace/workspaceGitRemote";
import { latestProjectModifiedAt } from "./homepageCloudActivity";

const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

/**
 * One flat list in which a local folder and its Cloud project are two entries
 * (puppy-issues ADR-001). A local folder whose Git remote names a Cloud project
 * in this account's catalog carries a link to it; it is never merged into it.
 * Location affects the icon and actions, never the sort rank.
 */
export function buildHomepageProjects({ local, cloud, apiBaseUrl, activity = new Map() }: {
  local: readonly RecentWorkspaceHomeItem[];
  cloud: readonly DesktopCloudProject[];
  apiBaseUrl: string;
  activity?: ReadonlyMap<string, string>;
}): ProjectHomeItem[] {
  const catalog = new Map(cloud.map((project) => [project.id, project]));
  const items: ProjectHomeItem[] = local.map(({ workspace }) => {
    const remote = workspace.puppyoneGitRemote;
    // A scoped checkout is not linked to the catalog's project root.
    const linked = remote && !remote.scopeId && workspace.hydrationState === "ready"
      && isTrustedCloudGitOrigin(remote.origin, apiBaseUrl) ? catalog.get(remote.projectId) : undefined;
    return { id: `local:${workspace.path}`, label: workspace.name, localPath: workspace.path,
      lastModifiedAt: workspace.lastModifiedAt ?? null,
      ...(linked ? { linkedCloudProject: { id: linked.id, name: linked.name } } : {}) };
  });
  for (const project of cloud) {
    items.push({ id: `cloud:${project.id}`, label: project.name, localPath: "", cloudProjectId: project.id,
      lastModifiedAt: latestProjectModifiedAt(project.updated_at, activity.get(project.id)) });
  }
  return items.sort((a, b) => time(b.lastModifiedAt) - time(a.lastModifiedAt)
    || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
