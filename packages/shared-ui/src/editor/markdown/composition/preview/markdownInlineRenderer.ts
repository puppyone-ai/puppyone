import {
  bindInlineHtmlDomInteractions,
  createDomFromInlineHtmlSource,
  isStructurallyCompleteInlineHtmlSource,
} from "../../features/html/inlineHtmlDomAdapter";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";
import { appendSanitizedInlineHtml } from "../../features/html/sanitizeHtml";
import type {
  MarkdownAssetUrlResolver,
  MarkdownLinkCommands,
  MarkdownLinkGraph,
} from "../../../registry/viewerTypes";
import {
  findMarkdownImageTokens,
  parseMarkdownImageTokenAt,
  resolveMarkdownHtmlImageSources,
} from "../../features/image/markdownImageModel";
import {
  resolveMarkdownMediaReference,
  type MarkdownMediaReferenceKind,
} from "../../features/media/markdownMediaReference";
import { findWikiLinkTokens, type MarkdownWikiLinkToken } from "../../core/links/wikiLinkModel";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";

type InlineToken =
  | { kind: "code"; from: number; to: number; text: string }
  | { kind: "del" | "em" | "strong"; from: number; to: number; text: string }
  | {
      kind: "image";
      from: number;
      to: number;
      alt: string;
      href: string;
      title: string | null;
      referenceKind: MarkdownMediaReferenceKind;
    }
  | { kind: "link"; from: number; to: number; label: string; href: string }
  | { kind: "wikiLink"; from: number; to: number; token: MarkdownWikiLinkToken };

// The isolated string renderer is used by table cells and atomic previews. A
// pathological single line must never monopolize the application renderer.
// CodeMirror still displays the complete canonical source when rich inline
// parsing intentionally degrades to plain text.
export const MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS = 32 * 1024;
const MARKDOWN_INLINE_TOKEN_CANDIDATE_BUDGET = 256;
const MARKDOWN_INLINE_RENDER_MAX_DEPTH = 12;

type InlineParseBudget = {
  remainingCandidates: number;
};

export type MarkdownInlineRenderOptions = {
  markdownLinkGraph?: MarkdownLinkGraph | null;
  markdownLinkCommands?: MarkdownLinkCommands;
  /**
   * @deprecated Raw asset resolvers are no longer used by preview rendering.
   * Hosts must provide the AssetBroker-backed `resolveAssetUrl` callback.
   */
  markdownAssetUrlResolver?: MarkdownAssetUrlResolver | null;
  /**
   * Preferred asset entry point. When set, table/preview image loads go through
   * this callback (typically an AssetBroker wrapper) instead of the raw resolver.
   */
  resolveAssetUrl?: (
    documentPath: string,
    href: string,
    signal?: AbortSignal,
  ) => string | Promise<string | null> | null;
  onLayoutChange?: () => void;
  sourcePath?: string;
  openHref?: (href: string) => void;
  t?: MessageFormatter;
};

export function createMarkdownInlineFragment(
  source: string,
  options: MarkdownInlineRenderOptions = {},
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  renderMarkdownInlineInto(fragment, source, options);
  return fragment;
}

export function renderMarkdownInlineInto(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions = {},
) {
  renderMarkdownInlineIntoAtDepth(target, source, options, 0);
}

function renderMarkdownInlineIntoAtDepth(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions,
  depth: number,
) {
  if (!source) return;
  if (
    source.length > MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS
    || depth > MARKDOWN_INLINE_RENDER_MAX_DEPTH
  ) {
    appendText(target, source);
    return;
  }

  if (mightContainHtml(source)) {
    appendInlineHtml(target, source, options, depth);
    return;
  }

  appendMarkdownText(target, source, options, depth);
}

function appendInlineHtml(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions,
  depth: number,
) {
  const resolver = options.resolveAssetUrl ?? null;
  const containsImages = /<img\b/i.test(source);
  if (!containsImages || !resolver) {
    renderSanitizedInlineHtml(target, source, options, false, depth);
    return;
  }

  const targetNode = document.createElement("span");
  target.appendChild(targetNode);
  // Keep unresolved media honest while the broker evaluates every source.
  renderSanitizedInlineHtml(targetNode, source, options, false, depth);

  resolveMarkdownHtmlImageSources(source, options.sourcePath ?? "", resolver)
    .then((resolvedSource) => {
      if (targetNode instanceof HTMLElement && !targetNode.isConnected) return;
      targetNode.replaceChildren();
      renderSanitizedInlineHtml(targetNode, resolvedSource, {
        ...options,
        markdownAssetUrlResolver: null,
        resolveAssetUrl: undefined,
      }, true, depth);
      options.onLayoutChange?.();
    })
    .catch(() => undefined);
}

