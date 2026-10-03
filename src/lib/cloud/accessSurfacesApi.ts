import type { DesktopCloudSession, MutableSessionHandler, RepositoryTarget } from "../cloudApi";

export type DesktopCloudAccessKind = "git_remote" | "cli" | "agent" | "mcp" | "mcp_endpoint" | "sandbox" | "sandbox_endpoint";
export type DesktopCloudAccessDirection = "bidirectional" | "inbound" | "outbound";
export type DesktopCloudAccessSurface = {
  id: string;
  project_id: string;
  target: RepositoryTarget;
  kind: DesktopCloudAccessKind;
  name: string | null;
  direction: string | null;
  config: Record<string, unknown>;
  policy: Record<string, unknown>;
  oauth_connection_id: number | null;
  trigger: Record<string, unknown> | null;
  status: string;
  last_activity_at: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_key?: boolean | null;
  key_last4?: string | null;
};
export type DesktopCloudAccessSurfaceCreate = {
  target: RepositoryTarget;
  kind: DesktopCloudAccessKind;
  direction: DesktopCloudAccessDirection;
  name?: string;
  config?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  oauth_connection_id?: number | null;
  trigger?: { type: "manual" | "scheduled" | "on_change"; config?: Record<string, unknown> };
};
export type DesktopCloudAccessSurfacePatch = Partial<Omit<DesktopCloudAccessSurfaceCreate, "target" | "kind">> & { status?: "active" | "paused" };
export type DesktopCloudAccessSurfaceConfigure = {
  project_id: string;
  kind: "agent" | "mcp" | "sandbox";
  name?: string;
  path?: string;
  config?: Record<string, unknown>;
  accesses?: Record<string, unknown>[];
  tools_config?: Record<string, unknown>[];
};
export type DesktopCloudAccessSurfaceCreated = {
  id: string;
  project_id: string;
  kind: DesktopCloudAccessKind;
  name: string | null;
  status: string;
  target?: RepositoryTarget | null;
  mcp_api_key?: string | null;
  mcp_server_url?: string | null;
};
export type DesktopCloudAccessCredentialIssued = {
  access_surface_id: string;
  credential: string;
  target?: RepositoryTarget | null;
  credential_hint?: string | null;
};
export type AccessTransport = <T>(path: string, session: DesktopCloudSession, onSessionChange?: MutableSessionHandler, init?: RequestInit, apiBaseUrl?: string | null) => Promise<T>;
type SessionOptions = [onSessionChange?: MutableSessionHandler, apiBaseUrl?: string | null];
const KINDS: readonly string[] = ["git_remote", "cli", "agent", "mcp", "mcp_endpoint", "sandbox", "sandbox_endpoint"];

function segment(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("An explicit Access resource ID is required.");
  return encodeURIComponent(value);
}
function validateTarget(target: RepositoryTarget, projectId: string): void {
  if (!target || target.project_id !== projectId || (target.kind !== "project_root" && target.kind !== "scope")
    || (target.kind === "scope" && (typeof target.scope_id !== "string" || !target.scope_id.trim()))) {
    throw new Error("Access surface returned an invalid or foreign repository target.");
  }
  const allowed = target.kind === "scope" ? ["kind", "project_id", "scope_id"] : ["kind", "project_id"];
  if (Object.keys(target).some(key => !allowed.includes(key))) throw new Error("Access target contains ambiguous fields.");
}
function sameTarget(actual: RepositoryTarget, expected: RepositoryTarget): void {
  if (actual.kind !== expected.kind || actual.project_id !== expected.project_id
    || (actual.kind === "scope" && expected.kind === "scope" && actual.scope_id !== expected.scope_id)) {
    throw new Error("Access operation returned another repository target.");
  }
}
function validate(surface: DesktopCloudAccessSurface, projectId?: string, id?: string): DesktopCloudAccessSurface {
  if (!surface || typeof surface.id !== "string" || !surface.id.trim()
    || typeof surface.project_id !== "string" || !surface.project_id.trim()
    || (projectId !== undefined && surface.project_id !== projectId)
    || (id !== undefined && surface.id !== id) || !KINDS.includes(surface.kind)) {
    throw new Error("Access response has an invalid or inconsistent surface identity.");
  }
  validateTarget(surface.target, surface.project_id);
  return surface;
}
function inventory(rows: DesktopCloudAccessSurface[], projectId?: string): DesktopCloudAccessSurface[] {
  if (!Array.isArray(rows)) throw new Error("Access inventory is not an array.");
  const seen = new Set<string>();
  return rows.map(row => {
    validate(row, projectId);
    if (seen.has(row.id)) throw new Error("Access inventory contains duplicate surface identities.");
    seen.add(row.id);
    return row;
  });
}

