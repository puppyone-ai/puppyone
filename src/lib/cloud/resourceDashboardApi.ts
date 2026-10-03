import type { DesktopCloudSession, MutableSessionHandler, RepositoryTarget } from "../cloudApi";
import type { DesktopCloudAccessKind } from "./accessSurfacesApi";

type DashboardSummary = {
  resource_id: string;
  project_id: string;
  name?: string | null;
  path?: string | null;
  direction?: string | null;
  status: string;
  trigger?: Record<string, unknown> | null;
  last_activity_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  usage_buckets?: number[];
};
export type DesktopCloudDashboardResource = DashboardSummary & (
  | { resource_kind: "synchronize"; provider: string; path: string }
  | { resource_kind: "access"; kind: DesktopCloudAccessKind; target: RepositoryTarget; scope_mode?: "r" | "rw" | null }
);
export type DesktopCloudDashboard = {
  project: { id: string; name: string; description?: string | null };
  nodes: { total: number; folders: number; files: number; storage_bytes?: number | null; storage_limit_bytes?: number | null };
  resources: DesktopCloudDashboardResource[];
  tools: Array<{ id: string; name: string; type?: string | null; index_status?: string | null; chunks_count?: number | null; total_files?: number | null; indexed_files?: number | null }>;
  uploads: Array<{ id: string; status: string; type: string; progress?: number; message?: string | null }>;
};
export type DashboardTransport = <T>(path: string, session: DesktopCloudSession, onSessionChange?: MutableSessionHandler, init?: RequestInit, apiBaseUrl?: string | null) => Promise<T>;

export function validateResourceDashboard(data: DesktopCloudDashboard, projectId: string): DesktopCloudDashboard {
  if (!data || data.project?.id !== projectId || !Array.isArray(data.resources)) throw new Error("Dashboard returned an invalid Project or inventory");
  const seen = new Set<string>();
  for (const row of data.resources) {
    if (!row || typeof row.resource_id !== "string" || !row.resource_id.trim() || row.project_id !== projectId
      || !["synchronize", "access"].includes(row.resource_kind)) throw new Error("Dashboard returned an invalid resource identity");
    if (row.resource_kind === "synchronize") {
      if (typeof row.provider !== "string" || !row.provider.trim() || typeof row.path !== "string") throw new Error("Dashboard returned an invalid Synchronize binding");
    } else {
      const target = row.target;
      if (!["git_remote", "cli", "agent", "mcp", "mcp_endpoint", "sandbox", "sandbox_endpoint"].includes(row.kind)
        || !target || target.project_id !== projectId || !["project_root", "scope"].includes(target.kind)
        || (target.kind === "scope" && (typeof target.scope_id !== "string" || !target.scope_id.trim()))) throw new Error("Dashboard returned an invalid Access target");
      const allowed = target.kind === "scope" ? ["kind", "project_id", "scope_id"] : ["kind", "project_id"];
      if (Object.keys(target).some(key => !allowed.includes(key))) throw new Error("Dashboard Access target contains ambiguous fields");
    }
    if ("access_key" in row || "api_key" in row) throw new Error("Dashboard metadata must not contain credentials");
    const key = `${row.resource_kind}:${row.resource_id}`;
    if (seen.has(key)) throw new Error("Dashboard returned duplicate resource identities");
    seen.add(key);
  }
  return data;
}
export function createResourceDashboardApi(request: DashboardTransport) {
  return {
    async getResourceDashboard(session: DesktopCloudSession, projectId: string, onSessionChange?: MutableSessionHandler, apiBaseUrl?: string | null): Promise<DesktopCloudDashboard> {
      if (!projectId.trim()) throw new Error("An explicit Dashboard Project ID is required");
      return validateResourceDashboard(await request<DesktopCloudDashboard>(`/projects/${encodeURIComponent(projectId)}/dashboard/resources`, session, onSessionChange, {}, apiBaseUrl), projectId);
    },
  };
}
