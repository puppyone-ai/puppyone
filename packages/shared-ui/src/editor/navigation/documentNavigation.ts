import { findMarkdownLinkTokens, findWikiLinkTokens } from "../markdown";

export type DocumentReferenceSyntax =
  | "url"
  | "markdown-link"
  | "wiki-link"
  | "workspace-path";

export type DocumentExternalReference = Readonly<{
  kind: "external";
  syntax: DocumentReferenceSyntax;
  raw: string;
  label: string;
  href: string;
}>;

export type DocumentWorkspaceReferenceStatus =
  | "resolved"
  | "ambiguous"
  | "missing";

export type DocumentWorkspaceReference = Readonly<{
  kind: "workspace";
  syntax: DocumentReferenceSyntax;
  raw: string;
  label: string;
  target: string;
  status: DocumentWorkspaceReferenceStatus;
  path: string | null;
  candidatePaths: readonly string[];
}>;

export type DocumentDeniedReference = Readonly<{
  kind: "denied";
  syntax: DocumentReferenceSyntax;
  raw: string;
  label: string;
  reason: "control-character" | "credentials" | "invalid-url" | "unsafe-protocol";
}>;

export type DocumentReference =
  | DocumentExternalReference
  | DocumentWorkspaceReference
  | DocumentDeniedReference;

export type WorkspaceDocumentReferenceResolution = Readonly<{
  exists: boolean;
  ambiguous: boolean;
  path: string | null;
  candidatePaths?: readonly string[];
}>;

export type DocumentNavigationPort = Readonly<{
  resolveReference(sourcePath: string, rawValue: string): DocumentReference | null;
  canOpenReference(reference: DocumentReference): boolean;
  openReference(reference: DocumentReference): void | Promise<void>;
}>;

export type DocumentNavigationOptions = Readonly<{
  resolveWorkspaceReference?: (
    sourcePath: string,
    target: string,
  ) => WorkspaceDocumentReferenceResolution | null;
  openWorkspaceCandidates?: (paths: readonly string[]) => void | Promise<void>;
  openExternalUrl?: (href: string) => void | Promise<void>;
}>;

type ParsedReferenceIntent =
  | Omit<DocumentExternalReference, "kind">
  | Readonly<{
      syntax: DocumentReferenceSyntax;
      raw: string;
      label: string;
      target: string;
    }>
  | DocumentDeniedReference;

/**
 * Creates the format-neutral navigation capability used by document viewers.
 * Viewers submit typed intents; only the Host resolves workspace identity or
 * hands an admitted external URL to the platform boundary.
 */
export function createDocumentNavigationPort(
  options: DocumentNavigationOptions,
): DocumentNavigationPort {
  const admittedReferences = new WeakSet<object>();
  const admit = <Reference extends DocumentReference>(reference: Reference): Reference => {
    const frozenReference = Object.freeze(reference);
    admittedReferences.add(frozenReference);
    return frozenReference;
  };
  const canOpenReference = (reference: DocumentReference): boolean => {
    if (!admittedReferences.has(reference)) return false;
    if (reference.kind === "external") return Boolean(options.openExternalUrl);
    return reference.kind === "workspace"
      && reference.status !== "missing"
      && reference.candidatePaths.length > 0
      && Boolean(options.openWorkspaceCandidates);
  };

  return Object.freeze({
    resolveReference(sourcePath, rawValue) {
      const intent = parseDocumentReferenceIntent(rawValue);
      if (!intent) return null;
      if ("reason" in intent) return admit(intent);
      if ("href" in intent) return admit({ kind: "external", ...intent });

      const resolution = options.resolveWorkspaceReference?.(
        sourcePath,
        intent.target,
      ) ?? null;
      const candidatePaths = uniquePaths([
        ...(resolution?.path ? [resolution.path] : []),
        ...(resolution?.candidatePaths ?? []),
      ]);
      return admit({
        kind: "workspace",
        ...intent,
        status: resolution?.ambiguous
          ? "ambiguous"
          : resolution?.exists && resolution.path
            ? "resolved"
            : "missing",
        path: resolution?.path ?? null,
        candidatePaths: Object.freeze(candidatePaths),
      });
    },
    canOpenReference,
    openReference(reference) {
      if (!canOpenReference(reference)) return;
      if (reference.kind === "external") {
        return options.openExternalUrl?.(reference.href);
      }
      if (reference.kind !== "workspace") return;
      const candidates = uniquePaths([
        ...(reference.path ? [reference.path] : []),
        ...reference.candidatePaths,
      ]);
      if (candidates.length > 0) return options.openWorkspaceCandidates?.(candidates);
    },
  });
}

/** Full-cell recognition only. CSV has no native link type, so partial and
 * heuristic matches remain ordinary text. */
export function parseDocumentReferenceIntent(rawValue: string): ParsedReferenceIntent | null {
  const value = rawValue.trim();
  if (!value) return null;
  if (hasControlCharacter(rawValue) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) {
    return denied(rawValue, "url", "control-character");
  }

  const wikiToken = findWikiLinkTokens(value)[0];
  if (wikiToken?.from === 0 && wikiToken.to === value.length) {
    return {
      syntax: "wiki-link",
      raw: rawValue,
      label: wikiToken.label,
      target: wikiToken.target,
    };
  }

  const markdownToken = findMarkdownLinkTokens(value)[0];
  if (markdownToken?.from === 0 && markdownToken.to === value.length) {
    return classifyTarget(
      rawValue,
      markdownToken.label,
      markdownToken.href,
      "markdown-link",
      true,
    );
  }

  if (/^(?:\.\.?[\\/]|[\\/])/.test(value)) {
    return {
      syntax: "workspace-path",
      raw: rawValue,
      label: value,
      target: value,
    };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return classifyTarget(rawValue, value, value, "url", false);
  }

  return null;
}

function classifyTarget(
  raw: string,
  label: string,
  target: string,
  syntax: DocumentReferenceSyntax,
  relativeIsWorkspace: boolean,
): ParsedReferenceIntent {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("//")) {
    if (relativeIsWorkspace) return { syntax, raw, label, target };
    return denied(raw, syntax, "invalid-url", label);
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return denied(raw, syntax, "invalid-url", label);
  }
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    return denied(raw, syntax, "unsafe-protocol", label);
  }
  if (
    (url.protocol === "http:" || url.protocol === "https:")
    && (!url.hostname || url.username || url.password)
  ) {
    return denied(raw, syntax, url.username || url.password ? "credentials" : "invalid-url", label);
  }
  if (url.protocol === "mailto:" && !url.pathname) {
    return denied(raw, syntax, "invalid-url", label);
  }
  return {
    syntax,
    raw,
    label,
    href: url.toString(),
  };
}

function denied(
  raw: string,
  syntax: DocumentReferenceSyntax,
  reason: DocumentDeniedReference["reason"],
  label = raw,
): DocumentDeniedReference {
  return { kind: "denied", syntax, raw, label, reason };
}

function uniquePaths(paths: readonly string[]): string[] {
  return paths.filter((path, index) => Boolean(path) && paths.indexOf(path) === index);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
