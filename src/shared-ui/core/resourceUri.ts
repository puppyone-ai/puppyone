import { canonicalizeResourcePath, isRootedFilesystemPath } from "./resourcePath";

declare const resourceUriBrand: unique symbol;

/** Opaque provider resource identity. Display paths must never substitute for it. */
export type ResourceUri = string & { readonly [resourceUriBrand]: true };

export type ParsedResourceUri = Readonly<{
  scheme: string;
  authority: string;
  path: string;
}>;

export type ResourceUriIdentityOptions = Readonly<{
  isPathCaseSensitive?: (resource: ResourceUri) => boolean;
}>;

const WORKSPACE_RESOURCE_SCHEME = "puppyone-local";
const WORKSPACE_RESOURCE_AUTHORITY = "workspace";
const URI_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]+)(?:\/(.*))?$/;

export function createResourceUri({
  scheme,
  authority,
  path = "",
}: {
  scheme: string;
  authority: string;
  path?: string;
}): ResourceUri {
  const normalizedScheme = normalizeScheme(scheme);
  const normalizedAuthority = normalizeAuthority(authority);
  const normalizedPath = normalizeUriPath(path);
  const serializedPath = normalizedPath
    ? `/${normalizedPath.split("/").map(encodeUriSegment).join("/")}`
    : "";
  return `${normalizedScheme}://${encodeUriSegment(normalizedAuthority)}${serializedPath}` as ResourceUri;
}

export function parseResourceUri(resource: ResourceUri | string): ParsedResourceUri {
  if (typeof resource !== "string" || !resource.trim()) {
    throw new TypeError("Resource URI must be a non-empty string.");
  }
  const match = URI_PATTERN.exec(resource.trim());
  if (!match) throw new TypeError("Resource URI is invalid.");
  return Object.freeze({
    scheme: normalizeScheme(match[1]!),
    authority: normalizeAuthority(decodeUriSegment(match[2]!)),
    path: normalizeUriPath(match[3] ?? "", { encoded: true }),
  });
}

export function canonicalizeResourceUri(resource: ResourceUri | string): ResourceUri {
  return createResourceUri(parseResourceUri(resource));
}

/** Stable logical root for one attached Workspace Folder. */
export function createWorkspaceRootUri(folderId: string): ResourceUri {
  const normalizedFolderId = requireSegment(folderId, "Workspace Folder ID");
  return createResourceUri({
    scheme: WORKSPACE_RESOURCE_SCHEME,
    authority: WORKSPACE_RESOURCE_AUTHORITY,
    path: normalizedFolderId,
  });
}

/** Resolve a provider-relative path without allowing it to escape the Folder root. */
export function createWorkspaceResourceUri(
  rootUri: ResourceUri,
  resourcePath: string,
): ResourceUri {
  if (isRootedFilesystemPath(resourcePath)) {
    throw new TypeError("Host filesystem paths cannot be encoded as Workspace provider paths.");
  }
  const root = parseResourceUri(rootUri);
  const relativePath = normalizeUriPath(resourcePath, { rejectRootEscape: true });
  if (!relativePath) return canonicalizeResourceUri(rootUri);
  return createResourceUri({ ...root, path: `${root.path}/${relativePath}` });
}

export function getWorkspaceResourcePath(
  rootUri: ResourceUri,
  resource: ResourceUri,
): string {
  const relative = new ResourceUriIdentityService().relativePath(rootUri, resource);
  if (relative === undefined) {
    throw new Error("Resource URI is outside the Workspace Folder root.");
  }
  return relative;
}

/**
 * Provider-aware URI comparison. All resource equality, ancestry, and rebasing
 * crosses this service so feature code never relies on raw string prefixes.
 */
export class ResourceUriIdentityService {
  readonly #isPathCaseSensitive: (resource: ResourceUri) => boolean;

  constructor(options: ResourceUriIdentityOptions = {}) {
    this.#isPathCaseSensitive = options.isPathCaseSensitive ?? (() => true);
  }

