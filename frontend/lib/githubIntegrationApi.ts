/**
 * GitHub Integration API client.
 *
 * Wraps the per-project endpoints under
 * ``/api/v1/projects/{projectId}/github`` (JWT-gated) plus the public
 * webhook URL builder. Mirrors the Pydantic schemas in
 * ``backend/src/repo/github_integration/schemas.py``.
 *
 * Webhook receipts (``POST /api/v1/integrations/github/webhook``) are
 * never called from the browser — GitHub itself calls them. We expose
 * a builder so the integrations UI can show the user the URL to paste
 * into GitHub repo settings.
 */

import { get, post, patch, del } from './apiClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

// ── Shared enums ──────────────────────────────────────

export type SyncDirection = 'import' | 'export';
export type SyncStatus = 'pending' | 'success' | 'failed' | 'conflict';

// ── Integration (binding) ─────────────────────────────

export interface GithubIntegrationCreate {
  oauth_connection_id: number;
  github_repo_owner: string;
  github_repo_name: string;
  default_branch?: string;
  auto_import?: boolean;
  /** Required when ``auto_import`` is true. The backend rejects the
   *  combo otherwise. */
  webhook_secret?: string | null;
}

export interface GithubIntegrationUpdate {
  default_branch?: string;
  auto_import?: boolean;
  webhook_secret?: string | null;
}

export interface GithubIntegrationStatus {
  id: string;
  project_id: string;
  oauth_connection_id: number | null;
  github_repo_owner: string;
  github_repo_name: string;
  default_branch: string;
  auto_import: boolean;
  /** True iff the backend has a stored webhook_secret. The value
   *  itself never leaves the server after ``connect``. */
  has_webhook_secret: boolean;
  last_imported_sha: string | null;
  last_imported_at: string | null;
  last_exported_sha: string | null;
  last_exported_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Repo discovery (for the picker) ───────────────────

export interface GithubRepoSummary {
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
}

export interface GithubRepoList {
  repos: GithubRepoSummary[];
}

// ── Branch discovery (drives the connect-form dropdown) ──

export interface GithubBranchSummary {
  name: string;
  sha: string;
  protected: boolean;
  /** True for the repo's default branch — picker pre-selects this. */
  is_default: boolean;
}

export interface GithubBranchList {
  repo_owner: string;
  repo_name: string;
  branches: GithubBranchSummary[];
}

// ── Manual sync trigger ───────────────────────────────

export interface GithubImportRequest {
  /** Override the binding's ``default_branch`` for this run. Empty /
   *  undefined uses the binding default. */
  branch?: string | null;
  /** Skip the local-changes conflict gate. Default ``false`` (i.e.
   *  refuse to overwrite). */
  force?: boolean;
}

export interface GithubExportRequest {
  branch?: string | null;
  /** Override the auto-generated ``Sync from Puppyone <commit>`` message. */
  message?: string | null;
}

export interface GithubSyncRunResult {
  status: SyncStatus;
  direction: SyncDirection;
  git_sha: string | null;
  mut_commit_id: string | null;
  files_changed: number | null;
  error_message?: string | null;
}

// ── Sync log ──────────────────────────────────────────

export interface GithubSyncLogEntry {
  id: string;
  integration_id: string;
  direction: SyncDirection;
  git_sha: string | null;
  mut_commit_id: string | null;
  status: SyncStatus;
  error_message: string | null;
  files_changed: number | null;
  created_at: string;
}

export interface GithubSyncLogList {
  integration_id: string;
  entries: GithubSyncLogEntry[];
  total: number;
}

// ── Endpoints ─────────────────────────────────────────

function _projectBase(projectId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/github`;
}

/**
 * Get the current project↔repo binding for *projectId*. Returns
 * ``null`` when the project has no GitHub integration yet.
 *
 * Distinct from ``oauthApi.getGithubStatus`` — that one reports the
 * *user account*'s GitHub OAuth status; this one reports the
 * *project*'s repo binding.
 */
export function getGithubBinding(projectId: string): Promise<GithubIntegrationStatus | null> {
  return get<GithubIntegrationStatus | null>(`${_projectBase(projectId)}/status`);
}

/**
 * Create or replace the project↔repo binding. Throws on validation
 * errors (e.g. ``auto_import=true`` without ``webhook_secret``).
 */
export function connectGithubRepo(
  projectId: string,
  payload: GithubIntegrationCreate,
): Promise<GithubIntegrationStatus> {
  return post<GithubIntegrationStatus>(`${_projectBase(projectId)}/connect`, payload);
}

export function updateGithubBinding(
  projectId: string,
  payload: GithubIntegrationUpdate,
): Promise<GithubIntegrationStatus> {
  return patch<GithubIntegrationStatus>(_projectBase(projectId), payload);
}

export function disconnectGithubRepo(projectId: string): Promise<void> {
  return del<void>(_projectBase(projectId));
}

/**
 * List the OAuth user's GitHub repositories. ``oauthConnectionId``
 * comes from the user's GitHub OAuth row in
 * ``oauth_connections``; the repo picker UI must drive the connect
 * flow before there's a binding to read the id from, hence why it's a
 * query param rather than implicit on the integration row.
 */
export function listGithubRepos(
  projectId: string,
  oauthConnectionId: number,
): Promise<GithubRepoList> {
  const qs = new URLSearchParams({
    oauth_connection_id: String(oauthConnectionId),
  });
  return get<GithubRepoList>(`${_projectBase(projectId)}/repos?${qs}`);
}

/**
 * List branches for a (owner, repo) pair so the connect-form can
 * populate its dropdown. Returns branches with ``is_default=true``
 * flagging the GitHub-side default branch (not necessarily the same as
 * ``projects.bound_git_branch``).
 */
export function listGithubBranches(
  projectId: string,
  oauthConnectionId: number,
  repoOwner: string,
  repoName: string,
): Promise<GithubBranchList> {
  const qs = new URLSearchParams({
    oauth_connection_id: String(oauthConnectionId),
    repo_owner: repoOwner,
    repo_name: repoName,
  });
  return get<GithubBranchList>(`${_projectBase(projectId)}/branches?${qs}`);
}

export function importGithubBranch(
  projectId: string,
  payload: GithubImportRequest = {},
): Promise<GithubSyncRunResult> {
  return post<GithubSyncRunResult>(`${_projectBase(projectId)}/import`, payload);
}

export function exportGithubBranch(
  projectId: string,
  payload: GithubExportRequest = {},
): Promise<GithubSyncRunResult> {
  return post<GithubSyncRunResult>(`${_projectBase(projectId)}/export`, payload);
}

export function listGithubSyncLog(
  projectId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<GithubSyncLogList> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
  const suffix = qs.toString() ? `?${qs}` : '';
  return get<GithubSyncLogList>(`${_projectBase(projectId)}/sync-log${suffix}`);
}

// ── Webhook URL helper ────────────────────────────────

/**
 * The public URL the user must paste into their GitHub repo's
 * Settings → Webhooks page. Puppyone mounts a single receiver for all
 * deliveries; the body identifies the project by repo coords.
 */
export function githubWebhookUrl(): string {
  return `${API_BASE_URL.replace(/\/$/, '')}/api/v1/integrations/github/webhook`;
}
