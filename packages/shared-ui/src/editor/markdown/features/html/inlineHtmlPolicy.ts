import type { MarkdownInlineHtml } from "./inlineHtmlModel";
import type { MarkdownDiagnostic } from "../../core/plans/markdownPlanTypes";
import {
  getInlineEditableProfile,
  isBlockedExecutableTag,
  MARKDOWN_HTML_PROFILE_VERSION,
} from "../../platform/policy/markdownHtmlProfiles";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";
import { isSafeStyleValue } from "../../platform/policy/markdownHtmlSanitizerPolicy";

export type SafeInlineHtmlMark = {
  kind: "mark";
  profile: "inline-editable";
  profileVersion: typeof MARKDOWN_HTML_PROFILE_VERSION;
  tagName: string;
  attributes: Readonly<Record<string, string>>;
  diagnostics: readonly MarkdownDiagnostic[];
};

export type SafeInlineHtmlLineBreak = {
  kind: "lineBreak";
  profile: "inline-editable";
  profileVersion: typeof MARKDOWN_HTML_PROFILE_VERSION;
  diagnostics: readonly MarkdownDiagnostic[];
};

export type SafeInlineHtmlRenderPlan = SafeInlineHtmlMark | SafeInlineHtmlLineBreak;

export type InlineHtmlPolicyResult =
  | { supported: true; value: SafeInlineHtmlRenderPlan }
  | { supported: false; reasons: readonly string[]; diagnostics: readonly MarkdownDiagnostic[] };

/**
 * Compiles inline HTML through the versioned inline-editable profile.
 * Capability reduction keeps honest structure when unsafe attributes are dropped.
 */
export function compileInlineHtmlRenderPlan(element: MarkdownInlineHtml): InlineHtmlPolicyResult {
  const diagnostics: MarkdownDiagnostic[] = [];
  const reasons: string[] = [];
  const profile = getInlineEditableProfile();

  if (element.status !== "complete") {
    const message = `inline <${element.tagName}> is ${element.status}`;
    reasons.push(message);
    diagnostics.push({ code: `inline-html.${element.status}`, message });
    return { supported: false, reasons, diagnostics };
  }

  if (isBlockedExecutableTag(element.tagName)) {
    const message = `inline <${element.tagName}> is not supported`;
    return {
      supported: false,
      reasons: [message],
      diagnostics: [{ code: "inline-html.blocked-tag", message }],
    };
  }

  const isStandalone = !element.contentRange && !element.closingMarker;
  if (isStandalone) {
    if (element.tagName !== "br" || !profile.voidTags.has("br")) {
      const message = `standalone inline <${element.tagName}> is not supported`;
      return {
        supported: false,
        reasons: [message],
        diagnostics: [{ code: "inline-html.unsupported-void", message }],
      };
    }

    for (const attribute of element.attributes) {
      diagnostics.push({
        code: "inline-html.attribute-reduced",
        message: `attribute "${attribute.name}" on <br> was omitted`,
      });
    }

    return {
      supported: true,
      value: {
        kind: "lineBreak",
        profile: "inline-editable",
        profileVersion: MARKDOWN_HTML_PROFILE_VERSION,
        diagnostics,
      },
    };
  }

  if (!element.contentRange || !element.closingMarker) {
    const message = `inline <${element.tagName}> is not complete`;
    return {
      supported: false,
      reasons: [message],
      diagnostics: [{ code: "inline-html.incomplete", message }],
    };
  }

  if (!profile.tags.has(element.tagName)) {
    const message = `inline <${element.tagName}> is not supported`;
    return {
      supported: false,
      reasons: [message],
      diagnostics: [{ code: "inline-html.unsupported-tag", message }],
    };
  }

  const attributes: Record<string, string> = {};
  const seenAttributes = new Set<string>();
  let structuralFailure = false;

  for (const attribute of element.attributes) {
    if (seenAttributes.has(attribute.name)) {
      diagnostics.push({
        code: "inline-html.duplicate-attribute",
        message: `duplicate attribute "${attribute.name}" was omitted`,
      });
      continue;
    }
    seenAttributes.add(attribute.name);

    if (attribute.name.startsWith("on")) {
      diagnostics.push({
        code: "inline-html.event-handler",
        message: `event handler "${attribute.name}" was omitted`,
      });
      continue;
    }

    const allowed =
      profile.attributes.global.has(attribute.name) ||
      profile.attributes.byTag.get(element.tagName)?.has(attribute.name) === true;
    if (!allowed) {
      diagnostics.push({
        code: "inline-html.attribute-reduced",
        message: `attribute "${attribute.name}" was omitted`,
      });
      continue;
    }

    if (attribute.value === null) {
      diagnostics.push({
        code: "inline-html.attribute-reduced",
        message: `attribute "${attribute.name}" requires a value and was omitted`,
      });
      continue;
    }

    if (attribute.name === "style") {
      const styleResult = compileInlineStyle(attribute.value, profile.styleProperties);
      diagnostics.push(...styleResult.diagnostics);
      if (styleResult.value) attributes.style = styleResult.value;
      continue;
    }

    if (attribute.name === "href") {
      const rawHref = decodeHtmlAttributeValue(attribute.value);
      const href = getSafeMarkdownHref(rawHref);
      if (!href) {
        // Anchors whose meaning depends on an unsafe href fall back to source.
        structuralFailure = true;
        reasons.push(`href "${rawHref}" is not supported`);
        diagnostics.push({
          code: "inline-html.unsafe-href",
          message: `href "${rawHref}" is not supported`,
        });
        continue;
      }
      // Never put a live href on editor DOM. Activation goes through LinkBroker
      // via data-md-href + the live-preview open handler.
      attributes["data-md-href"] = href;
      attributes.role = "link";
      attributes.tabindex = "0";
      continue;
    }

    if (attribute.name === "target") {
      const target = decodeHtmlAttributeValue(attribute.value).trim();
      if (target !== "_blank") {
        diagnostics.push({
          code: "inline-html.attribute-reduced",
          message: `target "${target}" was omitted`,
        });
        continue;
      }
      attributes.target = "_blank";
      continue;
    }

    if (attribute.name === "class" || attribute.name === "id") {
      const scoped = scopeDocumentToken(decodeHtmlAttributeValue(attribute.value), attribute.name);
      if (!scoped) {
        diagnostics.push({
          code: "inline-html.attribute-reduced",
          message: `attribute "${attribute.name}" was omitted`,
        });
        continue;
      }
      attributes[attribute.name] = scoped;
      continue;
    }

    attributes[attribute.name] = decodeHtmlAttributeValue(attribute.value);
  }

  if (structuralFailure) {
    return { supported: false, reasons: Array.from(new Set(reasons)), diagnostics };
  }

  return {
    supported: true,
    value: {
      kind: "mark",
      profile: "inline-editable",
      profileVersion: MARKDOWN_HTML_PROFILE_VERSION,
      tagName: element.tagName,
      attributes,
      diagnostics,
    },
  };
}

