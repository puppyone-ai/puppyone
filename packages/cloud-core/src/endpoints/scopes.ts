import type { CloudTransport } from "../transport";

// ── Types (mirror backend src/repo/schemas.py) ──────────────────────────
export type ScopeMode = "r" | "rw";

export interface RepoScope {
  id: string;
  project_id: string;
  name: string;
  path: string; // canonical: '' for root, no leading/trailing /
  exclude: string[];
  mode: ScopeMode;
  is_root: boolean;
  access_key?: string | null;
  access_key_revoked?: boolean;
  created_at: string;
  updated_at: string;
}

/** Bind the repo-scope API to a platform transport (ISSUE-022). */
export function createScopesApi(t: CloudTransport) {
  return {
    async listScopes(projectId: string): Promise<RepoScope[]> {
      return (await t.get<RepoScope[]>(`/api/v1/projects/${projectId}/scopes`)) || [];
    },
    createScope(
      projectId: string,
      body: { name: string; path: string; exclude?: string[]; mode?: ScopeMode },
    ): Promise<RepoScope> {
      return t.post<RepoScope>(`/api/v1/projects/${projectId}/scopes`, body);
    },
    updateScope(
      projectId: string,
      scopeId: string,
      body: { name?: string; exclude?: string[]; mode?: ScopeMode },
    ): Promise<RepoScope> {
      return t.patch<RepoScope>(`/api/v1/projects/${projectId}/scopes/${scopeId}`, body);
    },
    async deleteScope(projectId: string, scopeId: string): Promise<void> {
      await t.del(`/api/v1/projects/${projectId}/scopes/${scopeId}`);
    },
    regenerateScopeKey(projectId: string, scopeId: string): Promise<RepoScope> {
      return t.post<RepoScope>(
        `/api/v1/projects/${projectId}/scopes/${scopeId}/regenerate-key`,
        {},
      );
    },
  };
}

// ── Pure scope helpers (transport-agnostic domain logic) ─────────────────

/**
 * Match a URL path to a scope. A folder shows the connectors of its exact-match
 * scope — no parent-child inheritance. Returns null if no scope matches the path
 * (callers render an empty state, NOT a root-scope fallback).
 * `urlPath` is canonical: '' for root; otherwise no leading/trailing slashes.
 */
export function matchScopeForPath(
  urlPath: string,
  scopes: readonly RepoScope[],
): RepoScope | null {
  const normalized = urlPath.replaceAll(/^\/+|\/+$/g, "").replaceAll(/\/+/g, "/");
  return scopes.find((s) => s.path === normalized) ?? null;
}

/**
 * Test whether a node path falls within a scope's boundary (the scope folder
 * itself or a descendant). Both args are canonical paths. Root scope ('') is
 * permissive — every node belongs to it.
 */
export function isWithinScope(nodePath: string, scopePath: string): boolean {
  const normNode = (nodePath || "").replaceAll(/^\/+|\/+$/g, "").replaceAll(/\/+/g, "/");
  const normScope = (scopePath || "").replaceAll(/^\/+|\/+$/g, "").replaceAll(/\/+/g, "/");
  if (normScope === "") return true;
  if (normNode === normScope) return true;
  return normNode.startsWith(`${normScope}/`);
}
