/**
 * Tree API Client
 *
 * Path-based file system API — all nodes identified by path (e.g. "docs/readme.md").
 * Backend: /api/v1/content/{projectId}/...
 * All responses wrapped in { code: 0, message: "success", data: {...} }
 */

import { apiRequest, getApiAccessToken } from './apiClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

// === Types ===

export type NodeType = 'folder' | 'json' | 'markdown' | 'file';

export const NATIVE_TYPES = ['folder', 'json', 'markdown', 'file'] as const;
export type NativeType = (typeof NATIVE_TYPES)[number];

export interface TreeEntry {
  name: string;
  path: string;
  type: NodeType;
  content_hash: string | null;
  size_bytes: number;
  mime_type: string | null;
  children_count: number | null;
}

export interface TreeStatResponse {
  path: string;
  type: NodeType;
  name: string;
  content_hash: string | null;
  size_bytes?: number;
  mime_type?: string | null;
  children_count?: number | null;
  exists: boolean;
}

export interface TreeCatResponse {
  path: string;
  type: NodeType;
  content: any | null;
  content_text: string | null;
  content_hash: string | null;
}

export interface TreeWriteResponse {
  path: string;
  content_hash: string;
  commit_id: string;
}

export interface TreeMvResponse {
  old_path: string;
  new_path: string;
}

export interface TreeMkdirResponse {
  path: string;
}

export interface TreeRmResponse {
  path: string;
  permanent: boolean;
}

export interface TreeRestoreResponse {
  path: string;
  restored_to: string;
}

// NodeInfo compatibility type — used across the frontend
export interface NodeInfo {
  name: string;
  path: string;
  type: NodeType;
  content_hash: string | null;
  size_bytes: number;
  mime_type: string | null;
  children_count: number | null;

  // Computed compatibility fields (derived from path)
  id: string;          // = path (for backward compat)
  mut_path: string;    // = "/" + path
  parent_id: string | null; // parent folder path or null
  project_id: string;  // set by caller

  // Unused legacy fields (always defaults)
  is_synced: boolean;
  sync_source: string | null;
  sync_url: string | null;
  sync_status: 'not_connected';
  sync_config: null;
  last_synced_at: null;
  preview_snippet: null;
  created_at: string;
  updated_at: string;
}

export interface NodeDetail extends NodeInfo {
  s3_key: string | null;
  permissions: {
    public: boolean;
    inherit: boolean;
    agents: string[];
    users: string[];
  };
}

// Response types
export interface NodeListResponse {
  nodes: NodeInfo[];
  total: number;
}

// === Unwrap helper ===
// apiRequest already unwraps { code, message, data } envelope.
// treeRequest is a simple alias for consistency.

async function treeRequest<T>(url: string, options?: RequestInit): Promise<T> {
  return apiRequest<T>(url, options);
}

// === TreeEntry → NodeInfo adapter ===

export function entryToNodeInfo(entry: TreeEntry, projectId: string): NodeInfo {
  const parentPath = entry.path.includes('/')
    ? entry.path.substring(0, entry.path.lastIndexOf('/'))
    : null;
  return {
    ...entry,
    id: entry.path,
    mut_path: '/' + entry.path,
    parent_id: parentPath,
    project_id: projectId,
    is_synced: false,
    sync_source: null,
    sync_url: null,
    sync_status: 'not_connected',
    sync_config: null,
    last_synced_at: null,
    preview_snippet: null,
    created_at: '',
    updated_at: '',
  };
}

// === Helper Functions ===

export function isFolder(node: { type: string }): boolean {
  return node.type === 'folder';
}

export function isJson(node: { type: string }): boolean {
  return node.type === 'json';
}

export function isMarkdown(node: { type: string }): boolean {
  return node.type === 'markdown';
}

export function isFile(node: { type: string }): boolean {
  return node.type === 'file';
}

export function isSynced(): boolean {
  return false;
}

export function hasContent(node: { content_hash?: string | null }): boolean {
  return node.content_hash !== null && node.content_hash !== undefined;
}

// === Core Tree API Functions ===

/**
 * List directory entries at the given path.
 * GET /api/v1/content/{projectId}/ls?path=...
 */
