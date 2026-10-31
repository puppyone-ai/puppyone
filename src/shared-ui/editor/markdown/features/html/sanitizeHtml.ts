import {
  isAllowedHtmlAttribute,
  isAllowedHtmlTag,
  isAllowedStyleProperty,
  isBlockedHtmlTag,
  isBooleanHtmlAttribute,
  isNumericHtmlAttribute,
  isSafeStyleValue,
  isVoidHtmlTag,
  type HtmlSanitizerMode,
} from "../../platform/policy/markdownHtmlSanitizerPolicy";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import type { MarkdownHtmlSanitizerCapabilities } from "../../platform/policy/markdownHtmlProfiles";
import { normalizeMarkdownHtmlAlignment } from "../../platform/policy/markdownHtmlProfiles";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";

export type MarkdownTextRenderer = (target: Node, text: string) => void;

export type SanitizedHtmlResult = {
  fragment: DocumentFragment;
  supported: boolean;
  reasons: string[];
};

type SanitizeContext = {
  mode: HtmlSanitizerMode;
  strict: boolean;
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
    mode: "inline",
    strict: false,
    reasons: [],
    renderText,
    capabilities: options,
  };

  appendSanitizedChildren(target, source, context);
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
    strict: true,
    reasons: [],
    capabilities: options,
  };
  const fragment = document.createDocumentFragment();
  appendSanitizedChildren(fragment, template.content, context);

  return {
    fragment,
    supported: context.reasons.length === 0,
    reasons: Array.from(new Set(context.reasons)),
  };
}

function appendSanitizedChildren(target: Node, source: DocumentFragment | HTMLElement, context: SanitizeContext) {
  for (const child of Array.from(source.childNodes)) {
    appendSanitizedNode(target, child, context);
  }
}

function appendSanitizedNode(target: Node, node: ChildNode, context: SanitizeContext) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (context.renderText) context.renderText(target, text);
    else target.appendChild(document.createTextNode(text));
    return;
  }

  if (!(node instanceof HTMLElement)) return;

  const tagName = node.tagName.toLowerCase();
  if (isBlockedHtmlTag(tagName)) {
    markUnsupported(context, `<${tagName}> is not supported`, { fatal: true });
    return;
  }

  if (!isAllowedHtmlTag(tagName, context.mode, context.capabilities)) {
    markUnsupported(context, `<${tagName}> is not supported`, { fatal: true });
    if (!context.strict) appendSanitizedChildren(target, node, context);
    return;
  }

  const element = document.createElement(tagName);
  copySafeAttributes(element, node, tagName, context);
  if (tagName === "video") {
    // Safe Markdown video is always user-controlled and never auto-starts.
    element.setAttribute("controls", "");
    element.setAttribute("preload", element.getAttribute("preload") ?? "metadata");
    element.removeAttribute("autoplay");
  }

  if (isVoidHtmlTag(tagName)) {
    target.appendChild(element);
    return;
  }

  appendSanitizedChildren(element, node, context);
  target.appendChild(element);
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

    if ((tagName === "video" || tagName === "source") && name === "src") {
      if (context.capabilities.brokeredMedia && isBrokerSafeResolvedAssetUrl(value, "video")) {
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

    if (tagName === "img" && name === "srcset") {
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
      if (/^[1-9]\d{0,3}$/.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "video" && (name === "width" || name === "height")) {
      if (/^[1-9]\d{0,3}$/.test(value.trim())) target.setAttribute(name, value.trim());
      else markUnsupported(context, `${name} value was omitted`, { fatal: false });
      continue;
    }

    if (tagName === "video" && name === "preload") {
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
      if (/^video\/[a-z0-9.+-]+$/.test(type)) target.setAttribute("type", type);
      else markUnsupported(context, "video source type was omitted", { fatal: false });
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
      const scoped = value
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => /^[A-Za-z_][\w-]*$/.test(token) && !token.startsWith("cm-") && !token.startsWith("po-"))
        .map((token) => `md-doc-${token}`);
      if (scoped.length > 0) target.setAttribute(name, scoped.join(" "));
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
