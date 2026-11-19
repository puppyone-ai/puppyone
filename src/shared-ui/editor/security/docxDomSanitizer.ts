export const CONTROLLED_DOCX_EXTERNAL_HREF_ATTRIBUTE = "data-puppyone-docx-external-href";
export const DEFAULT_MAX_DOCX_RENDERED_ELEMENTS = 150_000;
export const DEFAULT_MAX_DOCX_RENDERED_PAGES = 400;

const CONTROLLED_ATTRIBUTE_PREFIX = "data-puppyone-docx-";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

const BLOCKED_ELEMENT_NAMES = new Set([
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "textarea",
]);

const NAVIGATION_ATTRIBUTE_NAMES = new Set([
  "action",
  "background",
  "cite",
  "download",
  "formaction",
  "longdesc",
  "ping",
  "target",
  "usemap",
  "xml:base",
]);

const CSS_VALUE_ATTRIBUTE_NAMES = new Set([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
  "style",
]);

const SAFE_DATA_MIME_PATTERN = /^(?:image\/(?:avif|bmp|gif|jpeg|jpg|png|svg\+xml|webp)|font\/(?:otf|ttf|woff|woff2)|application\/(?:font-woff|vnd\.ms-fontobject|x-font-ttf))(?:;|,)/i;
const RAW_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_CONTROL_CHARACTER_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

export type DocxLinkPolicy =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string; protocol: "http:" | "https:" | "mailto:" }
  | { kind: "remove" };

export type DocxDomSanitizationReport = {
  removedElements: number;
  removedAttributes: number;
  removedStyleElements: number;
  preservedInternalLinks: number;
  markedExternalLinks: number;
};

export class DocxDomLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxDomLimitError";
  }
}

/** Rejects an unexpectedly large rendered tree before it is attached. */
export function assertDocxDomWithinBudget(
  root: ParentNode,
  {
    maxElements = DEFAULT_MAX_DOCX_RENDERED_ELEMENTS,
    maxPages = DEFAULT_MAX_DOCX_RENDERED_PAGES,
  }: { maxElements?: number; maxPages?: number } = {},
): void {
  if (!Number.isSafeInteger(maxElements) || maxElements <= 0) {
    throw new TypeError("DOCX element budget must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new TypeError("DOCX page budget must be a positive safe integer.");
  }

  const elementCount = root.querySelectorAll("*").length;
  if (elementCount > maxElements) {
    throw new DocxDomLimitError(
      `The Word preview produced ${elementCount} elements; the safe preview limit is ${maxElements}.`,
    );
  }
  const pageCount = root.querySelectorAll(".office-docx").length;
  if (pageCount > maxPages) {
    throw new DocxDomLimitError(
      `The Word preview produced ${pageCount} pages; the safe preview limit is ${maxPages}.`,
    );
  }
}

/**
 * Pure navigation policy used by the DOM sanitizer and by host click handlers.
 * Only same-document fragments remain navigable in the rendered document.
 * Web and mail links are returned as inert, host-controlled actions.
 */
export function classifyDocxLink(rawValue: string): DocxLinkPolicy {
  const value = rawValue.trim();
  if (!value || containsControlCharacters(value)) return { kind: "remove" };

  if (value.startsWith("#")) return { kind: "internal", href: value };

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
      return { kind: "remove" };
    }
    if ((url.protocol === "http:" || url.protocol === "https:") && (!url.hostname || url.username || url.password)) {
      return { kind: "remove" };
    }
    if (url.protocol === "mailto:" && !url.pathname) return { kind: "remove" };
    return {
      kind: "external",
      href: url.href,
      protocol: url.protocol,
    };
  } catch {
    return { kind: "remove" };
  }
}

/** Resource URLs never include network-capable protocols. */
export function isSafeDocxResourceUrl(rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value || containsControlCharacters(value)) return false;
  if (value === "about:blank") return true;
  if (value.startsWith("#")) return true;

  try {
    const url = new URL(value);
    if (url.protocol === "blob:") return true;
    if (url.protocol !== "data:") return false;
    return SAFE_DATA_MIME_PATTERN.test(value.slice("data:".length));
  } catch {
    return false;
  }
}

/**
 * Conservative CSS policy for docx-preview output. Safe embedded data/blob URLs
 * and fragment references survive; imports, network URLs, scriptable legacy CSS,
 * malformed url() tokens, and escaped keywords cause the whole declaration or
 * style element to be removed.
 */