export async function listDir(
  projectId: string,
  path: string = ''
): Promise<NodeListResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const data = await treeRequest<{ entries: TreeEntry[] }>(
    `/api/v1/content/${projectId}/ls?${params.toString()}`
  );
  const nodes = (data.entries || []).map(e => entryToNodeInfo(e, projectId));
  return { nodes, total: nodes.length };
}

/**
 * Backward-compatible alias — calls listDir under the hood.
 */
export async function listNodes(
  projectId: string,
  parentPath?: string | null
): Promise<NodeListResponse> {
  return listDir(projectId, parentPath ?? '');
}

/**
 * Get file content.
 * GET /api/v1/content/{projectId}/cat?path=...
 */
export async function readFile(
  projectId: string,
  path: string
): Promise<TreeCatResponse> {
  const params = new URLSearchParams({ path });
  return treeRequest<TreeCatResponse>(
    `/api/v1/content/${projectId}/cat?${params.toString()}`
  );
}

/**
 * Fetch raw file bytes as a Blob (for images, binary files, etc.).
 * GET /api/v1/content/{projectId}/raw?path=...
 */
export async function fetchRawBlob(
  projectId: string,
  path: string
): Promise<Blob> {
  const token = await getApiAccessToken();
  const params = new URLSearchParams({ path });
  const res = await fetch(
    `${API_BASE_URL}/api/v1/content/${projectId}/raw?${params}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) throw new Error(`Failed to fetch raw file: ${res.status}`);
  return res.blob();
}

/**
 * Stat a path (check existence and type).
 * GET /api/v1/content/{projectId}/stat?path=...
 */
export async function stat(
  projectId: string,
  path: string
): Promise<TreeStatResponse> {
  const params = new URLSearchParams({ path });
  return treeRequest<TreeStatResponse>(
    `/api/v1/content/${projectId}/stat?${params.toString()}`
  );
}

/**
 * Recursive tree listing.
 * GET /api/v1/content/{projectId}/tree?path=...&max_depth=...
 */
export async function treeList(
  projectId: string,
  path: string = '',
  maxDepth: number = -1,
): Promise<TreeEntry[]> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (maxDepth >= 0) params.set('max_depth', String(maxDepth));
  const data = await treeRequest<{ entries: TreeEntry[] }>(
    `/api/v1/content/${projectId}/tree?${params.toString()}`
  );
  return data.entries || [];
}

/**
 * Write file content.
 * POST /api/v1/content/{projectId}/write
 */
export async function writeFile(
  projectId: string,
  path: string,
  content: any,
  nodeType: NodeType = 'json',
  message?: string,
  baseCommitId?: string
): Promise<TreeWriteResponse> {
  const body: Record<string, any> = { path, content, node_type: nodeType };
  if (message) body.message = message;
  if (baseCommitId !== undefined) body.base_commit_id = baseCommitId;
  return treeRequest<TreeWriteResponse>(`/api/v1/content/${projectId}/write`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Create directory.
 * POST /api/v1/content/{projectId}/mkdir
 */
export async function mkdir(
  projectId: string,
  path: string
): Promise<TreeMkdirResponse> {
  return treeRequest<TreeMkdirResponse>(`/api/v1/content/${projectId}/mkdir`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/**
 * Move/rename a file or folder.
 * POST /api/v1/content/{projectId}/mv
 */
export async function moveFile(
  projectId: string,
  oldPath: string,
  newPath: string,
  message?: string
): Promise<TreeMvResponse> {
  const body: Record<string, any> = { old_path: oldPath, new_path: newPath };
  if (message) body.message = message;
  return treeRequest<TreeMvResponse>(`/api/v1/content/${projectId}/mv`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Remove file or folder.
 * POST /api/v1/content/{projectId}/rm
 */
export async function removeFile(
  projectId: string,
  path: string,
  permanent: boolean = false
): Promise<TreeRmResponse> {
  return treeRequest<TreeRmResponse>(`/api/v1/content/${projectId}/rm`, {
    method: 'POST',
    body: JSON.stringify({ path, permanent }),
  });
}

/**
 * Restore from trash.
 * POST /api/v1/content/{projectId}/restore
 */
export async function restoreFile(
  projectId: string,
  trashPath: string,
  originalPath: string
): Promise<TreeRestoreResponse> {
  return treeRequest<TreeRestoreResponse>(
    `/api/v1/content/${projectId}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ trash_path: trashPath, original_path: originalPath }),
    }
  );
}

