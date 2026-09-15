import { compileInlineHtmlRenderPlan } from "./inlineHtmlPolicy";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";
import type { MarkdownInlineHtml } from "./inlineHtmlModel";
import { scanMarkdownHtmlTagTokens } from "./htmlTagTokenizer";
import { validateMarkdownHtmlBlockStructure } from "./htmlBlockStructure";

export type InlineHtmlDomAdapterOptions = {
  /** LinkBroker-backed activation supplied by the preview host. */
  openHref?: (href: string) => void;
};

const boundInlineHtmlLinks = new WeakSet<Element>();

/**
 * Shared table-cell / preview helper: compile a single complete inline HTML
 * element through the same policy authority as live preview, then apply typed
 * attributes to a DOM element. Falls back to null when unsupported.
 */
export function createDomFromInlineHtmlSource(
  source: string,
  options: InlineHtmlDomAdapterOptions = {},
): HTMLElement | null {
  const trimmed = source.trim();
  if (!isStructurallyCompleteInlineHtmlSource(trimmed)) return null;
  const tokens = scanMarkdownHtmlTagTokens(trimmed);
  const open = tokens.find((token) => !token.closing && !token.selfClosing);
  const close = tokens.find((token) => token.closing && token.tagName === open?.tagName);
  if (!open || !close || close.from <= open.to) return null;

  const element: MarkdownInlineHtml = {
    kind: "inlineHtml",
    from: open.from,
    to: close.to,
    tagName: open.tagName,
    openingMarker: { from: open.from, to: open.to },
    contentRange: { from: open.to, to: close.from },
    closingMarker: { from: close.from, to: close.to },
    attributes: open.attributes,
    status: "complete",
    containerFrom: 0,
    containerTo: trimmed.length,
  };

  const policy = compileInlineHtmlRenderPlan(element);
  if (!policy.supported || policy.value.kind !== "mark") return null;

  const node = document.createElement(policy.value.tagName);
  node.classList.add("cm-md-inline-html");
  for (const [name, value] of Object.entries(policy.value.attributes)) {
    node.setAttribute(name, value);
  }
  node.textContent = trimmed.slice(open.to, close.from);
  bindInlineHtmlDomInteractions(node, options);
  return node;
}

/**
 * Browser HTML parsing repairs malformed fragments. Validate balanced source
 * first so preview surfaces can keep malformed/incomplete Markdown visible
 * instead of silently rendering a browser-invented structure.
 */
export function isStructurallyCompleteInlineHtmlSource(source: string): boolean {
  return validateMarkdownHtmlBlockStructure(source.trim()).status === "complete";
}

/**
 * Sanitizers emit inert `data-md-href` intents, never live browser `href`s.
 * The preview adapter explicitly binds those intents to a host-provided
 * LinkBroker wrapper. Without one, the DOM stays inert and is not advertised
 * as keyboard-actionable.
 */
export function bindInlineHtmlDomInteractions(
  root: ParentNode,
  options: InlineHtmlDomAdapterOptions = {},
): void {
  const links = [
    ...(root instanceof Element && root.hasAttribute("data-md-href") ? [root] : []),
    ...Array.from(root.querySelectorAll<Element>("[data-md-href]")),
  ];

  for (const link of Array.from(new Set(links))) {
    if (boundInlineHtmlLinks.has(link)) continue;
    const href = getSafeMarkdownHref(link.getAttribute("data-md-href") ?? "");
    link.removeAttribute("href");
    if (!options.openHref || !href) {
      link.removeAttribute("role");
      link.removeAttribute("tabindex");
      link.removeAttribute("data-md-link-interaction");
      link.setAttribute("data-po-content-interaction", "text");
      continue;
    }

    const activate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      options.openHref?.(href);
    };
    link.setAttribute("role", "link");
    link.setAttribute("tabindex", "0");
    link.setAttribute("data-md-link-interaction", "navigate");
    link.setAttribute("data-po-content-interaction", "navigation");
    boundInlineHtmlLinks.add(link);
    link.addEventListener("click", activate);
    link.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") activate(event);
    });
  }
}
