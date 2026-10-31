/**
 * Versioned broad-safe HTML profiles (architecture §6.4).
 * Profiles are non-escalating: a surface receives only its selected profile.
 */
export const MARKDOWN_HTML_PROFILE_VERSION = "2026-08-06.1" as const;

export type MarkdownHtmlProfileId =
  | "inline-editable"
  | "safe-block"
  | "safe-media"
  | "external-web-embed"
  | "svg-mermaid";

const INLINE_EDITABLE_TAGS = [
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "del",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
] as const;

const SAFE_BLOCK_TAGS = [
  ...INLINE_EDITABLE_TAGS,
  "article",
  "blockquote",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

// Only media that has a shipped, broker-backed DOM adapter belongs in this
// profile. Every network-capable sink below has a shipped broker-backed DOM
// adapter; declaring a tag here without one would advertise ambient browser
// loading that the product does not actually mediate.
const SAFE_MEDIA_TAGS = ["img", "source", "video"] as const;

const SAFE_BLOCK_ALIGN_TAGS = [
  "blockquote",
  "caption",
  "div",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "td",
  "th",
] as const;

const BLOCKED_EXECUTABLE_TAGS = [
  "base",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "template",
] as const;

const INLINE_STYLE_PROPERTIES = [
  "background-color",
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration",
  "text-decoration-line",
  "vertical-align",
] as const;

const BLOCK_STYLE_PROPERTIES = [
  ...INLINE_STYLE_PROPERTIES,
  "background",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-style",
  "border-bottom-width",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-style",
  "border-top-width",
  "border-width",
  "cursor",
  "display",
  "flex-wrap",
  "gap",
  "height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-width",
  "min-width",
  "overflow",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "width",
] as const;

export const MARKDOWN_HTML_PROFILES = {
  version: MARKDOWN_HTML_PROFILE_VERSION,
  "inline-editable": {
    id: "inline-editable" as const,
    tags: new Set<string>(INLINE_EDITABLE_TAGS),
    voidTags: new Set<string>(["br"]),
    attributes: {
      global: new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"]),
      byTag: new Map<string, Set<string>>([
        ["a", new Set(["aria-label", "class", "dir", "href", "id", "lang", "rel", "style", "target", "title"])],
        ["abbr", new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"])],
        ["time", new Set(["aria-label", "class", "datetime", "dir", "id", "lang", "style", "title"])],
      ]),
    },
    styleProperties: new Set<string>(INLINE_STYLE_PROPERTIES),
  },
  "safe-block": {
    id: "safe-block" as const,
    tags: new Set<string>(SAFE_BLOCK_TAGS),
    voidTags: new Set<string>(["br", "hr"]),
    attributes: {
      global: new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"]),
      byTag: new Map<string, Set<string>>([
        ["a", new Set(["aria-label", "class", "dir", "href", "id", "lang", "rel", "style", "target", "title"])],
        ["details", new Set(["aria-label", "class", "dir", "id", "lang", "open", "style", "title"])],
        ["td", new Set(["aria-label", "class", "colspan", "dir", "id", "lang", "rowspan", "style", "title"])],
        ["th", new Set(["aria-label", "class", "colspan", "dir", "id", "lang", "rowspan", "style", "title"])],
        ["time", new Set(["aria-label", "class", "datetime", "dir", "id", "lang", "style", "title"])],
        ...SAFE_BLOCK_ALIGN_TAGS.map((tagName) => [
          tagName,
          new Set([
            "align",
            ...(tagName === "td" || tagName === "th" ? ["colspan", "rowspan"] : []),
          ]),
        ] as const),
      ]),
    },
    styleProperties: new Set<string>(BLOCK_STYLE_PROPERTIES),
  },
  "safe-media": {
    id: "safe-media" as const,
    tags: new Set<string>(SAFE_MEDIA_TAGS),
    voidTags: new Set<string>(["img", "source"]),
    attributes: {
      global: new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"]),
      byTag: new Map<string, Set<string>>([
        ["img", new Set(["alt", "aria-label", "class", "height", "id", "loading", "src", "srcset", "style", "title", "width"])],
        ["source", new Set(["src", "type"])],
        ["video", new Set([
          "aria-label",
          "class",
          "controls",
          "height",
          "id",
          "loop",
          "muted",
          "playsinline",
          "poster",
          "preload",
          "src",
          "style",
          "title",
          "width",
        ])],
      ]),
    },
    styleProperties: new Set<string>(INLINE_STYLE_PROPERTIES),
  },
  blocked: new Set<string>(BLOCKED_EXECUTABLE_TAGS),
} as const;

export function getInlineEditableProfile() {
  return MARKDOWN_HTML_PROFILES["inline-editable"];
}

export function getSafeBlockProfile() {
  return MARKDOWN_HTML_PROFILES["safe-block"];
}

export function getSafeMediaProfile() {
  return MARKDOWN_HTML_PROFILES["safe-media"];
}

export function isBlockedExecutableTag(tagName: string): boolean {
  return MARKDOWN_HTML_PROFILES.blocked.has(tagName);
}

export function normalizeMarkdownHtmlAlignment(value: string | null): "left" | "center" | "right" | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "left" || normalized === "center" || normalized === "right"
    ? normalized
    : null;
}

export function getProfileForSanitizerMode(mode: "inline" | "block") {
  return mode === "block" ? getSafeBlockProfile() : getInlineEditableProfile();
}

export type MarkdownHtmlSanitizerCapabilities = {
  /**
   * The caller has already resolved media sources through AssetBroker and may
   * explicitly compose the safe-media profile with its base profile.
   */
  brokeredMedia?: boolean;
  /**
   * Media source strings may be retained only in inert data attributes while
   * AssetBroker resolves each element independently. No network-capable sink
   * receives the Markdown-authored value.
   */
  deferredMedia?: boolean;
};

function getProfileForSanitizerElement(
  mode: "inline" | "block",
  tagName: string,
  capabilities: MarkdownHtmlSanitizerCapabilities,
) {
  const baseProfile = getProfileForSanitizerMode(mode);
  if (baseProfile.tags.has(tagName)) return baseProfile;
  if ((capabilities.brokeredMedia || capabilities.deferredMedia) && getSafeMediaProfile().tags.has(tagName)) {
    return getSafeMediaProfile();
  }
  return null;
}

export function isTagAllowedInProfile(
  tagName: string,
  mode: "inline" | "block",
  capabilities: MarkdownHtmlSanitizerCapabilities = {},
): boolean {
  if (isBlockedExecutableTag(tagName)) return false;
  return getProfileForSanitizerElement(mode, tagName, capabilities)?.tags.has(tagName) === true;
}

export function isAttributeAllowedInProfile(
  tagName: string,
  attributeName: string,
  mode: "inline" | "block",
  capabilities: MarkdownHtmlSanitizerCapabilities = {},
): boolean {
  const profile = getProfileForSanitizerElement(mode, tagName, capabilities);
  if (!profile) return false;
  return (
    profile.attributes.global.has(attributeName) ||
    profile.attributes.byTag.get(tagName)?.has(attributeName) === true
  );
}

export function isStylePropertyAllowedInProfile(
  property: string,
  mode: "inline" | "block",
  tagName?: string,
  capabilities: MarkdownHtmlSanitizerCapabilities = {},
): boolean {
  const profile = tagName
    ? getProfileForSanitizerElement(mode, tagName, capabilities)
    : getProfileForSanitizerMode(mode);
  return profile?.styleProperties.has(property) === true;
}