/**
 * List trash entries.
 * GET /api/v1/content/{projectId}/trash
 */
export async function listTrash(
  projectId: string
): Promise<TreeEntry[]> {
  const data = await treeRequest<{ entries: TreeEntry[] }>(
    `/api/v1/content/${projectId}/trash`
  );
  return data.entries || [];
}

// === Backward-compatible aliases ===

/**
 * Get node detail by path — compatibility shim.
 */
export async function getNode(
  path: string,
  projectId: string
): Promise<NodeDetail> {
  const s = await stat(projectId, path);
  return {
    name: s.name,
    path: s.path,
    type: s.type,
    content_hash: s.content_hash,
    size_bytes: 0,
    mime_type: null,
    children_count: null,
    id: s.path,
    mut_path: '/' + s.path,
    parent_id: s.path.includes('/') ? s.path.substring(0, s.path.lastIndexOf('/')) : null,
    project_id: projectId,
    is_synced: false,
    sync_source: null,
    sync_url: null,
    sync_status: 'not_connected',
    sync_config: null,
    last_synced_at: null,
    preview_snippet: null,
    created_at: '',
    updated_at: '',
    s3_key: null,
    permissions: { public: false, inherit: true, agents: [], users: [] },
  };
}

/**
 * Create folder — backward-compatible wrapper.
 */
export async function createFolder(
  name: string,
  projectId: string,
  parentPath?: string | null
): Promise<NodeDetail> {
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  await mkdir(projectId, fullPath);
  return getNode(fullPath, projectId);
}

/**
 * Create JSON node — backward-compatible wrapper.
 */
export async function createJsonNode(
  name: string,
  projectId: string,
  content: any,
  parentPath?: string | null
): Promise<NodeDetail> {
  const fileName = name.endsWith('.json') ? name : name;
  const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;
  await writeFile(projectId, fullPath, content, 'json');
  return getNode(fullPath, projectId);
}

/**
 * Create Markdown node — backward-compatible wrapper.
 */
export async function createMarkdownNode(
  name: string,
  projectId: string,
  content: string = '',
  parentPath?: string | null
): Promise<NodeDetail> {
  const fileName = name.endsWith('.md') ? name : name;
  const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;
  await writeFile(projectId, fullPath, content, 'markdown');
  return getNode(fullPath, projectId);
}

/**
 * Delete node — backward-compatible wrapper.
 */
export async function deleteNode(path: string, projectId: string): Promise<void> {
  await removeFile(projectId, path);
}

/**
 * Update node — backward-compatible wrapper for rename/content update.
 */