export function containsUnsafeDocxCss(cssText: string): boolean {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  if (withoutComments.includes("/*") || withoutComments.includes("*/")) return true;
  if (
    /@import\b/i.test(withoutComments)
    || /expression\s*\(/i.test(withoutComments)
    || /(?:^|[;{\s])behavior\s*:/i.test(withoutComments)
    || /-moz-binding\s*:/i.test(withoutComments)
    || /javascript\s*:/i.test(withoutComments)
    // CSS escapes can disguise url(), expression(), and protocol names. The
    // generated Office CSS does not require escaped identifiers.
    || /\\(?:[0-9a-f]{1,6}\s?|.)/i.test(withoutComments)
  ) {
    return true;
  }

  const cssUrlPattern = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gis;
  let unsafeUrl = false;
  const unmatchedCss = withoutComments.replace(cssUrlPattern, (_token, _quote, quotedValue, bareValue) => {
    const value = String(quotedValue ?? bareValue ?? "").trim();
    if (!isSafeDocxResourceUrl(value)) unsafeUrl = true;
    return "";
  });

  return unsafeUrl || /url\s*\(/i.test(unmatchedCss);
}

/**
 * Deterministically sanitizes a rendered DOCX subtree. External links become
 * inert data markers; the host must attach a user-gesture handler that reads the
 * marker and opens it through a validated external-navigation capability.
 */
export function sanitizeDocxDom(root: ParentNode): DocxDomSanitizationReport {
  const report: DocxDomSanitizationReport = {
    removedElements: 0,
    removedAttributes: 0,
    removedStyleElements: 0,
    preservedInternalLinks: 0,
    markedExternalLinks: 0,
  };

  const elements = Array.from(root.querySelectorAll("*"));
  for (const element of elements) {
    const elementName = element.localName.toLowerCase();
    if (BLOCKED_ELEMENT_NAMES.has(elementName)) {
      element.remove();
      report.removedElements += 1;
      continue;
    }

    if (elementName === "style" && containsUnsafeDocxCss(element.textContent ?? "")) {
      element.remove();
      report.removedElements += 1;
      report.removedStyleElements += 1;
      continue;
    }

    let controlledExternalHref: string | null = null;
    for (const attribute of Array.from(element.attributes)) {
      const qualifiedName = attribute.name.toLowerCase();
      const localName = attribute.localName.toLowerCase();

      if (qualifiedName.startsWith(CONTROLLED_ATTRIBUTE_PREFIX)) {
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;
        continue;
      }
      if (localName.startsWith("on") || localName === "srcdoc" || localName === "srcset") {
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;
        continue;
      }
      if (NAVIGATION_ATTRIBUTE_NAMES.has(qualifiedName)) {
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;
        continue;
      }
      if (CSS_VALUE_ATTRIBUTE_NAMES.has(localName) && containsUnsafeDocxCss(attribute.value)) {
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;
        continue;
      }

      const isHref = localName === "href" || qualifiedName === "xlink:href";
      if (isHref) {
        const linkPolicy = classifyDocxLink(attribute.value);
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;

        if (linkPolicy.kind === "internal") {
          setDomAttribute(element, attribute, linkPolicy.href);
          report.preservedInternalLinks += 1;
        } else if (
          linkPolicy.kind === "external"
          && elementName === "a"
          && qualifiedName === "href"
        ) {
          controlledExternalHref = linkPolicy.href;
        } else if (
          (elementName === "image" || elementName === "img")
          && isSafeDocxResourceUrl(attribute.value)
        ) {
          setDomAttribute(element, attribute, attribute.value.trim());
        }
        continue;
      }

      if ((localName === "src" || localName === "poster") && !isSafeDocxResourceUrl(attribute.value)) {
        removeDomAttribute(element, attribute);
        report.removedAttributes += 1;
      }
    }

    if (controlledExternalHref) {
      element.setAttribute(CONTROLLED_DOCX_EXTERNAL_HREF_ATTRIBUTE, controlledExternalHref);
      element.setAttribute("role", "link");
      element.setAttribute("tabindex", "0");
      report.markedExternalLinks += 1;
    }
  }

  return report;
}

/** Revalidates the inert marker before a host-controlled open action. */
export function getControlledDocxExternalHref(element: Element): string | null {
  const rawValue = element.getAttribute(CONTROLLED_DOCX_EXTERNAL_HREF_ATTRIBUTE);
  if (!rawValue) return null;
  const policy = classifyDocxLink(rawValue);
  return policy.kind === "external" ? policy.href : null;
}

function containsControlCharacters(value: string): boolean {
  return RAW_CONTROL_CHARACTER_PATTERN.test(value) || ENCODED_CONTROL_CHARACTER_PATTERN.test(value);
}

function removeDomAttribute(element: Element, attribute: Attr) {
  if (attribute.namespaceURI) {
    element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
    return;
  }
  element.removeAttribute(attribute.name);
}

function setDomAttribute(element: Element, attribute: Attr, value: string) {
  if (attribute.namespaceURI === XLINK_NAMESPACE) {
    element.setAttributeNS(XLINK_NAMESPACE, "xlink:href", value);
    return;
  }
  element.setAttribute(attribute.name, value);
}