function renderSanitizedInlineHtml(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions,
  brokeredMedia: boolean,
  depth: number,
) {
  if (!isStructurallyCompleteInlineHtmlSource(source)) {
    appendText(target, source);
    return;
  }

  // Prefer the same policy compiler as live preview for a single complete
  // inline HTML element (common table-cell case).
  const trimmed = source.trim();
  if (/^<[a-z][\s\S]*>[\s\S]*<\/[a-z][\s\S]*>$/i.test(trimmed) && (trimmed.match(/</g) ?? []).length <= 2) {
    const planned = createDomFromInlineHtmlSource(trimmed, { openHref: options.openHref });
    if (planned) {
      // Preserve nested Markdown inside the HTML content by re-rendering the
      // inner text through the Markdown inline path.
      const inner = planned.textContent ?? "";
      planned.textContent = "";
      appendMarkdownText(planned, inner, options, depth + 1);
      target.appendChild(planned);
      return;
    }
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const fragment = document.createDocumentFragment();
  const result = appendSanitizedInlineHtml(
    fragment,
    template.content,
    (node, text) => appendMarkdownText(node, text, options, depth + 1),
    { brokeredMedia },
  );
  if (!result.supported) {
    appendText(target, source);
    return;
  }
  bindInlineHtmlDomInteractions(fragment, { openHref: options.openHref });
  target.appendChild(fragment);
}

function appendMarkdownText(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions,
  depth: number,
) {
  let cursor = 0;
  const budget: InlineParseBudget = {
    remainingCandidates: MARKDOWN_INLINE_TOKEN_CANDIDATE_BUDGET,
  };

  while (cursor < source.length) {
    const token = findNextToken(source, cursor, budget);
    if (!token) {
      appendText(target, source.slice(cursor));
      break;
    }

    if (token.from > cursor) {
      appendText(target, source.slice(cursor, token.from));
    }

    appendToken(target, token, options, depth);
    cursor = token.to;
  }
}

function appendToken(
  target: Node,
  token: InlineToken,
  options: MarkdownInlineRenderOptions,
  depth: number,
) {
  if (token.kind === "code") {
    const code = document.createElement("code");
    code.className = "cm-md-inline-code";
    code.textContent = token.text;
    target.appendChild(code);
    return;
  }

  if (token.kind === "wikiLink") {
    appendWikiLink(target, token.token, options);
    return;
  }

  if (token.kind === "image") {
    appendImage(target, token, options);
    return;
  }

  if (token.kind === "link") {
    const href = getSafeMarkdownHref(token.href);
    if (!href) {
      appendText(target, token.label);
      return;
    }

    const link = document.createElement("a");
    link.className = "cm-md-inline-link";
    link.setAttribute("data-md-href", href);
    link.rel = "noreferrer noopener";
    renderMarkdownInlineIntoAtDepth(link, token.label, options, depth + 1);
    bindInlineHtmlDomInteractions(link, { openHref: options.openHref });
    target.appendChild(link);
    return;
  }

  const element = document.createElement(token.kind);
  renderMarkdownInlineIntoAtDepth(element, token.text, options, depth + 1);
  target.appendChild(element);
}

function appendWikiLink(target: Node, token: MarkdownWikiLinkToken, options: MarkdownInlineRenderOptions) {
  const linkGraph = options.markdownLinkGraph ?? null;
  const sourcePath = options.sourcePath ?? "";
  const resolvedTarget = linkGraph?.resolveWikiLink(sourcePath, token.target) ?? null;

  if (!resolvedTarget?.exists) {
    const missing = document.createElement("span");
    missing.className = "cm-md-wiki-link-inline is-missing";
    missing.textContent = token.label;
    missing.title = options.t
      ? options.t("editor.markdown.missingLinkedNote", { target: bidiIsolate(token.target) })
      : token.target;
    target.appendChild(missing);
    return;
  }

  const link = document.createElement("a");
  link.className = resolvedTarget.ambiguous
    ? "cm-md-wiki-link-inline is-resolved is-ambiguous"
    : "cm-md-wiki-link-inline is-resolved";
  link.textContent = token.label;
  link.title = resolvedTarget.path ?? token.target;
  const openWikiLink = options.markdownLinkCommands?.openWikiLink;
  if (!openWikiLink) {
    target.appendChild(link);
    return;
  }
  link.setAttribute("role", "link");
  link.setAttribute("tabindex", "0");
  link.setAttribute("data-md-link-interaction", "navigate");
  link.setAttribute("data-po-content-interaction", "navigation");
  const activate = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    openWikiLink(resolvedTarget, sourcePath);
  };
  link.addEventListener("click", activate);
  link.addEventListener("keydown", (event) => {
    if (event.key === "Enter") activate(event);
  });
  target.appendChild(link);
}

