import {
  isAllowedHtmlAttribute,
  isAllowedHtmlTag,
  isAllowedStyleProperty,
  isBlockedHtmlTag,
  isBooleanHtmlAttribute,
  isNumericHtmlAttribute,
  isSafeColorValue,
  isSafeStyleValue,
  isVoidHtmlTag,
  type HtmlSanitizerMode,
} from "../../platform/policy/markdownHtmlSanitizerPolicy";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import type { MarkdownHtmlSanitizerCapabilities } from "../../platform/policy/markdownHtmlProfiles";
import {
  isPassiveMediaHtmlTag,
  isSafeSvgAttribute,
  isSafeSvgTag,
  normalizeMarkdownHtmlAlignment,
} from "../../platform/policy/markdownHtmlProfiles";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";

export type MarkdownTextRenderer = (target: Node, text: string) => void;

export type SanitizedHtmlResult = {
  fragment: DocumentFragment;
  supported: boolean;
  reasons: string[];
};

const HTML_DIMENSION_PATTERN = /^[1-9]\d{0,3}(?:%|px)?$/;
const HTML_SOURCE_CONDITION_MAX_LENGTH = 256;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_TEXT_TAGS = new Set(["desc", "text", "title", "tspan"]);

/** Removing these keeps their raw payload from surfacing as document text. */
const BLOCKED_TAGS_DROPPED_WITH_CONTENT = new Set([
  "embed",
  "iframe",
  "object",
  "script",
  "style",
  "template",
]);

type SanitizeContext = {
  mode: HtmlSanitizerMode;
  reasons: string[];
  renderText?: MarkdownTextRenderer;
  capabilities: MarkdownHtmlSanitizerCapabilities;
};

export type MarkdownHtmlSanitizerOptions = MarkdownHtmlSanitizerCapabilities;

export function appendSanitizedInlineHtml(
  target: Node,
  source: DocumentFragment | HTMLElement,
  renderText: MarkdownTextRenderer,
  options: MarkdownHtmlSanitizerOptions = {},
): Pick<SanitizedHtmlResult, "supported" | "reasons"> {
  const context: SanitizeContext = {
    mode: "block",
    reasons: [],
    renderText,
    capabilities: options,
  };

  appendSanitizedChildren(target, source, context, 0);
  return {
    supported: context.reasons.length === 0,
    reasons: Array.from(new Set(context.reasons)),
  };
}

export function createSanitizedBlockHtmlFragment(
  source: string,
  options: MarkdownHtmlSanitizerOptions = {},
): SanitizedHtmlResult {
  const template = document.createElement("template");
  template.innerHTML = source;

  const context: SanitizeContext = {
    mode: "block",
    reasons: [],
    capabilities: options,
  };
  const fragment = document.createDocumentFragment();
  appendSanitizedChildren(fragment, template.content, context, 0);

  return {
    fragment,
    supported: context.reasons.length === 0,
    reasons: Array.from(new Set(context.reasons)),
  };
}

function appendSanitizedChildren(
  target: Node,
  source: DocumentFragment | HTMLElement,
  context: SanitizeContext,
  depth: number,
) {
  for (const child of Array.from(source.childNodes)) {
    appendSanitizedNode(target, child, context, depth);
  }
}

function appendSanitizedNode(target: Node, node: ChildNode, context: SanitizeContext, depth: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (context.renderText) context.renderText(target, text);
    else target.appendChild(document.createTextNode(text));
    return;
  }

  if (node instanceof SVGElement) {
    appendSanitizedSvg(target, node);
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tagName = node.tagName.toLowerCase();
  if (isBlockedHtmlTag(tagName)) {
    // A blocked root has no honest projection. Nested inside a safe element it
    // is removed on its own so one tag cannot hide the surrounding document.
    if (depth === 0) markUnsupported(context, `<${tagName}> is not supported`, { fatal: true });
    else if (!BLOCKED_TAGS_DROPPED_WITH_CONTENT.has(tagName)) {
      appendSanitizedChildren(target, node, context, depth + 1);
    }
    return;
  }

  if (!isAllowedHtmlTag(tagName, context.mode, context.capabilities)) {
    if (isPassiveMediaHtmlTag(tagName)) {
      markUnsupported(context, `<${tagName}> requires AssetBroker`, { fatal: true });
      return;
    }
    // Unknown structure carries no capability: drop the tag, keep its content.
    appendSanitizedChildren(target, node, context, depth + 1);
    return;
  }

  const element = document.createElement(tagName);
  copySafeAttributes(element, node, tagName, context);
  if (tagName === "video" || tagName === "audio") {
    // Safe Markdown media is always user-controlled and never auto-starts.
    element.setAttribute("controls", "");
    element.setAttribute("preload", element.getAttribute("preload") ?? "metadata");
    element.removeAttribute("autoplay");
  }

  if (isVoidHtmlTag(tagName)) {
    target.appendChild(element);
    return;
  }

  appendSanitizedChildren(element, node, context, depth + 1);
  target.appendChild(element);
}