type InlineStyleResult = {
  value: string;
  diagnostics: MarkdownDiagnostic[];
};

function compileInlineStyle(source: string, allowedProperties: ReadonlySet<string>): InlineStyleResult {
  const declarations: string[] = [];
  const diagnostics: MarkdownDiagnostic[] = [];
  const seenProperties = new Set<string>();

  for (const rawDeclaration of source.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;

    const separator = declaration.indexOf(":");
    if (separator <= 0) {
      diagnostics.push({
        code: "inline-html.style-malformed",
        message: `style declaration "${declaration}" was omitted`,
      });
      continue;
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = decodeHtmlAttributeValue(declaration.slice(separator + 1).trim());
    if (!/^[a-z-]+$/.test(property)) {
      diagnostics.push({
        code: "inline-html.style-malformed",
        message: `style property "${property}" was omitted`,
      });
      continue;
    }
    if (seenProperties.has(property)) {
      diagnostics.push({
        code: "inline-html.style-duplicate",
        message: `duplicate style "${property}" was omitted`,
      });
      continue;
    }
    seenProperties.add(property);

    if (!allowedProperties.has(property)) {
      diagnostics.push({
        code: "inline-html.style-reduced",
        message: `style "${property}" was omitted`,
      });
      continue;
    }
    if (!isSafeStyleValue(property, value)) {
      diagnostics.push({
        code: "inline-html.style-reduced",
        message: `style value for "${property}" was omitted`,
      });
      continue;
    }
    declarations.push(`${property}: ${value}`);
  }

  return { value: declarations.join("; "), diagnostics };
}

function scopeDocumentToken(value: string, kind: "class" | "id"): string | null {
  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (kind === "id" && tokens.length !== 1) return null;

  const scoped = tokens
    .map((token) => {
      if (!/^[A-Za-z_][\w-]*$/.test(token)) return null;
      if (token.startsWith("cm-") || token.startsWith("po-") || token.startsWith("md-doc-")) return null;
      return kind === "id" ? `md-doc-${token}` : `md-doc-${token}`;
    })
    .filter((token): token is string => Boolean(token));

  return scoped.length > 0 ? scoped.join(" ") : null;
}

function decodeHtmlAttributeValue(value: string): string {
  const named = new Map<string, string>([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", "\u00a0"],
    ["quot", "\""],
  ]);

  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi, (match, decimal, hex, name) => {
    if (name) return named.get(String(name).toLowerCase()) ?? match;
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "\ufffd";
    }
    return String.fromCodePoint(codePoint);
  });
}
