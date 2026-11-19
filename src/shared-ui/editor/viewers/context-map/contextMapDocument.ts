export const CONTEXT_MAP_FILE_EXTENSION = ".contextmap";
export const CONTEXT_MAP_MIME_TYPE = "application/vnd.puppyone.context-map+json";
export const CONTEXT_MAP_DOCUMENT_VERSION = 1 as const;

export type ContextMapNodeOffset = Readonly<{
  x: number;
  y: number;
}>;

export type ContextMapDocument = Readonly<{
  version: typeof CONTEXT_MAP_DOCUMENT_VERSION;
  scope: ".";
  layout: Readonly<{
    expanded: readonly string[];
    offsets: Readonly<Record<string, ContextMapNodeOffset>>;
  }>;
}>;

export type ParsedContextMapDocument = Readonly<{
  document: ContextMapDocument;
  error: string | null;
  ok: boolean;
}>;

const EMPTY_CONTEXT_MAP_DOCUMENT: ContextMapDocument = Object.freeze({
  version: CONTEXT_MAP_DOCUMENT_VERSION,
  scope: ".",
  layout: Object.freeze({
    expanded: Object.freeze([]),
    offsets: Object.freeze({}),
  }),
});

export function createDefaultContextMapDocument(): ContextMapDocument {
  return EMPTY_CONTEXT_MAP_DOCUMENT;
}

export function serializeContextMapDocument(document: ContextMapDocument): string {
  return `${JSON.stringify({
    version: CONTEXT_MAP_DOCUMENT_VERSION,
    scope: ".",
    layout: {
      expanded: [...document.layout.expanded].sort(),
      offsets: Object.fromEntries(
        Object.entries(document.layout.offsets)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, offset]) => [path, {
            x: roundCoordinate(offset.x),
            y: roundCoordinate(offset.y),
          }]),
      ),
    },
  }, null, 2)}\n`;
}

export function createDefaultContextMapDocumentContent(): string {
  return serializeContextMapDocument(createDefaultContextMapDocument());
}

export function parseContextMapDocument(content: string): ParsedContextMapDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return invalidDocument(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed)) return invalidDocument("Context Map must contain a JSON object.");
  if (parsed.version !== CONTEXT_MAP_DOCUMENT_VERSION) {
    return invalidDocument(`Unsupported Context Map version: ${String(parsed.version)}.`);
  }
  if (parsed.scope !== ".") {
    return invalidDocument("Context Map scope must be relative to its containing folder.");
  }
  if (!isRecord(parsed.layout)) return invalidDocument("Context Map layout is missing.");
  const expanded = parseRelativePathList(parsed.layout.expanded);
  if (!expanded) return invalidDocument("Context Map expanded paths are invalid.");
  const offsets = parseOffsets(parsed.layout.offsets);
  if (!offsets) return invalidDocument("Context Map node offsets are invalid.");

  return {
    document: Object.freeze({
      version: CONTEXT_MAP_DOCUMENT_VERSION,
      scope: ".",
      layout: Object.freeze({ expanded: Object.freeze(expanded), offsets: Object.freeze(offsets) }),
    }),
    error: null,
    ok: true,
  };
}

export function isContextMapFilename(name: string): boolean {
  return name.toLocaleLowerCase().endsWith(CONTEXT_MAP_FILE_EXTENSION);
}

export function getContextMapScopePath(documentPath: string): string | null {
  return getDataResourceParent(documentPath);
}

export function toContextMapRelativePath(scopePath: string | null, path: string): string | null {
  const normalizedPath = normalizeDataResourcePath(path) ?? "";
  const normalizedScope = normalizeDataResourcePath(scopePath) ?? "";
  if (!normalizedScope) return normalizedPath || null;
  if (isDataResourceUri(normalizedPath) || isDataResourceUri(normalizedScope)) {
    if (!isDataResourceUri(normalizedPath) || !isDataResourceUri(normalizedScope)) return null;
    const relative = contextMapResourceIdentity.relativePath(
      normalizedScope as ResourceUri,
      normalizedPath as ResourceUri,
    );
    return relative === "" ? "." : relative ?? null;
  }
  if (normalizedPath === normalizedScope) return ".";
  const prefix = `${normalizedScope}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : null;
}

export function fromContextMapRelativePath(scopePath: string | null, path: string): string | null {
  const normalizedRelative = normalizeRelativePath(path);
  if (normalizedRelative === null) return null;
  const normalizedScope = normalizeDataResourcePath(scopePath) ?? "";
  if (normalizedRelative === ".") return normalizedScope || null;
  return normalizedScope
    ? joinDataResourcePath(normalizedScope, normalizedRelative)
    : normalizedRelative;
}

const contextMapResourceIdentity = new ResourceUriIdentityService();

function invalidDocument(error: string): ParsedContextMapDocument {
  return { document: createDefaultContextMapDocument(), error, ok: false };
}

function parseRelativePathList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const path = normalizeRelativePath(candidate);
    if (path === null) return null;
    if (path === "." || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function parseOffsets(value: unknown): Record<string, ContextMapNodeOffset> | null {
  if (!isRecord(value)) return null;
  const offsets: Record<string, ContextMapNodeOffset> = {};
  for (const [candidatePath, candidateOffset] of Object.entries(value)) {
    const path = normalizeRelativePath(candidatePath);
    if (path === null || path === "." || !isRecord(candidateOffset)) return null;
    const x = candidateOffset.x;
    const y = candidateOffset.y;
    if (!isCoordinate(x) || !isCoordinate(y)) return null;
    offsets[path] = Object.freeze({ x: roundCoordinate(x), y: roundCoordinate(y) });
  }
  return offsets;
}

function normalizeRelativePath(path: string): string | null {
  const raw = path.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[a-z]:\//i.test(raw)) return null;
  const normalized = normalizeDataPath(path);
  if (!normalized && path.trim() === ".") return ".";
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized.split("/").some((segment) => segment === "..") ? null : normalized;
}

function normalizeDataPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
import {
  getDataResourceParent,
  isDataResourceUri,
  joinDataResourcePath,
  normalizeDataResourcePath,
} from "../../../core/dataResourcePath";
import { ResourceUriIdentityService, type ResourceUri } from "../../../core/resourceUri";
