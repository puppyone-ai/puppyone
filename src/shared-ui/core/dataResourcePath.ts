import {
  ResourceUriIdentityService,
  canonicalizeResourceUri,
  createResourceUri,
  createWorkspaceResourceUri,
  parseResourceUri,
  type ResourceUri,
} from "./resourceUri";
import { isRootedFilesystemPath, looksLikeResourceUri } from "./resourcePath";

const resourceIdentity = new ResourceUriIdentityService();

/** A supplied storage root takes precedence. Only local Folder identities
 * have a first-segment root; remote authorities require the complete root. */
export function resolveDataResourceWorkspaceRoot(resource: string, workspaceRoot?: string | null): ResourceUri | null {
  if (!isDataResourceUri(resource)) return null;
  if (isDataResourceUri(workspaceRoot) && resourceIdentity.isEqualOrParent(resource, workspaceRoot)) {
    return workspaceRoot;
  }
  const parsed = parseResourceUri(resource);
  if (parsed.scheme !== "puppyone-local") return null;
  const folderId = parsed.path.split("/")[0];
  return folderId ? createResourceUri({ ...parsed, path: folderId }) : null;
}

/**
 * Data surfaces still expose strings for legacy provider paths. Once a string
 * is a Resource URI, every path operation must preserve its provider/root
 * identity instead of normalizing it like a relative filesystem path.
 */
export function isDataResourceUri(value: string | null | undefined): value is ResourceUri {
  if (typeof value !== "string" || !value.includes("://")) return false;
  try {
    parseResourceUri(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mixed data boundaries may accept a legacy provider path or a Resource URI.
 * A URI-shaped value must never fall back to provider-relative path routing
 * merely because an earlier layer damaged its `://` delimiter.
 */
export function assertValidDataResourceReference(
  value: string | null | undefined,
): void {
  if (!looksLikeResourceUri(value) || isDataResourceUri(value)) return;
  throw new TypeError("Malformed Resource URI. Expected scheme://authority/path.");
}

/**
 * Qualifies a provider-local path at its owning Workspace Folder boundary.
 * Already-qualified resources must remain inside that same Folder.
 */
export function qualifyDataResourcePath(
  rootUri: ResourceUri,
  value: string,
): ResourceUri {
  if (isDataResourceUri(value)) {
    if (!resourceIdentity.isEqualOrParent(value, rootUri)) {
      throw new Error("Resource URI is outside the selected Workspace Folder.");
    }
    return canonicalizeResourceUri(value);
  }
  assertValidDataResourceReference(value);
  if (isRootedFilesystemPath(value)) {
    throw new TypeError("Host filesystem paths must be converted to provider-relative paths before qualification.");
  }
  return createWorkspaceResourceUri(rootUri, value);
}

export function normalizeDataResourcePath(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (isDataResourceUri(value)) return canonicalizeResourceUri(value);
  assertValidDataResourceReference(value);

  const normalized = value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .reduce<string[]>((segments, segment) => {
      if (segment === "..") segments.pop();
      else segments.push(segment);
      return segments;
    }, [])
    .join("/");
  return normalized || null;
}

export function getDataResourceName(value: string | null | undefined): string {
  const normalized = normalizeDataResourcePath(value);
  if (!normalized) return "";
  if (isDataResourceUri(normalized)) {
    return parseResourceUri(normalized).path.split("/").filter(Boolean).at(-1) ?? "";
  }
  return normalized.split("/").at(-1) ?? normalized;
}

export function getDataResourceParent(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeDataResourcePath(value);
  if (!normalized) return null;
  if (!isDataResourceUri(normalized)) {
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex < 0 ? null : normalized.slice(0, slashIndex) || null;
  }

  const parsed = parseResourceUri(normalized);
  const segments = parsed.path.split("/").filter(Boolean);
  // Workspace Folder URIs use the first provider-path segment as their root.
  // It has no navigable parent inside the current Workbench Workspace.
  if (segments.length <= 1) return null;
  return createResourceUri({
    ...parsed,
    path: segments.slice(0, -1).join("/"),
  });
}

export function joinDataResourcePath(parent: string | null, name: string): string {
  const normalizedName = normalizeDataResourcePath(name);
  if (!normalizedName) return normalizeDataResourcePath(parent) ?? "";
  if (isDataResourceUri(normalizedName)) return normalizedName;

  const normalizedParent = normalizeDataResourcePath(parent);
  if (!normalizedParent) return normalizedName;
  if (isDataResourceUri(normalizedParent)) {
    return resourceIdentity.joinPath(normalizedParent, normalizedName);
  }
  return `${normalizedParent}/${normalizedName}`;
}

export function collectDataResourceAncestors(value: string | null | undefined): string[] {
  const normalized = normalizeDataResourcePath(value);
  if (!normalized) return [];
  if (!isDataResourceUri(normalized)) {
    const parts = normalized.split("/").filter(Boolean);
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  }

  const parsed = parseResourceUri(normalized);
  const parts = parsed.path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => createResourceUri({
    ...parsed,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

export function isSameDataResource(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeDataResourcePath(left);
  const normalizedRight = normalizeDataResourcePath(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft === normalizedRight;
  if (isDataResourceUri(normalizedLeft) && isDataResourceUri(normalizedRight)) {
    return resourceIdentity.isEqual(normalizedLeft, normalizedRight);
  }
  return normalizedLeft === normalizedRight;
}

export function isDataResourceDescendant(
  candidate: string | null | undefined,
  ancestor: string | null | undefined,
): boolean {
  const normalizedCandidate = normalizeDataResourcePath(candidate);
  const normalizedAncestor = normalizeDataResourcePath(ancestor);
  if (!normalizedCandidate || !normalizedAncestor) return Boolean(normalizedCandidate && !normalizedAncestor);
  if (isDataResourceUri(normalizedCandidate) && isDataResourceUri(normalizedAncestor)) {
    return !resourceIdentity.isEqual(normalizedCandidate, normalizedAncestor)
      && resourceIdentity.isEqualOrParent(normalizedCandidate, normalizedAncestor);
  }
  return normalizedCandidate !== normalizedAncestor
    && normalizedCandidate.startsWith(`${normalizedAncestor}/`);
}

export function rebaseDataResourcePath(
  candidate: string | null,
  previousResource: string,
  nextResource: string,
): string | null {
  if (!candidate) return candidate;
  const normalizedCandidate = normalizeDataResourcePath(candidate);
  const normalizedPrevious = normalizeDataResourcePath(previousResource);
  const normalizedNext = normalizeDataResourcePath(nextResource);
  if (!normalizedCandidate || !normalizedPrevious || !normalizedNext) return candidate;

  if (
    isDataResourceUri(normalizedCandidate)
    && isDataResourceUri(normalizedPrevious)
    && isDataResourceUri(normalizedNext)
  ) {
    return resourceIdentity.rebase(normalizedCandidate, normalizedPrevious, normalizedNext);
  }
  if (normalizedCandidate === normalizedPrevious) return normalizedNext;
  return normalizedCandidate.startsWith(`${normalizedPrevious}/`)
    ? `${normalizedNext}${normalizedCandidate.slice(normalizedPrevious.length)}`
    : normalizedCandidate;
}
