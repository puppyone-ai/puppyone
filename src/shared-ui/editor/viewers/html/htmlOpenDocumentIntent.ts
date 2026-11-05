/** Documents a previewed HTML page may ask the host to open. Only text
 * documents that a viewer can show; never images, archives or executables. */
const OPENABLE_DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "mdx", "txt", "html"]);

export type HtmlDocumentOpenIntent = Readonly<{
  target: string;
  anchor: string | null;
}>;

/**
 * Converts one untrusted `href` into a host navigation intent, or `null`.
 * This is the only place frame content becomes a workspace path, so every
 * rejection rule lives here.
 */
export function parseHtmlDocumentOpenTarget(raw: string): HtmlDocumentOpenIntent | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : value.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf("?");
  const target = (queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex)).trim();
  if (!target) return null;

  if (target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  // Segment comparison, not a substring test: `a..b.md` is a legal file name.
  if (target.split("/").some((segment) => segment === "..")) return null;
  if (!hasOpenableExtension(target)) return null;

  return Object.freeze({ target, anchor: anchor === "" ? null : anchor });
}

export function isOpenableDocumentTarget(raw: string): boolean {
  return parseHtmlDocumentOpenTarget(raw) !== null;
}

function hasOpenableExtension(target: string): boolean {
  const match = /\.([a-z0-9]+)$/i.exec(target);
  return Boolean(match && OPENABLE_DOCUMENT_EXTENSIONS.has(match[1]!.toLowerCase()));
}