function appendText(target: Node, text: string) {
  if (text) target.appendChild(document.createTextNode(text));
}

function findNextToken(
  source: string,
  start: number,
  budget: InlineParseBudget,
): InlineToken | null {
  for (let index = start; index < source.length; index += 1) {
    if (!isPotentialInlineTokenStart(source[index])) continue;
    if (budget.remainingCandidates <= 0) return null;
    budget.remainingCandidates -= 1;
    const token =
      parseCodeToken(source, index) ??
      parseWikiLinkToken(source, index) ??
      parseImageToken(source, index) ??
      parseLinkToken(source, index) ??
      parseDelimitedToken(source, index, "**", "strong") ??
      parseDelimitedToken(source, index, "__", "strong") ??
      parseDelimitedToken(source, index, "~~", "del") ??
      parseEmphasisToken(source, index, "*") ??
      parseEmphasisToken(source, index, "_");

    if (token) return token;
  }

  return null;
}

function isPotentialInlineTokenStart(character: string | undefined): boolean {
  return character === "`"
    || character === "["
    || character === "!"
    || character === "*"
    || character === "_"
    || character === "~";
}

function appendImage(
  target: Node,
  token: Extract<InlineToken, { kind: "image" }>,
  options: MarkdownInlineRenderOptions,
) {
  const resolver = options.resolveAssetUrl ?? null;
  const sourcePath = options.sourcePath ?? "";
  const resolvedHref = resolveMarkdownMediaReference(
    sourcePath,
    token.href,
    token.referenceKind,
    options.markdownLinkGraph ?? null,
  );
  if (!resolver || !resolvedHref) {
    target.appendChild(createImagePlaceholder(token.alt || token.href));
    return;
  }

  const placeholder = createLoadingImagePlaceholder();
  target.appendChild(placeholder);

  Promise.resolve(resolver(sourcePath, resolvedHref))
    .then((resolvedUrl) => {
      if (!placeholder.isConnected) return;
      if (resolvedUrl && isBrokerSafeResolvedAssetUrl(resolvedUrl)) {
        placeholder.after(createImageElement(
          resolvedUrl,
          token.alt,
          token.title,
          placeholder,
          token.alt || token.href,
          options.onLayoutChange,
        ));
      } else {
        placeholder.replaceWith(createImagePlaceholder(token.alt || token.href));
      }
      options.onLayoutChange?.();
    })
    .catch(() => {
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(createImagePlaceholder(token.alt || token.href));
      options.onLayoutChange?.();
    });
}

function createImageElement(
  source: string,
  alt: string,
  title: string | null,
  placeholder: HTMLElement,
  fallbackLabel: string,
  onLayoutChange: (() => void) | undefined,
): HTMLImageElement {
  const image = document.createElement("img");
  image.alt = alt;
  image.decoding = "async";
  image.hidden = true;
  image.dataset.previewState = "loading";
  image.setAttribute("aria-hidden", "true");
  if (title) image.title = title;
  image.addEventListener("load", () => {
    const reveal = () => {
      if (!image.isConnected || !placeholder.isConnected) return;
      image.hidden = false;
      image.dataset.previewState = "ready";
      image.removeAttribute("aria-hidden");
      placeholder.remove();
      onLayoutChange?.();
    };
    if (typeof image.decode !== "function") {
      reveal();
      return;
    }
    void image.decode().catch(() => undefined).then(reveal);
  }, { once: true });
  image.addEventListener("error", () => {
    if (!image.isConnected || !placeholder.isConnected) return;
    image.remove();
    placeholder.textContent = fallbackLabel;
    onLayoutChange?.();
  }, { once: true });
  image.src = source;
  return image;
}