/** Canonical Access resource client. No Provider/ID conversion or legacy fallback. */
export function createAccessSurfacesApi(request: AccessTransport) {
  const globalBase = "/access/surfaces";
  const base = (projectId: string) => `/projects/${segment(projectId)}/access/surfaces`;
  const path = (projectId: string, id: string) => `${base(projectId)}/${segment(id)}`;
  const globalPath = (id: string) => `${globalBase}/${segment(id)}`;
  const send = <T>(session: DesktopCloudSession, url: string, method: string, body: unknown, options: SessionOptions): Promise<T> =>
    request<T>(url, session, options[0], { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, options[1]);
  return {
    async listAccessSurfaces(session: DesktopCloudSession, projectId: string, ...options: SessionOptions) {
      return inventory(await send<DesktopCloudAccessSurface[]>(session, base(projectId), "GET", undefined, options), projectId);
    },
    async getAccessSurface(session: DesktopCloudSession, id: string, ...options: SessionOptions) {
      return validate(await send<DesktopCloudAccessSurface>(session, globalPath(id), "GET", undefined, options), undefined, id);
    },
    async createAccessSurface(session: DesktopCloudSession, projectId: string, body: DesktopCloudAccessSurfaceCreate, ...options: SessionOptions) {
      validateTarget(body.target, projectId);
      const surface = validate(await send<DesktopCloudAccessSurface>(session, base(projectId), "POST", body, options), projectId);
      if (surface.kind !== body.kind) throw new Error("Access creation returned another surface kind.");
      sameTarget(surface.target, body.target);
      return surface;
    },
    async updateAccessSurface(session: DesktopCloudSession, projectId: string, id: string, body: DesktopCloudAccessSurfacePatch, ...options: SessionOptions) {
      return validate(await send<DesktopCloudAccessSurface>(session, path(projectId, id), "PATCH", body, options), projectId, id);
    },
    async enableTargetAccess(session: DesktopCloudSession, projectId: string, target: RepositoryTarget, ...options: SessionOptions) {
      validateTarget(target, projectId);
      const rows = inventory(await send<DesktopCloudAccessSurface[]>(session, `${base(projectId)}/enable-target`, "POST", { target }, options), projectId);
      for (const row of rows) sameTarget(row.target, target);
      return rows;
    },
    async activateAccessSurfaceAgent(session: DesktopCloudSession, projectId: string, id: string, ...options: SessionOptions) {
      return validate(await send<DesktopCloudAccessSurface>(session, `${path(projectId, id)}/activate-agent`, "POST", {}, options), projectId, id);
    },
    async pauseAccessSurface(session: DesktopCloudSession, projectId: string, id: string, ...options: SessionOptions): Promise<void> {
      await send(session, `${path(projectId, id)}/pause`, "POST", {}, options);
    },
    async resumeAccessSurface(session: DesktopCloudSession, projectId: string, id: string, ...options: SessionOptions): Promise<void> {
      await send(session, `${path(projectId, id)}/resume`, "POST", {}, options);
    },
    async deleteAccessSurface(session: DesktopCloudSession, projectId: string, id: string, ...options: SessionOptions): Promise<void> {
      await send(session, path(projectId, id), "DELETE", undefined, options);
    },
    async configureAccessSurface(session: DesktopCloudSession, body: DesktopCloudAccessSurfaceConfigure, ...options: SessionOptions) {
      segment(body.project_id);
      const row = await send<DesktopCloudAccessSurfaceCreated>(session, globalBase, "POST", body, options);
      if (typeof row?.id !== "string" || !row.id.trim() || row.project_id !== body.project_id || row.kind !== body.kind) {
        throw new Error("Access creation returned inconsistent surface identities.");
      }
      if (row.target) validateTarget(row.target, body.project_id);
      return row;
    },
    async listAccessibleSurfaces(session: DesktopCloudSession, filter: { project_id?: string; kind?: DesktopCloudAccessKind; status?: string } = {}, ...options: SessionOptions) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) {
        if (!["project_id", "kind", "status"].includes(key)) throw new Error("Unknown Access query selector.");
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) throw new Error("Access selectors must not be empty.");
        query.set(key, value);
      }
      return inventory(await send<DesktopCloudAccessSurface[]>(session, `${globalBase}${query.size ? `?${query}` : ""}`, "GET", undefined, options), filter.project_id);
    },
    async renameAccessSurface(session: DesktopCloudSession, id: string, name: string, ...options: SessionOptions) {
      return validate(await send<DesktopCloudAccessSurface>(session, `${globalPath(id)}/rename`, "PATCH", { name }, options), undefined, id);
    },
    async updateAccessSurfaceMetadata(session: DesktopCloudSession, id: string, body: Pick<DesktopCloudAccessSurfacePatch, "status" | "config" | "trigger">, ...options: SessionOptions) {
      return validate(await send<DesktopCloudAccessSurface>(session, globalPath(id), "PATCH", body, options), undefined, id);
    },
    async regenerateAccessSurfaceKey(session: DesktopCloudSession, id: string, ...options: SessionOptions) {
      const issued = await send<DesktopCloudAccessCredentialIssued>(session, `${globalPath(id)}/regenerate-key`, "POST", {}, options);
      if (issued?.access_surface_id !== id || typeof issued.credential !== "string" || !issued.credential.trim()) {
        throw new Error("Access credential returned an inconsistent surface identity.");
      }
      return issued;
    },
    async deleteConfiguredAccessSurface(session: DesktopCloudSession, id: string, ...options: SessionOptions): Promise<void> {
      await send(session, globalPath(id), "DELETE", undefined, options);
    },
  };
}