/** Rebuilt in a fresh namespace node, so nothing unlisted can reach the document. */
function appendSanitizedSvg(target: Node, node: SVGElement) {
  const localName = node.localName;
  if (!isSafeSvgTag(localName)) return;
  const element = document.createElementNS(SVG_NAMESPACE, localName);
  for (const attribute of Array.from(node.attributes)) {
    const value = sanitizeSvgAttributeValue(attribute.name, attribute.value);
    if (value !== null) element.setAttribute(attribute.name, value);
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (SVG_TEXT_TAGS.has(localName.toLowerCase())) element.appendChild(document.createTextNode(child.textContent ?? ""));
    } else if (child instanceof SVGElement) {
      appendSanitizedSvg(element, child);
    }
  }
  target.appendChild(element);
}

function sanitizeSvgAttributeValue(name: string, value: string): string | null {
  if (!isSafeSvgAttribute(name)) return null;
  const lowerName = name.toLowerCase();
  // Local paint references stay inside this drawing; ids share the document scope.
  if (lowerName === "id") return /^[A-Za-z_][\w-]*$/.test(value) ? `md-doc-${value}` : null;
  const reference = /^url\(#([A-Za-z_][\w-]*)\)$/.exec(value.trim());
  if (reference) return `url(#md-doc-${reference[1]})`;
  return /url\s*\(|javascript:|expression\s*\(/i.test(value) ? null : value;
}

function copySafeAttributes(target: HTMLElement, source: HTMLElement, tagName: string, context: SanitizeContext) {
  for (const attribute of Array.from(source.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith("on")) {
      // Event capability is removable without changing the element's honest
      // structure. Keep the safe element and omit only the handler.
      markUnsupported(context, `event handler "${name}" was omitted`, { fatal: false });
      continue;
    }

    if (!isAllowedHtmlAttribute(tagName, name, context.mode, context.capabilities)) {
      markUnsupported(context, `attribute "${name}" was omitted`, { fatal: false });
      continue;
    }

    if (name === "style") {
      copySafeInlineStyles(target, source, tagName, context);
      continue;
    }

    if (tagName === "a" && name === "href") {
      const href = getSafeMarkdownHref(value);
      if (href) {
        // Never mount a live href in editor/preview DOM. Activation is mediated.
        target.setAttribute("data-md-href", href);
        target.setAttribute("role", "link");
        target.setAttribute("tabindex", "0");
        target.removeAttribute("href");
      } else {
        markUnsupported(context, "unsafe link URL is not supported", { fatal: true });
      }
      continue;
    }

    if (tagName === "a" && name === "name") {
      // The legacy target form shares the id namespace; an explicit id wins.
      if (source.hasAttribute("id")) continue;
      const scoped = scopeDocumentToken(value);
      if (scoped) target.setAttribute("id", scoped);
      else markUnsupported(context, "anchor name was omitted", { fatal: false });
      continue;
    }

    if ((tagName === "img" && name === "align") || (tagName === "table" && name === "align")) {
      // These are placement hints rather than text alignment, so the browser
      // has to receive the attribute itself.
      const allowed = tagName === "img"
        ? /^(?:left|right|center|top|middle|bottom)$/i
        : /^(?:left|right|center)$/i;
      if (allowed.test(value.trim())) target.setAttribute("align", value.trim().toLowerCase());
      else markUnsupported(context, "align value was omitted", { fatal: false });
      continue;
    }

    if (
      (tagName === "table" || tagName === "td" || tagName === "th")
      && (name === "width" || name === "height")
    ) {
      if (HTML_DIMENSION_PATTERN.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if ((tagName === "td" || tagName === "th") && name === "valign") {
      if (/^(?:top|middle|bottom|baseline)$/i.test(value.trim())) {
        target.setAttribute("valign", value.trim().toLowerCase());
      } else {
        markUnsupported(context, "valign value was omitted", { fatal: false });
      }
      continue;
    }

    if (tagName === "font") {
      const safe = name === "color"
        ? isSafeColorValue(value.trim(), false)
        : name === "size"
          ? /^[+-]?[1-7]$/.test(value.trim())
          : /^[\w ,-]{1,64}$/.test(value.trim());
      if (safe) target.setAttribute(name, value.trim());
      else markUnsupported(context, `font ${name} was omitted`, { fatal: false });
      continue;
    }

    if ((tagName === "meter" || tagName === "progress") && name !== "class" && name !== "id" && name !== "style") {
      if (/^-?\d{1,9}(?:\.\d{1,6})?$/.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "ol" && name === "start") {
      if (/^-?\d{1,6}$/.test(value.trim())) target.setAttribute("start", value.trim());
      else markUnsupported(context, "start value was omitted", { fatal: false });
      continue;
    }

    if (tagName === "ol" && name === "type") {
      if (/^[1aAiI]$/.test(value.trim())) target.setAttribute("type", value.trim());
      else markUnsupported(context, "list type was omitted", { fatal: false });
      continue;
    }

    if (tagName === "source" && (name === "media" || name === "sizes")) {
      if (isSafeSourceCondition(value)) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (name === "align") {
      const alignment = normalizeMarkdownHtmlAlignment(value);
      if (alignment) target.style.textAlign = alignment;
      else markUnsupported(context, "align value was omitted", { fatal: false });
      continue;
    }

    if (tagName === "img" && name === "src") {
      if (context.capabilities.brokeredMedia && isBrokerSafeResolvedAssetUrl(value)) {
        target.setAttribute("src", value.trim());
      } else if (context.capabilities.deferredMedia) {
        target.setAttribute("data-md-asset-src", value);
        target.setAttribute("aria-busy", "true");
      } else {
        markUnsupported(context, "image source was not resolved by AssetBroker");
      }
      continue;
    }

    if ((tagName === "video" || tagName === "audio" || tagName === "source") && name === "src") {
      const kind = tagName === "audio" ? "audio" : "video";
      if (context.capabilities.brokeredMedia && isBrokerSafeResolvedAssetUrl(value, kind)) {
        target.setAttribute("src", value.trim());
      } else if (context.capabilities.deferredMedia) {
        target.setAttribute("data-md-asset-src", value);
        target.setAttribute("aria-busy", "true");
      } else {
        markUnsupported(context, "video source was not resolved by AssetBroker");
      }
      continue;
    }

    if (tagName === "video" && name === "poster") {
      if (context.capabilities.brokeredMedia && isBrokerSafeResolvedAssetUrl(value, "image")) {
        target.setAttribute("poster", value.trim());
      } else if (context.capabilities.deferredMedia) {
        target.setAttribute("data-md-asset-poster", value);
        target.setAttribute("aria-busy", "true");
      } else {
        markUnsupported(context, "video poster was not resolved by AssetBroker");
      }
      continue;
    }

    if ((tagName === "img" || tagName === "source") && name === "srcset") {
      if (context.capabilities.brokeredMedia && isBrokerSafeImageSrcset(value)) {
        target.setAttribute("srcset", value.trim());
      } else if (context.capabilities.deferredMedia) {
        target.setAttribute("data-md-asset-srcset", value);
        target.setAttribute("aria-busy", "true");
      } else {
        markUnsupported(context, "image srcset was not resolved by AssetBroker");
      }
      continue;
    }

    if (tagName === "img" && name === "alt") {
      target.setAttribute("alt", value);
      continue;
    }

    if (tagName === "img" && name === "loading") {
      const loading = value.trim().toLowerCase();
      if (loading === "lazy" || loading === "eager" || loading === "auto") target.setAttribute("loading", loading);
      else markUnsupported(context, "image loading value was omitted", { fatal: false });
      continue;
    }

    if (tagName === "img" && (name === "width" || name === "height")) {
      if (HTML_DIMENSION_PATTERN.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "video" && (name === "width" || name === "height")) {
      if (/^[1-9]\d{0,3}$/.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if ((tagName === "video" || tagName === "audio") && name === "preload") {
      const preload = value.trim().toLowerCase();
      if (preload === "none" || preload === "metadata") target.setAttribute("preload", preload);
      else {
        target.setAttribute("preload", "metadata");
        markUnsupported(context, "video preload value was reduced to metadata", { fatal: false });
      }
      continue;
    }

    if (tagName === "source" && name === "type") {
      const type = value.trim().toLowerCase();
      if (/^(?:audio|image|video)\/[a-z0-9.+-]+$/.test(type)) target.setAttribute("type", type);
      else markUnsupported(context, "media source type was omitted", { fatal: false });
      continue;
    }

    if (isBooleanHtmlAttribute(tagName, name)) {
      target.setAttribute(name, "");
      continue;
    }

    if (isNumericHtmlAttribute(tagName, name)) {
      if (/^[1-9]\d?$/.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "a" && name === "target") {
      if (value.trim() === "_blank") target.setAttribute("target", "_blank");
      else markUnsupported(context, `target "${value}" was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "a" && name === "rel") {
      const rel = value
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token === "nofollow" || token === "noopener" || token === "noreferrer");
      if (rel.length > 0) target.setAttribute("rel", Array.from(new Set(rel)).join(" "));
      else markUnsupported(context, `rel "${value}" was omitted`, { fatal: false });
      continue;
    }

    if (name === "title" || name === "aria-label" || name === "dir" || name === "lang") {
      target.setAttribute(name, value);
      continue;
    }

    if (name === "class" || name === "id") {
      const scoped = scopeDocumentToken(value);
      if (scoped) target.setAttribute(name, scoped);
      else markUnsupported(context, `attribute "${name}" was omitted`, { fatal: false });
      continue;
    }

    // The versioned profile explicitly allowed this attribute, and every
    // capability-bearing attribute has already gone through a typed branch.
    target.setAttribute(name, value);
  }
}

function copySafeInlineStyles(
  target: HTMLElement,
  source: HTMLElement,
  tagName: string,
  context: SanitizeContext,
) {
  for (const property of Array.from(source.style)) {
    const name = property.toLowerCase();
    const value = source.style.getPropertyValue(property);
    if (!isAllowedStyleProperty(name, context.mode, tagName, context.capabilities)) {
      markUnsupported(context, `style "${name}" was omitted`, { fatal: false });
      continue;
    }
    if (!isSafeStyleValue(name, value)) {
      markUnsupported(context, `style value for "${name}" was omitted`, { fatal: false });
      continue;
    }
    target.style.setProperty(name, value.trim());
  }
}

function scopeDocumentToken(value: string): string | null {
  const scoped = value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[A-Za-z_][\w-]*$/.test(token) && !token.startsWith("cm-") && !token.startsWith("po-"))
    .map((token) => `md-doc-${token}`);
  return scoped.length > 0 ? scoped.join(" ") : null;
}

/** A media condition selects among brokered candidates and never loads anything. */
function isSafeSourceCondition(value: string): boolean {
  const condition = value.trim();
  return (
    condition.length > 0
    && condition.length <= HTML_SOURCE_CONDITION_MAX_LENGTH
    && !/[<>{};]|url\s*\(/i.test(condition)
  );
}

function markUnsupported(context: SanitizeContext, reason: string, options: { fatal?: boolean } = {}) {
  // Capability reduction: a denied attribute/style does not invalidate an
  // otherwise honest element on either inline or block surfaces.
  if (options.fatal === false) return;
  context.reasons.push(reason);
}

function isBrokerSafeImageSrcset(value: string): boolean {
  const candidates = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return candidates.length > 0 && candidates.every((candidate) => {
    const [url, descriptor, ...rest] = candidate.split(/\s+/);
    if (!url || rest.length > 0 || !isBrokerSafeResolvedAssetUrl(url)) return false;
    return descriptor == null || /^(?:\d+(?:\.\d+)?x|\d+w)$/.test(descriptor);
  });
}
