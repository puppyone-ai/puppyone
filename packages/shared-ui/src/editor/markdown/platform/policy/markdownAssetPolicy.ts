/**
 * Workspace asset policy for Markdown media resolution.
 * Brokers must evaluate hrefs here before calling any host resolver.
 */

import { isDataResourceUri, resolveDataResourceWorkspaceRoot } from "../../../../core/dataResourcePath";
import { getWorkspaceResourcePath } from "../../../../core/resourceUri";

export const MARKDOWN_ASSET_POLICY_VERSION = "2026-10-05";
export const MARKDOWN_ASSET_MAX_DATA_URL_BYTES = 2 * 1024 * 1024;
export const MARKDOWN_ASSET_MAX_IN_FLIGHT = 8;
export type MarkdownAssetKind = "image" | "video";
export type MarkdownRemoteAssetPolicy = "deny" | "https-only";

export type MarkdownAssetPolicyContext = {
  documentPath: string;
  workspaceRoot?: string | null;
  remotePolicy?: MarkdownRemoteAssetPolicy;
};

export type MarkdownAssetPolicyResult =
  | {
      ok: true;
      kind: "workspace-relative";
      path: string;
      mimeType: string | null;
    }
  | {
      ok: true;
      kind: "safe-direct";
      url: string;
      mimeType: string | null;
    }
  | {
      ok: true;
      kind: "data-image";
      url: string;
      mimeType: string;
    }
  | {
      ok: false;
      reason: string;
    };

const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+)(;[^,]*)?,/i;
const SAFE_RASTER_DATA_MIME_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/x-icon",
]);
const C0_OR_DEL = /[\u0000-\u001f\u007f]/;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

/**
 * Evaluate a Markdown media href for brokered resolution.
 * Markdown source never carries an ambient blob/custom-protocol capability.
 * Remote media requires an explicit, scheme-bounded policy. Workspace-relative paths are
 * normalized lexically here and are canonicalized/revalidated by the host
 * resolver against the real workspace filesystem.
 */
export function evaluateMarkdownAssetHref(
  href: string,
  context: MarkdownAssetPolicyContext,
  kind: MarkdownAssetKind = "image",
): MarkdownAssetPolicyResult {
  const trimmed = href.trim();
  if (!trimmed) return { ok: false, reason: "empty-href" };
  if (hasInvalidAssetCharacters(trimmed)) {
    return { ok: false, reason: "control-character-denied" };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("file:")) return { ok: false, reason: "file-scheme-denied" };
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) {
    return { ok: false, reason: "executable-scheme-denied" };
  }

  if (lower.startsWith("data:")) {
    if (kind !== "image") return { ok: false, reason: "data-media-kind-denied" };
    return evaluateDataImageHref(trimmed);
  }

  if (/^https?:/i.test(trimmed)) {
    if (context.remotePolicy !== "https-only") {
      return { ok: false, reason: "remote-load-denied" };
    }
    const remoteUrl = parseSafeRemoteAssetUrl(trimmed);
    if (!remoteUrl) return { ok: false, reason: "remote-url-invalid" };
    const mimeType = guessMimeFromHref(remoteUrl);
    if (!isMimeCompatibleWithAssetKind(mimeType, kind)) {
      return { ok: false, reason: "media-kind-mismatch" };
    }
    return {
      ok: true,
      kind: "safe-direct",
      url: remoteUrl,
      mimeType,
    };
  }

  const workspaceInput = resolveWorkspaceAssetInput(context, trimmed);
  if (!workspaceInput) return { ok: false, reason: "outside-workspace" };
  const { documentPath, href: workspaceHref } = workspaceInput;

  // A tokenized custom-protocol URL or blob URL copied into Markdown is an
  // ambient capability and must not be replayable as document source. Trusted
  // host resolvers may return these URLs after resolving a workspace asset.
  if (/^(?:blob:|puppyone-local:)/i.test(workspaceHref)) {
    return { ok: false, reason: "ambient-capability-denied" };
  }

  if (workspaceHref.startsWith("#") || hasUrlScheme(workspaceHref)) {
    return { ok: false, reason: "unsupported-scheme" };
  }

  const resolvedPath = resolveWorkspaceRelativePath(documentPath, workspaceHref);
  if (!resolvedPath) return { ok: false, reason: "path-unresolvable" };

  if (resolvedPath.split("/").some((segment) => segment === ".." || segment === "")) {
    return { ok: false, reason: "invalid-path-segment" };
  }

  const mimeType = guessMimeFromHref(resolvedPath);
  if (!isMimeCompatibleWithAssetKind(mimeType, kind)) {
    return { ok: false, reason: "media-kind-mismatch" };
  }
  return {
    ok: true,
    kind: "workspace-relative",
    path: resolvedPath,
    mimeType,
  };
}

function hasInvalidAssetCharacters(value: string) {
  return C0_OR_DEL.test(value) || ENCODED_CONTROL.test(value);
}

