/**
 * Frontend client for the access-point-redesign-2026-05-02 endpoints.
 *
 * Mounted at:
 *   /api/v1/projects/{pid}/scopes      — repo_scopes CRUD
 *   /api/v1/projects/{pid}/connectors  — connectors CRUD (per scope)
 *   /api/v1/projects/{pid}/access-point — repo identity (URL + prompt + scope keys)
 *   /api/v1/projects/{pid}/permissions — team-plan per-user permissions
 *
 * Replaces the legacy `/api/v1/access` and `/api/v1/sync/*` paths for the
 * redesign UI. Cli + agent are auto-created per scope by a DB trigger and
 * cannot be created via the API (the backend returns 400 if attempted).
 */

import { get, post, patch, del } from '@/lib/apiClient';

// ── Types (mirror backend src/repo/schemas.py) ──────────────────────────

export type ScopeMode = 'r' | 'rw';
export type ConnectorDirection = 'bidirectional' | 'inbound' | 'outbound';
export type ConnectorStatus = 'active' | 'paused' | 'syncing' | 'error';

export interface RepoScope {
  id: string;
  project_id: string;
  name: string;
  path: string;        // canonical: '' for root, no leading/trailing /
  exclude: string[];
  mode: ScopeMode;
  is_root: boolean;
  access_key?: string | null;
  access_key_revoked?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Connector {
  id: string;
  project_id: string;
  scope_id: string;
  provider: string;            // 'cli' | 'agent' | 'notion' | 'gmail' | 'github' | ...
  name: string;
  direction: ConnectorDirection;
  config: Record<string, unknown>;
  oauth_connection_id: number | null;
  trigger: Record<string, unknown>;
  status: ConnectorStatus;
  last_run_at: string | null;
  last_run_id: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoIdentity {
  project_id: string;
  url: string;                 // https://<api>/api/v1/mut/<project_id>
  prompt_template: string;
  scopes: Array<{
    id: string;
    name: string;
    path: string;
    is_root: boolean;
    access_key?: string | null;
  }>;
}

export interface ConnectorRun {
  id: string;
  connector_id: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

// ── Scopes ──────────────────────────────────────────────────────────────

export async function listScopes(projectId: string): Promise<RepoScope[]> {
  return (await get<RepoScope[]>(`/api/v1/projects/${projectId}/scopes`)) || [];
}

export async function createScope(
  projectId: string,
  body: { name: string; path: string; exclude?: string[]; mode?: ScopeMode },
): Promise<RepoScope> {
  return post<RepoScope>(`/api/v1/projects/${projectId}/scopes`, body);
}

export async function updateScope(
  projectId: string,
  scopeId: string,
  body: { name?: string; exclude?: string[]; mode?: ScopeMode },
): Promise<RepoScope> {
  return patch<RepoScope>(`/api/v1/projects/${projectId}/scopes/${scopeId}`, body);
}

export async function deleteScope(projectId: string, scopeId: string): Promise<void> {
  await del(`/api/v1/projects/${projectId}/scopes/${scopeId}`);
}

export async function regenerateScopeKey(
  projectId: string,
  scopeId: string,
): Promise<RepoScope> {
  return post<RepoScope>(
    `/api/v1/projects/${projectId}/scopes/${scopeId}/regenerate-key`,
    {},
  );
}

// ── Connectors ──────────────────────────────────────────────────────────

export async function listConnectors(
  projectId: string,
  filter?: { scopeId?: string; provider?: string; direction?: string },
): Promise<Connector[]> {
  const qs = new URLSearchParams();
  if (filter?.scopeId) qs.set('scope_id', filter.scopeId);
  if (filter?.provider) qs.set('provider', filter.provider);
  if (filter?.direction) qs.set('direction', filter.direction);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return (await get<Connector[]>(`/api/v1/projects/${projectId}/connectors${suffix}`)) || [];
}

export interface CreateConnectorBody {
  scope_id: string;
  provider: string;
  direction: ConnectorDirection;
  name?: string;
  config?: Record<string, unknown>;
  oauth_connection_id?: number | null;
  trigger?: { type: 'manual' | 'scheduled' | 'on_change'; config?: Record<string, unknown> };
}

export async function createConnector(
  projectId: string,
  body: CreateConnectorBody,
): Promise<Connector> {
  return post<Connector>(`/api/v1/projects/${projectId}/connectors`, body);
}

export async function updateConnector(
  projectId: string,
  connectorId: string,
  body: Partial<CreateConnectorBody> & { status?: 'active' | 'paused' },
): Promise<Connector> {
  return patch<Connector>(
    `/api/v1/projects/${projectId}/connectors/${connectorId}`,
    body,
  );
}

export async function deleteConnector(
  projectId: string,
  connectorId: string,
): Promise<void> {
  await del(`/api/v1/projects/${projectId}/connectors/${connectorId}`);
}

export async function runConnectorNow(
  projectId: string,
  connectorId: string,
): Promise<{ run_id: string | null }> {
  return post<{ run_id: string | null }>(
    `/api/v1/projects/${projectId}/connectors/${connectorId}/run`,
    {},
  );
}

/**
 * Pause a connector. Hits the dedicated `POST /:id/pause` endpoint
 * (rather than `PATCH … {status:"paused"}`) so the backend can run
 * any side-effects beyond a column write — e.g. cancel in-flight
 * scheduled runs.
 */
export async function pauseConnector(
  projectId: string,
  connectorId: string,
): Promise<void> {
  await post(`/api/v1/projects/${projectId}/connectors/${connectorId}/pause`, {});
}

/**
 * Resume a paused connector. Counterpart to {@link pauseConnector}.
 */
export async function resumeConnector(
  projectId: string,
  connectorId: string,
): Promise<void> {
  await post(`/api/v1/projects/${projectId}/connectors/${connectorId}/resume`, {});
}

// ── Repo identity ───────────────────────────────────────────────────────

export async function getRepoIdentity(projectId: string): Promise<RepoIdentity> {
  return get<RepoIdentity>(`/api/v1/projects/${projectId}/access-point`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Match a URL path to a scope. Per the redesign Q1 decision (2026-05-03), a
 * folder shows the connectors of *its exact-match scope* — no parent-child
 * inheritance. If no scope matches the path, returns null and the caller
 * should render an empty state, NOT fall back to the root scope.
 *
 * `urlPath` is the canonical path used by mut_scope_state and repo_scopes:
 * empty string for root; otherwise no leading/trailing slashes, no `//`.
 */
export function matchScopeForPath(
  urlPath: string,
  scopes: readonly RepoScope[],
): RepoScope | null {
  const normalized = urlPath.replaceAll(/^\/+|\/+$/g, '').replaceAll(/\/+/g, '/');
  return scopes.find((s) => s.path === normalized) ?? null;
}

/**
 * Test whether a node path falls within a scope's boundary, i.e. the node
 * is the scope folder itself or a descendant of it. Used by the
 * scope-aware drag-drop guard in agent / integration setup forms — the
 * UX rule (per the redesign Q1 decision 2026-05-04) is that an agent
 * bound to scope `/folder1` may only attach folders under `/folder1/...`,
 * never `/folder2/...`. Out-of-scope drops should redirect the user to
 * the parent scope.
 *
 * Both arguments use the canonical path form: empty string for root, no
 * leading/trailing slashes, single-slash separators. Root scope (`''`)
 * is permissive — every node belongs to it.
 */
export function isWithinScope(nodePath: string, scopePath: string): boolean {
  const normNode = (nodePath || '').replaceAll(/^\/+|\/+$/g, '').replaceAll(/\/+/g, '/');
  const normScope = (scopePath || '').replaceAll(/^\/+|\/+$/g, '').replaceAll(/\/+/g, '/');
  if (normScope === '') return true;
  if (normNode === normScope) return true;
  return normNode.startsWith(`${normScope}/`);
}

/**
 * Sort connectors so cli + agent (DB-trigger built-ins) come first,
 * then everything else in stable insertion order.
 */
export const BUILTIN_PROVIDERS = ['cli', 'agent'] as const;

export function sortConnectorsBuiltinFirst(connectors: readonly Connector[]): Connector[] {
  const order = (c: Connector) => {
    if (c.provider === 'cli') return 0;
    if (c.provider === 'agent') return 1;
    return 2;
  };
  return [...connectors].sort((a, b) => order(a) - order(b) || a.created_at.localeCompare(b.created_at));
}
