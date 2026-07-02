import {
  getCloudAccessPointSemantics,
  getCloudRepoIdentity,
  listCloudScopes,
  type DesktopCloudProject,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import {
  getPuppyoneRemote,
  normalizeRemoteUrlForCompare,
  parsePuppyoneRemote,
} from "../../source-control/remotes";

export async function resolveMappedCloudProjectId({
  session,
  projects,
  cloudRemote,
  configuredProjectId,
  onSessionChange,
  cloudApiBaseUrl,
}: {
  session: DesktopCloudSession;
  projects: DesktopCloudProject[];
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  configuredProjectId: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  cloudApiBaseUrl: string | null;
}): Promise<string | null> {
  if (!cloudRemote) return configuredProjectId;
  if (cloudRemote.info.kind === "project" && cloudRemote.info.projectId) {
    return cloudRemote.info.projectId;
  }
  if (cloudRemote.info.kind !== "access-point" || !cloudRemote.info.accessKey) {
    return configuredProjectId;
  }

  const accessKey = cloudRemote.info.accessKey;
  try {
    const semantics = await getCloudAccessPointSemantics(
      accessKey,
      session.user_email,
      cloudRemote.rawUrl,
      cloudApiBaseUrl,
    );
    const semanticProjectId = (
      semantics.project_id
      || semantics.scope?.project_id
      || ""
    ).trim();
    if (semanticProjectId) return semanticProjectId;

    const repoId = (semantics.scope?.repo_id || "").trim();
    if (repoId && projects.some((project) => project.id === repoId)) {
      return repoId;
    }
  } catch {
    // Older backends may not expose AP-FS semantics; fall back to authenticated project metadata below.
  }

  if (configuredProjectId) return configuredProjectId;

  const remoteUrl = normalizeRemoteUrlForCompare(cloudRemote.rawUrl);
  for (const project of projects.slice(0, 50)) {
    try {
      const scopes = await listCloudScopes(session, project.id, onSessionChange, cloudApiBaseUrl);
      if (scopes.some((scope) => scope.access_key === accessKey)) return project.id;
    } catch {
      // Keep scanning projects; a single inaccessible project should not block mapping resolution.
    }

    try {
      const identity = await getCloudRepoIdentity(session, project.id, onSessionChange, cloudApiBaseUrl);
      const identityRemote = parsePuppyoneRemote(identity.url);
      if (identityRemote?.kind === "access-point" && identityRemote.accessKey === accessKey) return project.id;
      if (normalizeRemoteUrlForCompare(identity.url) === remoteUrl) return project.id;
      if (identity.scopes.some((scope) => scope.access_key === accessKey)) return project.id;
    } catch {
      // Identity may be unavailable for a project; continue scanning.
    }
  }
  return null;
}
