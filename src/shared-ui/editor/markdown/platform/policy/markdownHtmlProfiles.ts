/**
 * Versioned broad-safe HTML profiles (architecture §6.4).
 * Profiles are non-escalating: a surface receives only its selected profile.
 */
export const MARKDOWN_HTML_PROFILE_VERSION = "2026-11-02.1" as const;

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
  "ins",
  "kbd",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
] as const;

/** Inline in layout but rendered as a run: none of them styles plain text alone. */
const INLINE_RUN_TAGS = [
  "bdi",
  "bdo",
  "big",
  "data",
  "dfn",
  "font",
  "label",
  "meter",
  "nobr",
  "output",
  "progress",
  "wbr",
] as const;

const SAFE_BLOCK_TAGS = [
  ...INLINE_EDITABLE_TAGS,
  ...INLINE_RUN_TAGS,
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "center",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "fieldset",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "menu",
  "nav",
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
const SAFE_MEDIA_TAGS = ["audio", "img", "picture", "source", "video"] as const;

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

const INLINE_RUN_TAG_SET = new Set<string>(INLINE_RUN_TAGS);

const SVG_TAGS = [
  "circle", "clippath", "defs", "desc", "ellipse", "g", "line", "lineargradient",
  "marker", "mask", "path", "pattern", "polygon", "polyline", "radialgradient",
  "rect", "stop", "svg", "symbol", "text", "title", "tspan",
] as const;

const SVG_ATTRIBUTES = [
  "aria-hidden", "aria-label", "clip-path", "clip-rule", "class", "cx", "cy", "d", "dx", "dy",
  "fill", "fill-opacity", "fill-rule", "font-family", "font-size", "font-style", "font-weight",
  "fx", "fy", "gradienttransform", "gradientunits", "height", "id", "marker-end", "marker-mid",
  "marker-start", "markerheight", "markerunits", "markerwidth", "mask", "offset", "opacity",
  "orient", "patterncontentunits", "patterntransform", "patternunits", "points", "preserveaspectratio",
  "r", "refx", "refy", "role", "rotate", "rx", "ry", "spreadmethod", "stop-color", "stop-opacity",
  "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor", "textlength", "transform",
  "viewbox", "width", "x", "x1", "x2", "xmlns", "y", "y1", "y2",
] as const;

const SVG_TAG_SET = new Set<string>(SVG_TAGS);
const SVG_ATTRIBUTE_SET = new Set<string>(SVG_ATTRIBUTES);

/** Passive vector drawing only: no script, reference, animation, or foreign content. */
export function isSafeSvgTag(tagName: string): boolean {
  return SVG_TAG_SET.has(tagName.toLowerCase());
}

export function isSafeSvgAttribute(attributeName: string): boolean {
  return SVG_ATTRIBUTE_SET.has(attributeName.toLowerCase());
}

export const MARKDOWN_HTML_PROFILES = {
  version: MARKDOWN_HTML_PROFILE_VERSION,
  "inline-editable": {
    id: "inline-editable" as const,
    tags: new Set<string>(INLINE_EDITABLE_TAGS),
    voidTags: new Set<string>(["br"]),
    attributes: {
      global: new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"]),
      byTag: new Map<string, Set<string>>([
        ["a", new Set(["aria-label", "class", "dir", "href", "id", "lang", "name", "rel", "style", "target", "title"])],
        ["abbr", new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"])],
        ["time", new Set(["aria-label", "class", "datetime", "dir", "id", "lang", "style", "title"])],
      ]),
    },
    styleProperties: new Set<string>(INLINE_STYLE_PROPERTIES),
  },
  "safe-block": {
    id: "safe-block" as const,
    tags: new Set<string>(SAFE_BLOCK_TAGS),
    voidTags: new Set<string>(["br", "hr", "wbr"]),
    attributes: {
      global: new Set(["aria-label", "class", "dir", "id", "lang", "style", "title"]),
      byTag: new Map<string, Set<string>>([
        ["a", new Set(["aria-label", "class", "dir", "href", "id", "lang", "name", "rel", "style", "target", "title"])],
        ["data", new Set(["value"])],
        ["details", new Set(["aria-label", "class", "dir", "id", "lang", "open", "style", "title"])],
        ["font", new Set(["color", "face", "size"])],
        ["meter", new Set(["high", "low", "max", "min", "optimum", "value"])],
        ["ol", new Set(["start", "type"])],
        ["progress", new Set(["max", "value"])],
        ["table", new Set(["align", "width"])],
        ["time", new Set(["aria-label", "class", "datetime", "dir", "id", "lang", "style", "title"])],
        ...SAFE_BLOCK_ALIGN_TAGS.map((tagName) => [
          tagName,
          new Set([
            "align",
            ...(tagName === "td" || tagName === "th"
              ? ["colspan", "height", "rowspan", "valign", "width"]
              : []),
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
        ["img", new Set(["align", "alt", "aria-label", "class", "height", "id", "loading", "src", "srcset", "style", "title", "width"])],
        ["audio", new Set(["aria-label", "class", "controls", "id", "loop", "muted", "preload", "src", "style", "title"])],
        ["source", new Set(["media", "sizes", "src", "srcset", "type"])],
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

/** A block-level root keeps block layout even when it shares a line with Markdown. */
export function isBlockLevelHtmlTag(tagName: string): boolean {
  return (
    getSafeBlockProfile().tags.has(tagName)
    && !getInlineEditableProfile().tags.has(tagName)
    && !INLINE_RUN_TAG_SET.has(tagName)
  );
}

export function isPassiveMediaHtmlTag(tagName: string): boolean {
  return getSafeMediaProfile().tags.has(tagName);
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
