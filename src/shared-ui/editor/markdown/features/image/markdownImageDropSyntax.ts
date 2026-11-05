const DROP_IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp",
]);

/** True for names a Markdown document can reference as an image. Extension
 * only: the document decides, not the file system. */
export function isDropImageName(name: string): boolean {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return Boolean(match && DROP_IMAGE_EXTENSIONS.has(match[1]!.toLowerCase()));
}

/**
 * Markdown destination from one workspace document to another. Both paths are
 * workspace-relative; `null` means the target cannot be expressed relative to
 * the document without leaving the workspace root.
 */
export function relativeMarkdownDestination(
  documentPath: string,
  targetPath: string,
): string | null {
  const documentSegments = splitWorkspacePath(documentPath);
  const targetSegments = splitWorkspacePath(targetPath);
  if (!documentSegments || !targetSegments) return null;
  const documentFolder = documentSegments.slice(0, -1);
  let shared = 0;
  while (
    shared < documentFolder.length
    && shared < targetSegments.length - 1
    && documentFolder[shared] === targetSegments[shared]
  ) {
    shared += 1;
  }
  const upward = documentFolder.length - shared;
  const rest = targetSegments.slice(shared).join("/");
  return upward === 0 ? rest : `${"../".repeat(upward)}${rest}`;
}

/** Markdown link destinations break on bare spaces and parentheses, and read
 * `#` / `?` as fragment and query. Angle brackets protect the first two;
 * percent-encoding protects the last two. */
export function escapeMarkdownDestination(destination: string): string {
  const normalized = destination.replace(/\\/g, "/")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  if (/[\s()]/.test(normalized)) return `<${normalized}>`;
  return normalized;
}

export function buildMarkdownImageSnippet(destination: string, alt: string): string {
  return `![${normalizeAltText(alt)}](${destination})`;
}

function normalizeAltText(alt: string): string {
  return alt
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\[\]])/g, "\\$1");
}

function splitWorkspacePath(value: string): string[] | null {
  if (!value || /^(?:\/|[a-z][a-z\d+.-]*:)/i.test(value)) return null;
  if (/[\\\u0000-\u001f]/.test(value)) return null;
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments : null;
}
