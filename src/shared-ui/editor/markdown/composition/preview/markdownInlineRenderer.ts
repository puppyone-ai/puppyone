import {
  bindInlineHtmlDomInteractions,
  isStructurallyCompleteInlineHtmlSource,
} from "../../features/html/inlineHtmlDomAdapter";
import {
  escapeMarkdownHtmlText,
  MARKDOWN_EMBED_TARGET_PREFIX,
  renderMarkdownInlineToHtml,
} from "../../features/html/markdownHtmlRenderer";
import { appendSanitizedInlineHtml } from "../../features/html/sanitizeHtml";
import type {
  MarkdownAssetUrlResolver,
  MarkdownLinkCommands,
  MarkdownLinkGraph,
} from "../../../registry/viewerTypes";
import { hydrateDeferredHtmlMedia } from "../../features/html/htmlMediaHydration";
import { resolveMarkdownMediaReference } from "../../features/media/markdownMediaReference";
import { findWikiLinkTokens, type MarkdownWikiLinkToken } from "../../core/links/wikiLinkModel";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";

// The isolated string renderer is used by table cells and atomic previews. A
// pathological single line must never monopolize the application renderer.
// CodeMirror still displays the complete canonical source when rich inline
// parsing intentionally degrades to plain text.
export const MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS = 32 * 1024;

const RAW_MEDIA_PATTERN = /<(?:audio|img|picture|source|video)\b/i;

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
  /** For text nodes of already-parsed HTML, where `<` is literal content. */
  treatHtmlAsText?: boolean;
};

export function createMarkdownInlineFragment(
  source: string,
  options: MarkdownInlineRenderOptions = {},
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  renderMarkdownInlineInto(fragment, source, options);
  return fragment;
}

/**
 * One path for an isolated string: the editor's parser produces HTML, the shared
 * sanitizer reduces it, and media goes through the same hydration as the page.
 */
export function renderMarkdownInlineInto(
  target: Node,
  source: string,
  options: MarkdownInlineRenderOptions = {},
) {
  if (!source) return;
  if (source.length > MARKDOWN_INLINE_RICH_SOURCE_MAX_CHARS) {
    appendText(target, source);
    return;
  }

  const authoredHtml = !options.treatHtmlAsText && mightContainHtml(source);
  const resolver = options.resolveAssetUrl ?? null;
  if (authoredHtml && (
    !isStructurallyCompleteInlineHtmlSource(source)
    || (!resolver && RAW_MEDIA_PATTERN.test(source))
  )) {
    appendText(target, source);
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderMarkdownInlineToHtml(
    options.treatHtmlAsText ? escapeMarkdownHtmlText(source) : source,
  );
  const fragment = document.createDocumentFragment();
  const result = appendSanitizedInlineHtml(
    fragment,
    template.content,
    (node, text) => appendWikiLinkText(node, text, options),
    { deferredMedia: true },
  );
  if (!result.supported) {
    appendText(target, source);
    return;
  }

  bindInlineHtmlDomInteractions(fragment, { openHref: options.openHref });
  for (const code of fragment.querySelectorAll("code")) code.classList.add("cm-md-inline-code");
  for (const link of fragment.querySelectorAll("[data-md-href]")) link.classList.add("cm-md-inline-link");

  if (!resolver) {
    for (const image of fragment.querySelectorAll("img")) image.replaceWith(createImagePlaceholder(image));
    target.appendChild(fragment);
    return;
  }

  const media = document.createElement("span");
  media.appendChild(fragment);
  target.appendChild(media);
  const sourcePath = options.sourcePath ?? "";
  hydrateDeferredHtmlMedia({
    root: media,
    documentPath: sourcePath,
    resolver: async (documentPath, href, _kind, signal) => {
      const embedded = href.startsWith(MARKDOWN_EMBED_TARGET_PREFIX);
      const resolved = resolveMarkdownMediaReference(
        sourcePath,
        embedded ? href.slice(MARKDOWN_EMBED_TARGET_PREFIX.length) : href,
        embedded ? "wiki-target" : "markdown-path",
        options.markdownLinkGraph ?? null,
      );
      return resolved ? resolver(documentPath, resolved, signal) : null;
    },
    signal: new AbortController().signal,
    isCurrent: () => true,
    onLayoutChange: () => options.onLayoutChange?.(),
  });
}

function appendWikiLinkText(target: Node, text: string, options: MarkdownInlineRenderOptions) {
  let cursor = 0;
  for (const token of findWikiLinkTokens(text)) {
    appendText(target, text.slice(cursor, token.from));
    appendWikiLink(target, token, options);
    cursor = token.to;
  }
  appendText(target, text.slice(cursor));
}

function appendWikiLink(target: Node, token: MarkdownWikiLinkToken, options: MarkdownInlineRenderOptions) {
  const linkGraph = options.markdownLinkGraph ?? null;
  const sourcePath = options.sourcePath ?? "";
  const resolvedTarget = linkGraph?.resolveWikiLink(sourcePath, token.target) ?? null;

  if (!resolvedTarget?.exists) {
    const missing = document.createElement("span");
    missing.className = "cm-md-wiki-link-inline is-missing";
    missing.textContent = token.label;
    missing.setAttribute("aria-description", options.t
      ? options.t("editor.markdown.missingLinkedNote", { target: bidiIsolate(token.target) })
      : token.target);
    target.appendChild(missing);
    return;
  }

  const link = document.createElement("a");
  link.className = resolvedTarget.ambiguous
    ? "cm-md-wiki-link-inline is-resolved is-ambiguous"
    : "cm-md-wiki-link-inline is-resolved";
  link.textContent = token.label;
  link.setAttribute("aria-description", resolvedTarget.path ?? token.target);
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

function createImagePlaceholder(image: HTMLImageElement): HTMLElement {
  const label = document.createElement("span");
  label.className = "cm-md-image-placeholder";
  label.textContent = image.alt || (image.dataset.mdAssetSrc ?? "");
  return label;
}

function mightContainHtml(source: string): boolean {
  return /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>|<br\s*\/?>/i.test(source);
}
