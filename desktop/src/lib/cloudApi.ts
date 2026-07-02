import {
  CLOUD_API_BASE_URL_STORAGE_KEY,
  DEFAULT_CLOUD_API_BASE_URL,
  buildCloudApiUrl as buildCanonicalCloudApiUrl,
  cloudApiBaseUrlFromRemote,
  formatCloudApiHost as formatCanonicalCloudApiHost,
  resolveCloudApiBaseUrl,
  sameCloudApiBaseUrl,
} from "../../shared/cloudEndpoint.js";

type ApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
  detail?: unknown;
  error?: string;
};

type MutableSessionHandler = (session: DesktopCloudSession | null) => void | Promise<void>;

export type DesktopCloudSession = {
  expires_in: number;
  expires_at: number;
  user_email: string;
  api_base_url?: string;
};

export type DesktopCloudProject = {
  id: string;
  name: string;
  description?: string | null;
  org_id?: string | null;
  visibility?: string | null;
  bound_git_branch?: string | null;
  updated_at?: string | null;
  access_point_count?: number | null;
};

export type DesktopCloudOrganization = {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string | null;
  plan: string;
  seat_limit: number;
  created_at: string;
  member_count?: number | null;
};

export type DesktopCloudOrgMember = {
  id: string;
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: "owner" | "member" | "viewer" | string;
  joined_at: string;
};

