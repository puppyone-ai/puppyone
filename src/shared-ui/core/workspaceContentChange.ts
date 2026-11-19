import type {
  WorkspaceContentChange,
  WorkspaceContentChangeEntry,
} from "./types";
import { isDataResourceUri } from "./dataResourcePath";
import { canonicalizeResourcePath, looksLikeResourceUri } from "./resourcePath";
import {
  ResourceUriIdentityService,
  canonicalizeResourceUri,
  createWorkspaceResourceUri,
  type ResourceUri,
} from "./resourceUri";

const resourceIdentity = new ResourceUriIdentityService();
export const MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES = 128;

export type WorkspaceContentChangeInput = Readonly<{
  sequence: number;
  rootUri: ResourceUri | null;
  paths: readonly string[] | string | null;
}>;

/**
 * Validates an untrusted watcher/write notification before it can enter React
 * state. Malformed scoped input degrades to a root-scoped bulk invalidation;
 * it never becomes a render-time exception or silently aliases another root.
 */
export function createWorkspaceContentChange(
  input: WorkspaceContentChangeInput,
): WorkspaceContentChange {
  const entry = createWorkspaceContentChangeEntry(input);
  return Object.freeze({
    sequence: entry.sequence,
    entries: Object.freeze([entry]),
  });
}

export function appendWorkspaceContentChange(
  current: WorkspaceContentChange,
  input: Omit<WorkspaceContentChangeInput, "sequence">,
): WorkspaceContentChange {
  const sequence = normalizeSequence(current.sequence + 1);
  const entry = createWorkspaceContentChangeEntry({ ...input, sequence });
  return Object.freeze({
    sequence,
    entries: Object.freeze(
      [...current.entries, entry].slice(-MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES),
    ),
  });
}

function createWorkspaceContentChangeEntry(
  input: WorkspaceContentChangeInput,
): WorkspaceContentChangeEntry {
  const sequence = normalizeSequence(input.sequence);
  const rootUri = normalizeRootUri(input.rootUri);
  if (input.rootUri && !rootUri) {
    return Object.freeze({ sequence, rootUri: null, paths: null });
  }
  if (input.paths === null) return Object.freeze({ sequence, rootUri, paths: null });

  const candidates = typeof input.paths === "string" ? [input.paths] : input.paths;
  try {
    const paths = Array.from(new Set(candidates.map((path) => {
      if (looksLikeResourceUri(path)) {
        throw new TypeError("Workspace change paths must be provider-relative.");
      }
      const canonicalPath = canonicalizeResourcePath(path);
      // Resolution validates traversal and segment safety at the same boundary
      // that owns the root identity. The returned path remains provider-local.
      if (rootUri) createWorkspaceResourceUri(rootUri, canonicalPath);
      return canonicalPath;
    })));
    return Object.freeze({ sequence, rootUri, paths: Object.freeze(paths) });
  } catch {
    return Object.freeze({ sequence, rootUri, paths: null });
  }
}

/**
 * Total, identity-aware invalidation predicate. This function is called from
 * hooks and React memo comparators, so malformed external input must never be
 * allowed to throw through the renderer.
 */
export function workspaceContentChangeMatchesResource(
  change: WorkspaceContentChange | null | undefined,
  resource: string | null,
  afterSequence = Number.NEGATIVE_INFINITY,
): boolean {
  if (!change || !resource || !Array.isArray(change.entries)) return false;
  const entries = change.entries.filter((entry) => entry.sequence > afterSequence);
  if (entries.length === 0) return false;
  const oldestRetained = change.entries[0]?.sequence ?? change.sequence;
  if (
    change.entries.length === MAX_WORKSPACE_CONTENT_CHANGE_ENTRIES
    && afterSequence < oldestRetained - 1
  ) return true;
  return entries.some((entry) => workspaceContentChangeEntryMatchesResource(entry, resource));
}

/** @deprecated Prefer workspaceContentChangeMatchesResource. */
export const workspaceContentChangeMatchesPath = workspaceContentChangeMatchesResource;

function normalizeRootUri(rootUri: ResourceUri | null): ResourceUri | null {
  if (!rootUri) return null;
  try {
    return canonicalizeResourceUri(rootUri);
  } catch {
    return null;
  }
}

function normalizeSequence(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function workspaceContentChangeEntryMatchesResource(
  entry: WorkspaceContentChangeEntry,
  resource: string,
): boolean {
  try {
    if (entry.rootUri) {
      if (!isDataResourceUri(resource)) return false;
      const canonicalRoot = canonicalizeResourceUri(entry.rootUri);
      if (!resourceIdentity.isEqualOrParent(resource, canonicalRoot)) return false;
      if (entry.paths === null) return true;
      return entry.paths.some((path) => (
        resourceIdentity.isEqual(
          createWorkspaceResourceUri(canonicalRoot, canonicalizeResourcePath(path)),
          resource,
        )
      ));
    }

    if (entry.paths === null) return true;
    if (isDataResourceUri(resource) || looksLikeResourceUri(resource)) return false;
    const canonicalResource = canonicalizeResourcePath(resource);
    return entry.paths.some((path) => {
      if (looksLikeResourceUri(path)) return false;
      return canonicalizeResourcePath(path) === canonicalResource;
    });
  } catch {
    return false;
  }
}
