import {
  cloudApiRequest,
  type DesktopCloudSession,
  type MutableSessionHandler,
} from "./cloudApi";

export type DesktopCloudHistoryChange = {
  path: string;
  action?: "add" | "update" | "delete";
  op?: "added" | "modified" | "deleted";
};

export type DesktopCloudHistoryCommit = {
  commit_id: string;
  parent_ids: string[];
  who: string;
  message: string;
  changes: DesktopCloudHistoryChange[];
  changes_loaded?: boolean;
  conflicts: Array<Record<string, unknown>>;
  root_hash: string;
  scope_hash: string;
  scope_path: string;
  created_at: string | null;
  audit_detail: Record<string, unknown> | null;
};

export type DesktopCloudHistoryRef = {
  ref_name: string;
  ref_type: "branch" | "tag";
  commit_id: string;
};

export type DesktopCloudHistory = {
  project_id: string;
  commits: DesktopCloudHistoryCommit[];
  topology_available: boolean;
  head_commit_id: string | null;
  refs: DesktopCloudHistoryRef[];
  refs_included: boolean;
  snapshot_id: string;
  next_cursor: string | null;
  has_more: boolean;
  total: number;
  graph_health: "complete" | "degraded";
  unreadable_commit_ids: string[];
};

export async function getCloudHistory(
  session: DesktopCloudSession,
  projectId: string,
  limit = 20,
  onSessionChange?: MutableSessionHandler,
  apiBaseUrl?: string | null,
  cursor?: string | null,
  options: { summary?: boolean; signal?: AbortSignal } = {},
): Promise<DesktopCloudHistory> {
  const params = new URLSearchParams({
    limit: String(limit),
    order: "topo",
  });
  if (cursor) params.set("cursor", cursor);
  if (options.summary) params.set("summary", "true");
  const raw = await cloudApiRequest<unknown>(
    `/content/${encodeURIComponent(projectId)}/commits?${params.toString()}`,
    session,
    onSessionChange,
    { signal: options.signal },
    apiBaseUrl,
  );
  validateCurrentHistoryEnvelope(raw);
  const history = normalizeCloudHistory(raw, projectId);
  if (history.project_id !== projectId) {
    throw new Error("Cloud history response belongs to another project.");
  }
  if (!history.topology_available) {
    throw new Error("Cloud history response does not include commit topology.");
  }
  if (!/^[0-9a-f]{64}$/.test(history.snapshot_id)) {
    throw new Error("Cloud history snapshot id is invalid.");
  }
  if (!cursor && !history.refs_included) {
    throw new Error("Cloud history first page does not include refs.");
  }
  if (cursor && history.refs_included) {
    throw new Error("Cloud history continuation page unexpectedly includes refs.");
  }
  if (!history.refs_included && history.refs.length > 0) {
    throw new Error("Cloud history omitted-ref page contains ref data.");
  }
  if (history.has_more !== Boolean(history.next_cursor)) {
    throw new Error("Cloud history pagination state is inconsistent.");
  }
  return history;
}

export async function getCloudHistoryDetail(
  session: DesktopCloudSession, projectId: string, commitId: string,
  apiBaseUrl?: string | null, signal?: AbortSignal,
): Promise<DesktopCloudHistoryCommit> {
  const raw = await cloudApiRequest<unknown>(
    `/content/${encodeURIComponent(projectId)}/commit-detail?commit_id=${encodeURIComponent(commitId)}`,
    session, undefined, { signal }, apiBaseUrl,
  );
  const commit = normalizeCommit(raw);
  if (commit.commit_id !== commitId || !commit.changes_loaded) {
    throw new Error("Cloud history detail does not match the requested commit.");
  }
  return commit;
}

function validateCurrentHistoryEnvelope(raw: unknown): void {
  const value = requireRecord(raw, "Cloud history response");
  if (typeof value.project_id !== "string" || !value.project_id) {
    throw new Error("Cloud history project id is invalid.");
  }
  if (typeof value.refs_included !== "boolean") {
    throw new Error("Cloud history refs inclusion state is invalid.");
  }
  if (typeof value.snapshot_id !== "string" || !/^[0-9a-f]{64}$/.test(value.snapshot_id)) {
    throw new Error("Cloud history snapshot id is invalid.");
  }
  if (typeof value.has_more !== "boolean") {
    throw new Error("Cloud history has-more state is invalid.");
  }
  if (value.next_cursor !== null && typeof value.next_cursor !== "string") {
    throw new Error("Cloud history cursor is invalid.");
  }
  if (typeof value.total !== "number" || !Number.isSafeInteger(value.total) || value.total < 0) {
    throw new Error("Cloud history total is invalid.");
  }
  if (value.graph_health !== "complete" && value.graph_health !== "degraded") {
    throw new Error("Cloud history graph health is invalid.");
  }
  if (!Array.isArray(value.refs) || !Array.isArray(value.unreadable_commit_ids)) {
    throw new Error("Cloud history graph metadata is invalid.");
  }
}

