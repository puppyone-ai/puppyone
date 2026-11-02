/**
 * Canonical URL / href safety for Markdown adapters.
 * Control characters and entity-obfuscated schemes must never bypass policy.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const RELATIVE_PREFIXES = ["#", "/", ".//", "../"] as const;

const HTML_NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", "\""],
]);

/** Decode HTML character references used to obfuscate schemes. */
export function decodeHtmlHrefEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi, (match, decimal, hex, name) => {
    if (name) return HTML_NAMED_ENTITIES.get(String(name).toLowerCase()) ?? match;
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "\ufffd";
    }
    return String.fromCodePoint(codePoint);
  });
}

/** Strip C0 / DEL controls that browsers ignore when normalizing URLs. */
export function stripHrefControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function canonicalizeMarkdownHref(href: string): string {
  return decodeHtmlHrefEntities(href).trim();
}

/**
 * Returns true only for relative paths or allowlisted absolute protocols.
 * Unknown / obfuscated schemes are denied (fail closed).
 */
export function isSafeHref(href: string): boolean {
  return getSafeMarkdownHref(href) !== null;
}

/** Validate and canonicalize in one operation so callers cannot validate one
 * representation and later activate another. */
export function getSafeMarkdownHref(href: string): string | null {
  const decoded = decodeHtmlHrefEntities(href);
  if (/[\u0000-\u001f\u007f]/.test(decoded) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(decoded)) {
    return null;
  }
  const value = decoded.trim();
  if (!value) return null;

  // Scheme-relative URLs are not part of the broad-safe profile.
  if (value.startsWith("//")) return null;

  // Relative / in-document references.
  if (RELATIVE_PREFIXES.some((prefix) => value.startsWith(prefix))) return value;

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!schemeMatch) {
    // No scheme: treat as a relative document path (e.g. note.md, ./x).
    // Reject values that still look like scheme smuggling after control strip.
    if (/^[a-z][a-z0-9+.-]*\s*:/i.test(value)) return null;
    return /[\s<>"'`]/.test(value) ? null : value;
  }

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (!SAFE_PROTOCOLS.has(protocol)) return null;

  try {
    const base =
      typeof window !== "undefined" && typeof window.location?.href === "string"
        ? window.location.href
        : "https://example.invalid/";
    const url = new URL(value, base);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    // Reject credentials in http(s) URLs.
    if ((url.protocol === "http:" || url.protocol === "https:") && (url.username || url.password)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function getSafeHrefProtocols(): ReadonlySet<string> {
  return SAFE_PROTOCOLS;
}
