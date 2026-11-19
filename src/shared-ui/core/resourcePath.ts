declare const canonicalResourcePathBrand: unique symbol;

export type CanonicalResourcePath = string & {
  readonly [canonicalResourcePathBrand]: true;
};

const RESOURCE_URI_LIKE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[/\\]/;

/** True for a URI-shaped or malformed URI-shaped value, never a provider-relative path. */
export function looksLikeResourceUri(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const candidate = value
    .trimStart()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  return RESOURCE_URI_LIKE_PATTERN.test(candidate);
}

/** Rooted host filesystem paths are never provider-relative resource paths. */
export function isRootedFilesystemPath(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const candidate = value.trimStart().replaceAll("\\", "/");
  return candidate.startsWith("/") || /^[A-Za-z]:\//.test(candidate);
}

/** Canonical comparison form for workspace-relative resource paths. */
export function canonicalizeResourcePath(path: string): CanonicalResourcePath {
  if (looksLikeResourceUri(path)) {
    throw new TypeError(
      "Resource URI-like values cannot be canonicalized as provider-relative paths.",
    );
  }
  if (isRootedFilesystemPath(path)) {
    throw new TypeError("Host filesystem paths cannot be used as provider-relative resource paths.");
  }
  const canonical = path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  if (!canonical) throw new TypeError("Resource path must not be empty.");
  return canonical as CanonicalResourcePath;
}

/** True when candidate is the resource itself or belongs to its subtree. */
export function isSameOrDescendantResourcePath(candidate: string, resource: string): boolean {
  const canonicalCandidate = canonicalizeResourcePath(candidate);
  const canonicalResource = canonicalizeResourcePath(resource);
  return canonicalCandidate === canonicalResource
    || canonicalCandidate.startsWith(`${canonicalResource}/`);
}

/** Rebase one workspace-relative resource path without using substring-only matching. */
export function rebaseResourcePath(
  candidate: string,
  previousResource: string,
  nextResource: string,
): CanonicalResourcePath {
  const canonicalCandidate = canonicalizeResourcePath(candidate);
  const canonicalPrevious = canonicalizeResourcePath(previousResource);
  const canonicalNext = canonicalizeResourcePath(nextResource);
  if (canonicalCandidate === canonicalPrevious) return canonicalNext;
  return (canonicalCandidate.startsWith(`${canonicalPrevious}/`)
    ? `${canonicalNext}${canonicalCandidate.slice(canonicalPrevious.length)}`
    : canonicalCandidate) as CanonicalResourcePath;
}