export function normalizeCloudHistory(raw: unknown, projectId = ""): DesktopCloudHistory {
  const value = requireRecord(raw, "Cloud history response");
  const rawCommits = requireArray(value.commits, "Cloud history commits");
  const topologyAvailable = rawCommits.every((commit) => (
    isRecord(commit) && Array.isArray(commit.parent_ids)
  ));
  const commits = rawCommits
    .map((commit) => normalizeCommit(commit));
  const refs = optionalArray(value.refs).map((ref) => normalizeRef(ref));
  requireUnique(commits.map((commit) => commit.commit_id), "Cloud history commit ids");
  requireUnique(refs.map((ref) => ref.ref_name), "Cloud history ref names");
  const headCommitId = optionalCommitId(value.head_commit_id, "Cloud history head");
  const snapshotId = typeof value.snapshot_id === "string" && value.snapshot_id
    ? value.snapshot_id
    : legacySnapshotId(headCommitId, refs);
  const unreadableCommitIds = [...new Set(optionalArray(value.unreadable_commit_ids)
    .map((commitId) => requireCommitId(commitId, "Unreadable history commit")))];
  const total = typeof value.total === "number" && Number.isSafeInteger(value.total) && value.total >= 0
    ? Math.max(value.total, commits.length)
    : commits.length;

  return {
    project_id: typeof value.project_id === "string" && value.project_id ? value.project_id : projectId,
    commits,
    topology_available: topologyAvailable,
    head_commit_id: headCommitId,
    refs,
    refs_included: value.refs_included !== false,
    snapshot_id: snapshotId,
    next_cursor: typeof value.next_cursor === "string" && value.next_cursor ? value.next_cursor : null,
    has_more: value.has_more === true,
    total,
    graph_health: value.graph_health === "degraded" || unreadableCommitIds.length > 0
      ? "degraded"
      : "complete",
    unreadable_commit_ids: unreadableCommitIds,
  };
}

function normalizeCommit(raw: unknown): DesktopCloudHistoryCommit {
  const value = requireRecord(raw, "Cloud history commit");
  return {
    commit_id: requireCommitId(value.commit_id, "Cloud history commit id"),
    parent_ids: [...new Set(optionalArray(value.parent_ids)
      .map((parentId) => requireCommitId(parentId, "Cloud history parent id")))],
    who: typeof value.who === "string" ? value.who : "",
    message: typeof value.message === "string" ? value.message : "",
    changes_loaded: value.changes_loaded !== false,
    changes: optionalArray(value.changes).map((change) => normalizeChange(change)),
    conflicts: optionalArray(value.conflicts)
      .map((conflict) => requireRecord(conflict, "Cloud history conflict")),
    root_hash: typeof value.root_hash === "string" ? value.root_hash : "",
    scope_hash: typeof value.scope_hash === "string" ? value.scope_hash : "",
    scope_path: typeof value.scope_path === "string" ? value.scope_path : "",
    created_at: typeof value.created_at === "string" ? value.created_at : null,
    audit_detail: isRecord(value.audit_detail) ? value.audit_detail : null,
  };
}

function normalizeChange(raw: unknown): DesktopCloudHistoryChange {
  const value = requireRecord(raw, "Cloud history change");
  if (typeof value.path !== "string" || !value.path) {
    throw new Error("Cloud history change path is invalid.");
  }
  const action = ["add", "update", "delete"].includes(String(value.action))
    ? value.action as DesktopCloudHistoryChange["action"]
    : undefined;
  const op = ["added", "modified", "deleted"].includes(String(value.op))
    ? value.op as DesktopCloudHistoryChange["op"]
    : undefined;
  return { path: value.path, ...(action ? { action } : {}), ...(op ? { op } : {}) };
}

function normalizeRef(raw: unknown): DesktopCloudHistoryRef {
  const value = requireRecord(raw, "Cloud history ref");
  if (typeof value.ref_name !== "string" || !value.ref_name) {
    throw new Error("Cloud history ref name is invalid.");
  }
  if (value.ref_type !== "branch" && value.ref_type !== "tag") {
    throw new Error("Cloud history ref type is invalid.");
  }
  const expectedPrefix = value.ref_type === "branch" ? "refs/heads/" : "refs/tags/";
  if (!value.ref_name.startsWith(expectedPrefix) || value.ref_name === expectedPrefix) {
    throw new Error("Cloud history ref name is invalid.");
  }
  return {
    ref_name: value.ref_name,
    ref_type: value.ref_type,
    commit_id: requireCommitId(value.commit_id, "Cloud history ref commit id"),
  };
}

function optionalCommitId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireCommitId(value, label);
}

function requireCommitId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

function legacySnapshotId(
  headCommitId: string | null,
  refs: DesktopCloudHistoryRef[],
): string {
  return [
    "legacy",
    headCommitId ?? "empty",
    ...refs.map((ref) => `${ref.ref_name}:${ref.commit_id}`),
  ].join("|");
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} are invalid.`);
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contain duplicates.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