export type DesktopCloudOrganizationEntitlements = {
  org_id: string;
  plan_id: string;
  status: string;
  source: string;
  entitlements: {
    features?: Record<string, boolean>;
    limits?: Record<string, number | string | null>;
    allow?: Record<string, string[] | string | null>;
  };
  current_period_end?: string | null;
  effective_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudDashboard = {
  project: {
    id: string;
    name: string;
    description?: string | null;
  };
  nodes: {
    total: number;
    folders: number;
    files: number;
  };
  connections: DesktopCloudDashboardConnection[];
  tools: Array<{
    id: string;
    name: string;
    type?: string | null;
    index_status?: string | null;
    chunks_count?: number | null;
    total_files?: number | null;
    indexed_files?: number | null;
  }>;
  uploads: Array<{
    id: string;
    status: string;
    type: string;
    progress?: number;
    message?: string | null;
  }>;
};

export type DesktopCloudDashboardConnection = {
  id: string;
  provider: string;
  name?: string | null;
  path?: string | null;
  direction?: string | null;
  status: string;
  access_key?: string | null;
  trigger?: Record<string, unknown> | null;
  last_synced_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  usage_buckets?: number[];
};

export type DesktopCloudTreeEntry = {
  name: string;
  path: string;
  type: string;
  content_hash?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  children_count?: number | null;
  integrity_status?: "ok" | "damaged" | "unknown";
};

export type DesktopCloudTree = {
  path: string;
  entries: DesktopCloudTreeEntry[];
  head_commit_id?: string;
};

export type DesktopCloudAccessPointSemantics = {
  project_id?: string | null;
  scope?: {
    id?: string | null;
    project_id?: string | null;
    repo_id?: string | null;
    repo_kind?: string | null;
    repo_ref?: string | null;
    path?: string | null;
    mode?: string | null;
    exclude?: string[] | null;
  } | null;
};

export type DesktopCloudHistoryChange = {
  path: string;
  action?: "add" | "update" | "delete";
  op?: "added" | "modified" | "deleted";
};

export type DesktopCloudHistoryCommit = {
  commit_id: string;
  who?: string;
  message?: string;
  changes?: DesktopCloudHistoryChange[];
  conflicts?: Array<Record<string, unknown>>;
  root_hash?: string;
  scope_hash?: string;
  scope_path?: string;
  created_at?: string | null;
  audit_detail?: Record<string, unknown> | null;
};

export type DesktopCloudHistory = {
  project_id: string;
  commits: DesktopCloudHistoryCommit[];
  head_commit_id?: string | null;
};

export type DesktopCloudScope = {
  id: string;
  project_id: string;
  name: string;
  path: string;
  exclude: string[];
  mode: "r" | "rw";
  is_root: boolean;
  access_key?: string | null;
  access_key_revoked?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudScopePatch = {
  name?: string;
  exclude?: string[];
  mode?: "r" | "rw";
};

export type DesktopCloudConnector = {
  id: string;
  project_id: string;
  scope_id: string;
  provider: string;
  name: string;
  direction: string;
  config?: Record<string, unknown>;
  oauth_connection_id?: number | null;
  trigger?: Record<string, unknown>;
  status: string;
  access_key?: string | null;
  last_run_at?: string | null;
  last_run_id?: string | null;
  error_message?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudMcpEndpoint = {
  id: string;
  project_id: string;
  path: string | null;
  name: string;
  description?: string | null;
  api_key?: string;
  api_key_hint?: string;
  api_key_revealed?: boolean;
  status: string;
  accesses?: Array<{ path: string; json_path?: string; readonly?: boolean }>;
  config?: Record<string, unknown>;
  tools_config?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DesktopCloudRepoIdentity = {
  project_id: string;
  url: string;
  prompt_template?: string;
  content_initialized?: boolean;
  head_commit_id?: string | null;
  scopes: Array<{
    id: string;
    name: string;
    path: string;
    is_root: boolean;
    access_key?: string | null;
  }>;
};

export type DesktopCloudEmailCheck = {
  exists: boolean;
};

function normalizeSessionApiBase(apiBaseUrl: string | null | undefined): string {
  if (typeof apiBaseUrl === "string" && apiBaseUrl.trim()) {
    return resolveCloudApiBaseUrl(apiBaseUrl);
  }
  return getDesktopCloudApiBaseUrl();
}

export function getDesktopCloudApiBaseUrl(): string {
  try {
    const stored = window.localStorage.getItem(CLOUD_API_BASE_URL_STORAGE_KEY)?.trim();
    if (stored) {
      const normalized = resolveCloudApiBaseUrl(stored);
      if (normalized !== stored.replace(/\/+$/, "")) {
        window.localStorage.setItem(CLOUD_API_BASE_URL_STORAGE_KEY, normalized);
      }
      return normalized;
    }
  } catch {
    // Fall through to env/default.
  }

  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_DESKTOP_CLOUD_API_URL || env?.VITE_CLOUD_API_URL || env?.VITE_API_URL;
  return resolveCloudApiBaseUrl(configured || DEFAULT_CLOUD_API_BASE_URL);
}

export function desktopCloudApiUrl(path: string): string {
  return buildCanonicalCloudApiUrl(path);
}

export function desktopCloudApiBaseUrlFromRemote(remoteUrl: string | null): string | null {
  return cloudApiBaseUrlFromRemote(remoteUrl);
}

export function isCloudSessionForApiBase(
  session: DesktopCloudSession | null | undefined,
  apiBaseUrl?: string | null,
): boolean {
  if (!session) return false;
  return sameCloudApiBaseUrl(session.api_base_url, apiBaseUrl);
}

export function getDesktopCloudWebUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://app.puppyone.ai${normalizedPath}`;
}

export function openCloudApp(path: string): void {
  window.open(getDesktopCloudWebUrl(path), "_blank", "noopener,noreferrer");
}

export async function checkCloudEmail(email: string, apiBaseUrl?: string | null): Promise<DesktopCloudEmailCheck> {
  const payload = await requestPublic<{ exists?: boolean }>("/auth/check-email", {
    method: "POST",
    body: JSON.stringify({ email }),
  }, apiBaseUrl);
  return { exists: Boolean(payload?.exists) };
}

export async function cloudApiRequest<T>(
  path: string,
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  init: RequestInit = {},
  apiBaseUrl?: string | null,
): Promise<T> {
  const requestedApiBase = normalizeSessionApiBase(apiBaseUrl);
  const sessionApiBase = normalizeSessionApiBase(session.api_base_url);
  if (sessionApiBase !== requestedApiBase) {
    const error = new Error(`Sign in to ${formatCloudApiHost(requestedApiBase)} to load this Cloud workspace.`);
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  if (window.puppyoneDesktop?.requestCloudSessionApi) {
    const body = typeof init.body === "string" ? init.body : undefined;
    try {
      return await window.puppyoneDesktop.requestCloudSessionApi({
        apiBaseUrl: requestedApiBase,
        path: path.startsWith("/") ? path : `/${path}`,
        method: init.method ?? "GET",
        headers: normalizeRequestHeaders(init.headers),
        ...(body === undefined ? {} : { body }),
      }) as T;
    } catch (error) {
      const normalized = normalizeCloudBridgeError(error);
      if (isAuthFailure(normalized) && shouldClearCloudSessionForApiBase(apiBaseUrl)) {
        await onSessionChange?.(null);
      }
      throw normalized;
    }
  }

  const error = new Error("Desktop secure Cloud session service is unavailable.");
  (error as Error & { status?: number }).status = 401;
  if (shouldClearCloudSessionForApiBase(apiBaseUrl)) await onSessionChange?.(null);
  throw error;
}

export function listCloudProjects(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudProject[]> {
  return cloudApiRequest<DesktopCloudProject[]>("/projects/", session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudOrganizations(
  session: DesktopCloudSession,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganization[]> {
  return cloudApiRequest<DesktopCloudOrganization[]>("/organizations/", session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudOrganizationMembers(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrgMember[]> {
  return cloudApiRequest<DesktopCloudOrgMember[]>(`/organizations/${orgId}/members`, session, onSessionChange, {}, apiBaseUrl);
}

export function getCloudOrganizationEntitlements(
  session: DesktopCloudSession,
  orgId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudOrganizationEntitlements> {
  return cloudApiRequest<DesktopCloudOrganizationEntitlements>(`/organizations/${orgId}/entitlements`, session, onSessionChange, {}, apiBaseUrl);
}

export function createCloudProject(
  session: DesktopCloudSession,
  name: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudProject> {
  return cloudApiRequest<DesktopCloudProject>("/projects/", session, onSessionChange, {
    method: "POST",
    body: JSON.stringify({ name, seed: false }),
  }, apiBaseUrl);
}

export function getCloudDashboard(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudDashboard> {
  return cloudApiRequest<DesktopCloudDashboard>(`/projects/${projectId}/dashboard`, session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudRoot(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  return listCloudDirectory(session, projectId, "", onSessionChange, apiBaseUrl);
}

export function listCloudDirectory(
  session: DesktopCloudSession,
  projectId: string,
  path = "",
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  return cloudApiRequest<DesktopCloudTree>(
    `/content/${projectId}/ls?path=${encodeURIComponent(path.replace(/^\/+/, ""))}`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  );
}

export function listCloudAccessPointDirectory(
  accessKey: string,
  path = "",
  userEmail?: string | null,
  remoteUrl?: string | null,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudTree> {
  const normalizedPath = path.replace(/^\/+/, "");
  if (window.puppyoneDesktop?.listCloudAccessPointDirectory) {
    return window.puppyoneDesktop.listCloudAccessPointDirectory({
      accessKey,
      path: normalizedPath,
      userEmail: userEmail ?? null,
      remoteUrl: remoteUrl ?? null,
      apiBaseUrl: apiBaseUrl ?? getDesktopCloudApiBaseUrl(),
    });
  }

  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  const query = new URLSearchParams({
    path: normalizedPath,
    include_hidden: "true",
    include_size: "true",
  });

  return requestPublic<DesktopCloudTree>(
    `/ap-fs/ls?${query.toString()}`,
    {
      method: "GET",
      headers,
    },
    desktopCloudApiBaseUrlFromRemote(remoteUrl ?? null) ?? apiBaseUrl,
  );
}

export function getCloudAccessPointSemantics(
  accessKey: string,
  userEmail?: string | null,
  remoteUrl?: string | null,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudAccessPointSemantics> {
  if (window.puppyoneDesktop?.getCloudAccessPointSemantics) {
    return window.puppyoneDesktop.getCloudAccessPointSemantics({
      accessKey,
      userEmail: userEmail ?? null,
      remoteUrl: remoteUrl ?? null,
      apiBaseUrl: apiBaseUrl ?? getDesktopCloudApiBaseUrl(),
    });
  }

  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  return requestPublic<DesktopCloudAccessPointSemantics>(
    "/ap-fs/semantics",
    {
      method: "GET",
      headers,
    },
    desktopCloudApiBaseUrlFromRemote(remoteUrl ?? null) ?? apiBaseUrl,
  );
}

export function getCloudHistory(
  session: DesktopCloudSession,
  projectId: string,
  limit = 20,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudHistory> {
  return cloudApiRequest<DesktopCloudHistory>(`/content/${projectId}/commits?limit=${limit}`, session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudScopes(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope[]> {
  return cloudApiRequest<DesktopCloudScope[]>(`/projects/${projectId}/scopes`, session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudConnectors(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudConnector[]> {
  return cloudApiRequest<DesktopCloudConnector[]>(`/projects/${projectId}/connectors`, session, onSessionChange, {}, apiBaseUrl);
}

export function listCloudMcpEndpoints(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudMcpEndpoint[]> {
  return cloudApiRequest<DesktopCloudMcpEndpoint[]>(
    `/mcp-endpoints?project_id=${encodeURIComponent(projectId)}`,
    session,
    onSessionChange,
    {},
    apiBaseUrl,
  );
}

export function getCloudRepoIdentity(
  session: DesktopCloudSession,
  projectId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudRepoIdentity> {
  return cloudApiRequest<DesktopCloudRepoIdentity>(`/projects/${projectId}/access-point`, session, onSessionChange, {}, apiBaseUrl);
}

export function updateCloudScope(
  session: DesktopCloudSession,
  projectId: string,
  scopeId: string,
  patch: DesktopCloudScopePatch,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope> {
  return cloudApiRequest<DesktopCloudScope>(
    `/projects/${projectId}/scopes/${scopeId}`,
    session,
    onSessionChange,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    apiBaseUrl,
  );
}

export function regenerateCloudScopeKey(
  session: DesktopCloudSession,
  projectId: string,
  scopeId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<DesktopCloudScope> {
  return cloudApiRequest<DesktopCloudScope>(
    `/projects/${projectId}/scopes/${scopeId}/regenerate-key`,
    session,
    onSessionChange,
    { method: "POST", body: JSON.stringify({}) },
    apiBaseUrl,
  );
}

export function deleteCloudScope(
  session: DesktopCloudSession,
  projectId: string,
  scopeId: string,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
): Promise<void> {
  return cloudApiRequest<void>(
    `/projects/${projectId}/scopes/${scopeId}`,
    session,
    onSessionChange,
    { method: "DELETE" },
    apiBaseUrl,
  );
}

async function requestPublic<T>(path: string, init: RequestInit, apiBaseUrl?: string | null): Promise<T> {
  return requestRaw<T>(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  }, apiBaseUrl);
}

function normalizeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function shouldClearCloudSessionForApiBase(apiBaseUrl?: string | null) {
  if (!apiBaseUrl) return true;
  return sameCloudApiBaseUrl(apiBaseUrl, getDesktopCloudApiBaseUrl());
}

async function requestRaw<T = unknown>(path: string, init: RequestInit, apiBaseUrl?: string | null): Promise<T> {
  const normalizedApiBaseUrl = resolveCloudApiBaseUrl(apiBaseUrl || getDesktopCloudApiBaseUrl());
  if (window.puppyoneDesktop?.requestCloudApi) {
    const body = typeof init.body === "string" ? init.body : undefined;
    try {
      return await window.puppyoneDesktop.requestCloudApi({
        apiBaseUrl: normalizedApiBaseUrl,
        path: path.startsWith("/") ? path : `/${path}`,
        method: init.method ?? "GET",
        headers: normalizeRequestHeaders(init.headers),
        ...(body === undefined ? {} : { body }),
      }) as T;
    } catch (error) {
      throw normalizeCloudBridgeError(error);
    }
  }

  const response = await fetch(buildCanonicalCloudApiUrl(path, apiBaseUrl), init);
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(getCloudApiErrorMessage(payload, `Request failed (${response.status})`));
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return (payload && "data" in payload ? payload.data : payload) as T;
}

function getCloudApiErrorMessage(payload: ApiEnvelope<unknown> | null, fallback: string): string {
  const detail = payload?.detail;
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  if (typeof detail === "string" && detail) return detail;
  if (isRecord(detail) && typeof detail.message === "string" && detail.message) return detail.message;
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  return fallback;
}

function isAuthFailure(error: unknown): boolean {
  if (isRecord(error) && error.status === 401) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /invalid or expired token|invalid refresh token|refresh token not found|already used|sign in again|sign in to/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function normalizeCloudBridgeError(error: unknown): Error {
  const original = error instanceof Error ? error.message : String(error);
  const message = original
    .replace(/^Error invoking remote method 'cloud:(?:api-request|session-api-request)':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  const normalized = new Error(message || "Cloud request failed.");
  if (/invalid or expired token|sign in again/i.test(message)) {
    (normalized as Error & { status?: number }).status = 401;
  }
  return normalized;
}

function formatCloudApiHost(apiBaseUrl: string) {
  return formatCanonicalCloudApiHost(apiBaseUrl);
}