export async function updateNode(
  path: string,
  projectId: string,
  updates: { name?: string; content_json?: any; content_text?: string }
): Promise<NodeDetail> {
  if (updates.name) {
    const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${updates.name}` : updates.name;
    await moveFile(projectId, path, newPath);
    return getNode(newPath, projectId);
  }
  if (updates.content_json !== undefined) {
    await writeFile(projectId, path, updates.content_json, 'json');
  }
  if (updates.content_text !== undefined) {
    await writeFile(projectId, path, updates.content_text, 'markdown');
  }
  return getNode(path, projectId);
}

/**
 * Move node — backward-compatible wrapper.
 */
export async function moveNode(
  nodePath: string,
  projectId: string,
  newParentPath: string | null
): Promise<NodeDetail> {
  const name = nodePath.includes('/') ? nodePath.substring(nodePath.lastIndexOf('/') + 1) : nodePath;
  const newPath = newParentPath ? `${newParentPath}/${name}` : name;
  await moveFile(projectId, nodePath, newPath);
  return getNode(newPath, projectId);
}

// === Node Content (read via cat endpoint) ===

export interface NodeContentResponse {
  path: string;
  node_type: string;
  content_hash: string | null;
  content_json: any | null;
  content_text: string | null;
  download_url: string | null;
  size_bytes: number;
}

export async function getNodeContent(
  path: string,
  projectId: string
): Promise<NodeContentResponse> {
  const catResult = await readFile(projectId, path);
  return {
    path: path,
    node_type: catResult.type,
    content_hash: catResult.content_hash,
    content_json: catResult.content,
    content_text: catResult.content_text,
    download_url: null,
    size_bytes: 0,
  };
}

// === Commit History API ===
// These types match the Mut-Native commit-based model.
// The backend returns commit history from mut_commits table.
// Commits are identified by opaque 16-hex `commit_id` strings — we no longer
// expose monotonic integer versions on the wire.

export interface FileVersionInfo {
  commit_id: string;
  who: string;
  message: string;
  changes: MutCommitChange[];
  conflicts: MutCommitConflict[];
  root_hash: string;
  scope_path: string;
  created_at: string | null;
}

/**
 * Response shape of `GET /content/{pid}/commit-content`.
 *
 * The backend mirrors the `cat` endpoint's shape: for JSON files it
 * parses the bytes and returns them under `content`; for everything
 * else it returns raw decoded bytes under `content_text`. Fields are
 * mutually exclusive — the unset one is omitted, not null. The earlier
 * version of this interface invented `content_json` / `who` / `message`
 * / `changes` / `root_hash` fields that the endpoint never returned;
 * the result was that JSON-file diffs always fell into the "Binary
 * file" placeholder branch on the History page.
 */
export interface FileVersionDetail {
  path: string;
  commit_id: string;
  type: string;
  content?: any;
  content_text?: string | null;
}

export interface VersionHistoryResponse {
  project_id: string;
  path: string | null;
  head_commit_id: string;
  root_hash: string;
  commits: FileVersionInfo[];
  total: number;
}

export interface DiffItem {
  path: string;
  old_value: any | null;
  new_value: any | null;
  change_type: string;
}

export interface DiffResponse {
  project_id: string;
  from_commit_id: string;
  to_commit_id: string;
  changes: DiffItem[];
}

export interface RollbackResponse {
  project_id: string;
  new_commit_id: string;
  rolled_back_to: string;
}

export async function getVersionHistory(
  filePath: string,
  projectId: string,
  limit: number = 50,
  sinceCommitId: string = ''
): Promise<VersionHistoryResponse> {
  const params = new URLSearchParams({
    path: filePath,
    limit: String(limit),
    since_commit_id: sinceCommitId,
  });
  return treeRequest<VersionHistoryResponse>(
    `/api/v1/content/${projectId}/commits?${params}`
  );
}

export async function getVersionContent(
  filePath: string,
  commitId: string,
  projectId: string
): Promise<FileVersionDetail> {
  const params = new URLSearchParams({
    path: filePath,
    commit_id: commitId,
  });
  return treeRequest<FileVersionDetail>(
    `/api/v1/content/${projectId}/commit-content?${params}`
  );
}

export async function rollbackToVersion(
  filePath: string,
  commitId: string,
  projectId: string
): Promise<RollbackResponse> {
  return treeRequest<RollbackResponse>(
    `/api/v1/content/${projectId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ path: filePath, target_commit_id: commitId }),
    }
  );
}

export async function diffVersions(
  filePath: string,
  fromCommitId: string,
  toCommitId: string,
  projectId: string
): Promise<DiffResponse> {
  const params = new URLSearchParams({
    path: filePath,
    from_commit_id: fromCommitId,
    to_commit_id: toCommitId,
  });
  return treeRequest<DiffResponse>(
    `/api/v1/content/${projectId}/diff?${params}`
  );
}

// === Project-level Mut Commit History ===

export interface MutCommitChange {
  path: string;
  op: string;
}

export interface MutCommitConflict {
  path: string;
  strategy: string;
  detail?: string;
  kept?: string;
}

export interface MutCommitInfo {
  commit_id: string;
  root_hash: string;
  scope_path: string;
  who: string;
  message: string;
  changes: MutCommitChange[];
  conflicts: MutCommitConflict[];
  created_at: string | null;
}

export interface MutProjectHistoryResponse {
  project_id: string;
  head_commit_id: string;
  root_hash: string;
  commits: MutCommitInfo[];
  total: number;
}

export async function getProjectHistory(
  projectId: string,
  limit: number = 50,
  sinceCommitId: string = ''
): Promise<MutProjectHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    since_commit_id: sinceCommitId,
  });
  return treeRequest<MutProjectHistoryResponse>(
    `/api/v1/content/${projectId}/commits?${params}`
  );
}