  canonicalKey(resource: ResourceUri): string {
    const parsed = parseResourceUri(resource);
    const path = this.#isPathCaseSensitive(resource) ? parsed.path : parsed.path.toLocaleLowerCase("en-US");
    return createResourceUri({
      ...parsed,
      authority: parsed.authority.toLocaleLowerCase("en-US"),
      path,
    });
  }

  isEqual(first: ResourceUri, second: ResourceUri): boolean {
    return this.canonicalKey(first) === this.canonicalKey(second);
  }

  isEqualOrParent(resource: ResourceUri, candidateParent: ResourceUri): boolean {
    const child = this.#comparisonParts(resource);
    const parent = this.#comparisonParts(candidateParent);
    return child.scheme === parent.scheme
      && child.authority === parent.authority
      && (
        parent.path === ""
        || child.path === parent.path
        || child.path.startsWith(`${parent.path}/`)
      );
  }

  relativePath(base: ResourceUri, resource: ResourceUri): string | undefined {
    if (!this.isEqualOrParent(resource, base)) return undefined;
    const baseParts = parseResourceUri(base);
    const resourceParts = parseResourceUri(resource);
    if (this.isEqual(base, resource)) return "";
    return resourceParts.path.slice(baseParts.path.length + 1);
  }

  joinPath(base: ResourceUri, ...segments: string[]): ResourceUri {
    const parsed = parseResourceUri(base);
    const relative = normalizeUriPath(segments.join("/"), { rejectRootEscape: true });
    return relative
      ? createResourceUri({ ...parsed, path: `${parsed.path}/${relative}` })
      : canonicalizeResourceUri(base);
  }

  rebase(resource: ResourceUri, previousBase: ResourceUri, nextBase: ResourceUri): ResourceUri {
    const relative = this.relativePath(previousBase, resource);
    if (relative === undefined) return canonicalizeResourceUri(resource);
    const previous = parseResourceUri(previousBase);
    const next = parseResourceUri(nextBase);
    if (previous.scheme !== next.scheme || previous.authority !== next.authority) {
      throw new Error("Resource URI rebasing requires the same provider authority.");
    }
    return relative ? this.joinPath(nextBase, relative) : canonicalizeResourceUri(nextBase);
  }

  #comparisonParts(resource: ResourceUri): ParsedResourceUri {
    const parsed = parseResourceUri(resource);
    return {
      ...parsed,
      authority: parsed.authority.toLocaleLowerCase("en-US"),
      path: this.#isPathCaseSensitive(resource)
        ? parsed.path
        : parsed.path.toLocaleLowerCase("en-US"),
    };
  }
}

function normalizeScheme(value: string): string {
  const scheme = typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new TypeError("Resource URI scheme is invalid.");
  return scheme;
}

function normalizeAuthority(value: string): string {
  const authority = typeof value === "string" ? value.trim() : "";
  if (!authority || authority.includes("/") || authority.includes("\\")) {
    throw new TypeError("Resource URI authority is invalid.");
  }
  return authority;
}

function normalizeUriPath(
  value: string,
  options: Readonly<{ encoded?: boolean; rejectRootEscape?: boolean }> = {},
): string {
  if (typeof value !== "string") throw new TypeError("Resource URI path must be a string.");
  const normalizedSlashes = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedSlashes) return "";
  const result: string[] = [];
  for (const rawSegment of normalizedSlashes.split("/")) {
    if (!rawSegment) continue;
    const segment = options.encoded ? decodeUriSegment(rawSegment) : rawSegment;
    if (segment === ".") continue;
    if (segment === "..") {
      if (result.length === 0) {
        if (options.rejectRootEscape) {
          throw new Error("Resource path traversal outside the Workspace Folder is not allowed.");
        }
        throw new Error("Resource URI path cannot escape its provider root.");
      }
      result.pop();
      continue;
    }
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      throw new TypeError("Resource URI path segment is invalid.");
    }
    result.push(segment);
  }
  return result.join("/");
}

function encodeUriSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeUriSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TypeError("Resource URI contains invalid percent encoding.");
  }
}

function requireSegment(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required.`);
  const normalized = canonicalizeResourcePath(value.trim());
  if (normalized === "." || normalized === ".." || normalized.includes("/")) {
    throw new TypeError(`${label} must be one URI segment.`);
  }
  return normalized;
}