function createImagePlaceholder(labelText: string): HTMLElement {
  const label = document.createElement("span");
  label.className = "cm-md-image-placeholder";
  label.textContent = labelText;
  return label;
}

function createLoadingImagePlaceholder(): HTMLElement {
  const placeholder = createImagePlaceholder("");
  placeholder.classList.add("is-loading");
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

function parseWikiLinkToken(source: string, from: number): InlineToken | null {
  if (!source.startsWith("[[", from)) return null;
  if (isEscaped(source, from)) return null;
  const token = findWikiLinkTokens(source.slice(from))[0] ?? null;
  if (!token || token.from !== 0) return null;
  const shiftedToken = {
    ...token,
    from: token.from + from,
    to: token.to + from,
    openingFrom: token.openingFrom + from,
    openingTo: token.openingTo + from,
    targetFrom: token.targetFrom + from,
    targetTo: token.targetTo + from,
    aliasFrom: token.aliasFrom === null ? null : token.aliasFrom + from,
    aliasTo: token.aliasTo === null ? null : token.aliasTo + from,
    closingFrom: token.closingFrom + from,
    closingTo: token.closingTo + from,
  };
  return {
    kind: "wikiLink",
    from: shiftedToken.from,
    to: shiftedToken.to,
    token: shiftedToken,
  };
}

function parseCodeToken(source: string, from: number): InlineToken | null {
  if (source[from] !== "`") return null;
  const to = source.indexOf("`", from + 1);
  if (to <= from + 1) return null;
  return {
    kind: "code",
    from,
    to: to + 1,
    text: source.slice(from + 1, to),
  };
}

function parseLinkToken(source: string, from: number): InlineToken | null {
  if (source[from] !== "[" || source[from - 1] === "!") return null;

  const labelTo = source.indexOf("]", from + 1);
  if (labelTo <= from + 1 || source[labelTo + 1] !== "(") return null;

  const hrefTo = findClosingParen(source, labelTo + 2);
  if (hrefTo <= labelTo + 2) return null;

  return {
    kind: "link",
    from,
    to: hrefTo + 1,
    label: source.slice(from + 1, labelTo),
    href: source.slice(labelTo + 2, hrefTo).trim(),
  };
}

function parseImageToken(source: string, from: number): InlineToken | null {
  const token = parseMarkdownImageTokenAt(source, from);
  if (!token) return null;

  return {
    kind: "image",
    from: token.from,
    to: token.to,
    alt: token.alt,
    href: token.href,
    title: token.title,
    referenceKind: token.referenceKind,
  };
}

function parseDelimitedToken(
  source: string,
  from: number,
  delimiter: string,
  kind: "del" | "strong",
): InlineToken | null {
  if (!source.startsWith(delimiter, from)) return null;

  const contentFrom = from + delimiter.length;
  const closingFrom = source.indexOf(delimiter, contentFrom);
  if (closingFrom <= contentFrom) return null;

  const text = source.slice(contentFrom, closingFrom);
  if (!text.trim()) return null;

  return {
    kind,
    from,
    to: closingFrom + delimiter.length,
    text,
  };
}

function parseEmphasisToken(source: string, from: number, delimiter: "*" | "_"): InlineToken | null {
  if (source[from] !== delimiter) return null;
  if (source[from + 1] === delimiter || source[from - 1] === delimiter) return null;

  const contentFrom = from + 1;
  let closingFrom = source.indexOf(delimiter, contentFrom);
  while (closingFrom > contentFrom && source[closingFrom + 1] === delimiter) {
    closingFrom = source.indexOf(delimiter, closingFrom + 2);
  }

  if (closingFrom <= contentFrom) return null;

  const text = source.slice(contentFrom, closingFrom);
  if (!text.trim()) return null;

  return {
    kind: "em",
    from,
    to: closingFrom + 1,
    text,
  };
}

function findClosingParen(source: string, start: number): number {
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === ")") return index;
  }
  return -1;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function mightContainHtml(source: string): boolean {
  return /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>|<br\s*\/?>/i.test(source);
}