function resolveWorkspaceAssetInput(context: MarkdownAssetPolicyContext, href: string) {
  if (!isDataResourceUri(context.documentPath)) return { documentPath: context.documentPath, href };
  const root = resolveDataResourceWorkspaceRoot(context.documentPath, context.workspaceRoot);
  if (!root) return null;
  try {
    // Logical identities must stay within the complete root. Capability URLs
    // and references to other accounts/projects are never authored assets.
    if (isDataResourceUri(href) && /[?#]/.test(href)) return null;
    return { documentPath: getWorkspaceResourcePath(root, context.documentPath),
      href: isDataResourceUri(href) ? `/${getWorkspaceResourcePath(root, href)}` : href };
  } catch { return null; }
}

export function isBrokerSafeResolvedAssetUrl(
  url: string,
  kind: MarkdownAssetKind = "image",
): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (C0_OR_DEL.test(trimmed) || ENCODED_CONTROL.test(trimmed)) return false;
  if (/^file:/i.test(trimmed)) return false;
  if (/^(javascript:|vbscript:)/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) {
    return kind === "image" && evaluateDataImageHref(trimmed).ok;
  }
  if (/^https?:/i.test(trimmed)) {
    if (parseSafeRemoteAssetUrl(trimmed)) return true;
    // A trusted provider may serve its signed assets from a local development
    // service. This exception never applies to authored remote media hrefs.
    try {
      const resolved = new URL(trimmed);
      return resolved.protocol === "http:" && !resolved.username && !resolved.password
        && ["localhost", "127.0.0.1", "[::1]"].includes(resolved.hostname);
    } catch { return false; }
  }
  return /^(blob:|puppyone-local:)/i.test(trimmed);
}

function evaluateDataImageHref(href: string): MarkdownAssetPolicyResult {
  const match = DATA_IMAGE.exec(href);
  if (!match) return { ok: false, reason: "data-not-image" };
  const mimeType = match[1].toLowerCase();
  if (!SAFE_RASTER_DATA_MIME_TYPES.has(mimeType)) return { ok: false, reason: "data-mime-denied" };

  const comma = href.indexOf(",");
  if (comma < 0) return { ok: false, reason: "data-malformed" };
  const payload = href.slice(comma + 1);
  const isBase64 = /;base64/i.test(href.slice(0, comma));
  const estimatedBytes = getDecodedDataPayloadSize(payload, isBase64);
  if (estimatedBytes === null) return { ok: false, reason: "data-malformed" };
  if (estimatedBytes > MARKDOWN_ASSET_MAX_DATA_URL_BYTES) {
    return { ok: false, reason: "data-too-large" };
  }

  return { ok: true, kind: "data-image", url: href, mimeType };
}

export function resolveWorkspaceRelativePath(sourcePath: string, href: string): string | null {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith("data:")) return null;
  if (trimmedHref.startsWith("#") || hasUrlScheme(trimmedHref)) return null;

  const sourceParts = normalizeWorkspacePathSegments(sourcePath);
  if (!sourceParts) return null;
  if (!trimmedHref.startsWith("/")) sourceParts.pop();

  const parts = trimmedHref.startsWith("/") ? [] : [...sourceParts];
  for (const rawSegment of stripUrlSuffix(trimmedHref).replace(/\\/g, "/").split("/")) {
    if (!rawSegment || rawSegment === ".") continue;
    const segment = decodePathSegment(rawSegment);
    if (!segment || C0_OR_DEL.test(segment) || segment.includes("/") || segment.includes("\\")) return null;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.length > 0 ? parts.join("/") : null;
}

export function isPathInsideWorkspaceRoot(workspaceRoot: string, candidatePath: string): boolean {
  const root = normalizePathForCompare(workspaceRoot);
  const candidate = normalizePathForCompare(candidatePath);
  if (!root) return false;
  if (candidate === root) return true;
  return candidate.startsWith(`${root}/`);
}

function normalizePathForCompare(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeWorkspacePathSegments(value: string): string[] | null {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return null;
  const parts: string[] = [];
  for (const rawSegment of normalized.split("/")) {
    if (!rawSegment || rawSegment === ".") continue;
    const segment = decodePathSegment(rawSegment);
    if (!segment || C0_OR_DEL.test(segment) || segment.includes("/") || segment.includes("\\")) return null;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts;
}

function parseSafeRemoteAssetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function getDecodedDataPayloadSize(payload: string, base64: boolean): number | null {
  if (base64) {
    const compact = payload.replace(/\s+/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) return null;
    const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return null;
  }
}

function stripUrlSuffix(value: string): string {
  const index = value.search(/[?#]/);
  return index === -1 ? value : value.slice(0, index);
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed percent escape has no stable browser/filesystem
    // interpretation, so the policy authority must fail closed.
    return null;
  }
}

function guessMimeFromHref(href: string): string | null {
  const clean = stripUrlSuffix(href).toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".ico")) return "image/x-icon";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  if (clean.endsWith(".mp4") || clean.endsWith(".m4v")) return "video/mp4";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".ogv")) return "video/ogg";
  if (clean.endsWith(".mov") || clean.endsWith(".qt")) return "video/quicktime";
  if (clean.endsWith(".3gp") || clean.endsWith(".3gpp")) return "video/3gpp";
  if (clean.endsWith(".3g2")) return "video/3gpp2";
  return null;
}

function isMimeCompatibleWithAssetKind(
  mimeType: string | null,
  kind: MarkdownAssetKind,
): boolean {
  return mimeType === null || mimeType.startsWith(`${kind}/`);
}
