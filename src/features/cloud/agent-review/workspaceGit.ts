import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";

/** What came of bringing a branch into the workspace. */
export type WorkspaceSync = Readonly<{
  status: "up_to_date" | "fast_forward" | "merged" | "conflict" | "aborted";
  paths?: readonly string[];
}>;
/** What came of moving the project to the workspace's work. */
export type WorkspacePublish = Readonly<{ status: "published" | "no_changes" | "rejected" | "merging" | string }>;

const workbenchPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/workbench`;

async function runningGeneration(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  const { workspace } = await cloudApiRequest<{ workspace: { generation: string; state: string } | null }>(
    workbenchPath(projectId), session, undefined, {}, apiBaseUrl);
  if (workspace?.state !== "running") {
    throw Object.assign(new Error("The hosted workspace is not running."), { code: "workbench_not_running" });
  }
  return workspace.generation;
}

async function post<Result>(session: DesktopCloudSession, projectId: string, path: string,
  body: Readonly<Record<string, unknown>>, apiBaseUrl: string) {
  const generation = await runningGeneration(session, projectId, apiBaseUrl);
  return cloudApiRequest<Result>(`${workbenchPath(projectId)}/${path}`, session, undefined,
    { method: "POST", body: JSON.stringify({ generation, ...body }) }, apiBaseUrl);
}

/** ``sourceRef`` names an Agent's branch; without it the project's own branch comes in. */
export function syncWorkspace(session: DesktopCloudSession, projectId: string, sourceRef: string | null,
  apiBaseUrl: string) {
  return post<WorkspaceSync>(session, projectId, "sync", sourceRef ? { source_ref: sourceRef } : {}, apiBaseUrl);
}

export function finishSync(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return post<WorkspaceSync>(session, projectId, "sync/finish", {}, apiBaseUrl);
}

export function abortSync(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return post<WorkspaceSync>(session, projectId, "sync/abort", {}, apiBaseUrl);
}

export function publishWorkspace(session: DesktopCloudSession, projectId: string, apiBaseUrl: string) {
  return post<WorkspacePublish>(session, projectId, "publish", {}, apiBaseUrl);
}
