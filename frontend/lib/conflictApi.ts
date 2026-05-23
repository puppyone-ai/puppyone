import { get, post } from '@/lib/apiClient';

/** A single conflict record carried inside a pending row.
 * Mirrors backend ``ConflictRecord`` in
 * ``src/version_engine/write_engine/merge.py``. */
export interface ConflictRecord {
  path: string;
  strategy: string;
  detail?: string;
  kept?: string;
  lost_content?: string;
  lost_hash?: string;
}

/** Summary fields the list endpoint returns. The single-row endpoint
 * extends this with ``conflict_records`` + ``resolution_detail``. */
export interface PendingConflictSummary {
  pending_conflict_id: string;
  project_id: string;
  scope_path: string;
  status: 'pending' | 'resolving' | 'resolved' | 'rejected';
  policy: string;
  base_commit_id: string;
  current_commit_id: string;
  client_commit_id: string;
  proposed_tree_id: string;
  changed_paths: string[];
  resolver_kind: string;
  resolver_actor: string;
  resolution_commit_id: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
}

export interface PendingConflictDetail extends PendingConflictSummary {
  conflict_records: ConflictRecord[];
  resolution_detail: Record<string, unknown>;
}

export type ResolveDecision = 'accept' | 'reject';

/** Request body for ``POST /content/{pid}/conflicts/{id}/resolve``.
 * Exactly one of ``resolution_tree_id`` / ``resolution_files`` is
 * required for ``decision="accept"`` (the engine validates this).
 *
 * ``resolution_files`` uses base64-encoded bytes per path because the
 * REST surface is JSON; the backend decodes before re-entering the
 * publish pipeline. ``resolution_tree_id`` skips the file payload
 * entirely when the resolver already knows the merged tree hash
 * (e.g. an agent picked one side wholesale). */
export interface ResolveConflictRequest {
  decision: ResolveDecision;
  resolution_tree_id?: string;
  resolution_files?: Record<string, string>;
  resolution_message?: string;
}

export interface ResolveConflictResponse {
  status: string;
  commit_id: string;
  pending_conflict_id: string;
  follow_up_pending_conflict_id: string;
}

export function listPendingConflicts(projectId: string): Promise<PendingConflictSummary[]> {
  return get<PendingConflictSummary[]>(
    `/api/v1/content/${encodeURIComponent(projectId)}/conflicts/pending`,
  );
}

export function getPendingConflict(
  projectId: string,
  pendingConflictId: string,
): Promise<PendingConflictDetail> {
  return get<PendingConflictDetail>(
    `/api/v1/content/${encodeURIComponent(projectId)}/conflicts/${encodeURIComponent(pendingConflictId)}`,
  );
}

export function resolveConflict(
  projectId: string,
  pendingConflictId: string,
  body: ResolveConflictRequest,
): Promise<ResolveConflictResponse> {
  return post<ResolveConflictResponse>(
    `/api/v1/content/${encodeURIComponent(projectId)}/conflicts/${encodeURIComponent(pendingConflictId)}/resolve`,
    body,
  );
}

/** Convenience: encode a ``Record<string, Uint8Array | string>`` as the
 * base64 payload the resolver expects. Strings are encoded as UTF-8 first. */
export function encodeResolutionFiles(
  files: Record<string, Uint8Array | string>,
): Record<string, string> {
  const encoder = new TextEncoder();
  const out: Record<string, string> = {};
  for (const [path, value] of Object.entries(files)) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    out[path] = base64Encode(bytes);
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // Browser-only: ``btoa`` exists in all evergreen targets; on the
  // server (during prerendering) the caller should pass strings, not
  // raw bytes — but this guard avoids a hard crash if it slips
  // through.
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}