// === Audit Logs API ===
// Commit identity for audit entries lives inside `metadata` — we no longer
// denormalize it onto top-level integer columns.

export interface AuditLogItem {
  id: number;
  action: string;
  path: string;
  operator_type: string;
  operator_id: string | null;
  status: string | null;
  strategy: string | null;
  conflict_details: string | null;
  metadata: Record<string, any> | null;
  created_at: string | null;
}

export interface AuditLogListResponse {
  path: string;
  logs: AuditLogItem[];
  total: number;
}

export async function getNodeAuditLogs(
  filePath: string,
  projectId: string,
  limit: number = 50,
  offset: number = 0
): Promise<AuditLogListResponse> {
  const params = new URLSearchParams({
    path: filePath,
    project_id: projectId,
    limit: String(limit),
    offset: String(offset),
  });
  return treeRequest<AuditLogListResponse>(
    `/api/v1/content/${projectId}/audit-logs?${params}`
  );
}

// === Sync Changelog API ===

export interface SyncChangelogItem {
  id: number;
  project_id: string;
  path: string;
  action: string;
  node_type: string | null;
  version: number;
  hash: string | null;
  size_bytes: number;
  folder_id: string | null;
  filename: string | null;
  created_at: string | null;
}

export interface SyncChangelogResponse {
  entries: SyncChangelogItem[];
  cursor: number;
  has_more: boolean;
}

export async function getSyncChangelog(
  projectId: string,
  cursor: number = 0,
  limit: number = 100
): Promise<SyncChangelogResponse> {
  const params = new URLSearchParams({
    project_id: projectId,
    cursor: String(cursor),
    limit: String(limit),
  });
  return apiRequest<SyncChangelogResponse>(`/api/v1/sync/changelog?${params}`);
}

// === Batch create (backward compat — now calls write/mkdir for each) ===

export interface BulkCreateNodeItem {
  temp_id: string;
  name: string;
  type: 'folder' | 'json' | 'markdown' | 'file';
  parent_temp_id: string | null;
  content?: any;
}

export interface BulkCreateResultItem {
  temp_id: string;
  path: string;
  name: string;
  type: NodeType;
}

export interface BulkCreateResponse {
  created: BulkCreateResultItem[];
  total: number;
}

export async function bulkCreateNodes(
  projectId: string,
  nodes: BulkCreateNodeItem[],
  parentPath?: string | null
): Promise<BulkCreateResponse> {
  const results: BulkCreateResultItem[] = [];
  const tempIdToPath = new Map<string, string>();

  for (const node of nodes) {
    let parentDir = parentPath || '';
    if (node.parent_temp_id) {
      parentDir = tempIdToPath.get(node.parent_temp_id) || parentDir;
    }
    const fullPath = parentDir ? `${parentDir}/${node.name}` : node.name;

    if (node.type === 'folder') {
      await mkdir(projectId, fullPath);
    } else {
      await writeFile(projectId, fullPath, node.content ?? (node.type === 'json' ? {} : ''), node.type);
    }

    tempIdToPath.set(node.temp_id, fullPath);
    results.push({
      temp_id: node.temp_id,
      path: fullPath,
      name: node.name,
      type: node.type,
    });
  }

  return { created: results, total: results.length };
}

// === Deprecated stubs (no-op, kept for import compat) ===

/** @deprecated Use stat() instead */
export async function getNodesBatch(paths: string[], projectId: string): Promise<NodeDetail[]> {
  const results = await Promise.all(
    paths.map(p => getNode(p, projectId).catch(() => null))
  );
  return results.filter((n): n is NodeDetail => n !== null);
}

/** @deprecated No longer needed — content comes from cat endpoint */
export async function getDownloadUrl(): Promise<{ download_url: string; expires_in: number }> {
  throw new Error('getDownloadUrl is removed. Use readFile() or cat endpoint instead.');
}

/** @deprecated Use stat() instead */
export async function getNodeByMutPath(
  projectId: string,
  mutPath: string
): Promise<NodeDetail> {
  const cleanPath = mutPath.startsWith('/') ? mutPath.slice(1) : mutPath;
  return getNode(cleanPath, projectId);
}

/** @deprecated Use writeFile() via the tree/write endpoint */
export async function prepareUpload(): Promise<never> {
  throw new Error('prepareUpload is removed. Use writeFile() instead.');
}
