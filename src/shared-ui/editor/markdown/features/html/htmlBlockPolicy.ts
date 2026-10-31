import type {
  MarkdownHtmlBlockRenderProfile,
  MarkdownHtmlBlockStatus,
} from "../../core/features/markdownFeatureData";
import type { MarkdownDiagnostic } from "../../core/plans/markdownPlanTypes";
import {
  isAttributeAllowedInProfile,
  isBlockedExecutableTag,
  isStylePropertyAllowedInProfile,
  isTagAllowedInProfile,
  MARKDOWN_HTML_PROFILE_VERSION,
  normalizeMarkdownHtmlAlignment,
} from "../../platform/policy/markdownHtmlProfiles";
import { isSafeStyleValue } from "../../platform/policy/markdownHtmlSanitizerPolicy";
import {
  decodeHtmlHrefEntities,
  getSafeMarkdownHref,
} from "../../platform/policy/markdownUrlPolicy";
import { scanMarkdownHtmlTagTokens, type MarkdownHtmlTagToken } from "./htmlTagTokenizer";

export type MarkdownHtmlBlockPolicyResult =
  | Readonly<{
      supported: true;
      profile: MarkdownHtmlBlockRenderProfile;
      profileVersion: typeof MARKDOWN_HTML_PROFILE_VERSION;
      requiresAssetBroker: boolean;
      externalHref: string | null;
      diagnostics: readonly MarkdownDiagnostic[];
    }>
  | Readonly<{
      supported: false;
      diagnostic: MarkdownDiagnostic;
    }>;

export function compileMarkdownHtmlBlockPolicy(input: {
  source: string;
  status: MarkdownHtmlBlockStatus;
  diagnostic: string | null;
  assetBrokerAvailable: boolean;
}): MarkdownHtmlBlockPolicyResult {
  if (input.status !== "complete") {
    return unsupported(
      `htmlBlock.${input.status}`,
      input.diagnostic ?? `HTML block is ${input.status}`,
    );
  }

  const tokens = scanMarkdownHtmlTagTokens(input.source);
  const external = compileExternalWebEmbedIntent(input.source, tokens);
  if (external) {
    return {
      supported: true,
      profile: "external-web-embed",
      profileVersion: MARKDOWN_HTML_PROFILE_VERSION,
      requiresAssetBroker: false,
      externalHref: external,
      diagnostics: [],
    };
  }

  const diagnostics: MarkdownDiagnostic[] = [];
  let hasMedia = false;
  let requiresAssetBroker = false;

  for (const token of tokens) {
    if (token.closing) continue;
    if (isBlockedExecutableTag(token.tagName)) {
      return unsupported(
        "htmlBlock.blocked-tag",
        `<${token.tagName}> is not supported in ordinary Markdown`,
      );
    }

    const safeBlock = isTagAllowedInProfile(token.tagName, "block");
    const safeMedia = isTagAllowedInProfile(token.tagName, "block", { deferredMedia: true });
    if (!safeBlock && !safeMedia) {
      return unsupported(
        "htmlBlock.unsupported-tag",
        `<${token.tagName}> is not in the versioned safe HTML profile`,
      );
    }
    hasMedia ||= !safeBlock && safeMedia;

    for (const attribute of token.attributes) {
      if (attribute.name.startsWith("on")) {
        diagnostics.push({
          code: "htmlBlock.attribute-reduced",
          message: `event handler "${attribute.name}" was omitted`,
        });
        continue;
      }

      const capabilities = safeBlock ? {} : { deferredMedia: true };
      if (!isAttributeAllowedInProfile(token.tagName, attribute.name, "block", capabilities)) {
        diagnostics.push({
          code: "htmlBlock.attribute-reduced",
          message: `attribute "${attribute.name}" on <${token.tagName}> was omitted`,
        });
        continue;
      }

      if (token.tagName === "a" && attribute.name === "href") {
        const href = attribute.value && getSafeMarkdownHref(attribute.value);
        if (!href) {
          return unsupported("htmlBlock.unsafe-href", "unsafe link URL is not supported");
        }
      }

      if (attribute.name === "align" && !normalizeMarkdownHtmlAlignment(attribute.value)) {
        diagnostics.push({
          code: "htmlBlock.attribute-reduced",
          message: `align value on <${token.tagName}> was omitted`,
        });
        continue;
      }

      if (isMediaResourceAttribute(token.tagName, attribute.name)) {
        if (!attribute.value?.trim()) {
          return unsupported(
            "htmlBlock.invalid-media-source",
            `${attribute.name} on <${token.tagName}> requires a source value`,
          );
        }
        requiresAssetBroker = true;
      }

      if (attribute.name === "style" && attribute.value) {
        diagnostics.push(...compileBlockStyleDiagnostics(token.tagName, attribute.value, capabilities));
      }
    }
  }

  if (requiresAssetBroker && !input.assetBrokerAvailable) {
    return unsupported(
      "htmlBlock.asset-broker-unavailable",
      "HTML media requires an AssetBroker-backed resolver on this surface",
    );
  }

  return {
    supported: true,
    profile: hasMedia ? "safe-block-with-media" : "safe-block",
    profileVersion: MARKDOWN_HTML_PROFILE_VERSION,
    requiresAssetBroker,
    externalHref: null,
    diagnostics,
  };
}

function compileExternalWebEmbedIntent(
  source: string,
  tokens: readonly MarkdownHtmlTagToken[],
): string | null {
  const opening = tokens[0] ?? null;
  if (!opening || opening.closing || opening.tagName !== "iframe") return null;
  const closing = tokens[1] ?? null;
  const completeEnvelope = opening.selfClosing
    ? tokens.length === 1
    : Boolean(
        tokens.length === 2
        && closing?.closing
        && closing.tagName === "iframe"
        && source.slice(opening.to, closing.from).trim() === "",
      );
  if (!completeEnvelope) return null;
  if (source.slice(0, opening.from).trim() !== "") return null;
  const envelopeTo = opening.selfClosing ? opening.to : closing!.to;
  if (source.slice(envelopeTo).trim() !== "") return null;
  if (opening.attributes.length !== 1 || opening.attributes[0]?.name !== "src") return null;
  const rawHref = opening.attributes[0].value;
  if (!rawHref) return null;
  const href = getSafeMarkdownHref(decodeHtmlHrefEntities(rawHref));
  return href?.startsWith("https://") ? href : null;
}

function compileBlockStyleDiagnostics(
  tagName: string,
  source: string,
  capabilities: { deferredMedia?: boolean },
): MarkdownDiagnostic[] {
  const diagnostics: MarkdownDiagnostic[] = [];
  for (const rawDeclaration of source.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(":");
    if (separator <= 0) {
      diagnostics.push({ code: "htmlBlock.style-reduced", message: `style "${declaration}" was omitted` });
      continue;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = decodeHtmlHrefEntities(declaration.slice(separator + 1).trim());
    if (
      !isStylePropertyAllowedInProfile(property, "block", tagName, capabilities)
      || !isSafeStyleValue(property, value)
    ) {
      diagnostics.push({
        code: "htmlBlock.style-reduced",
        message: `style "${property}" was omitted`,
      });
    }
  }
  return diagnostics;
}

function isMediaResourceAttribute(tagName: string, attributeName: string): boolean {
  return (
    (tagName === "img" && (attributeName === "src" || attributeName === "srcset"))
    || ((tagName === "video" || tagName === "source") && attributeName === "src")
    || (tagName === "video" && attributeName === "poster")
  );
}

function unsupported(code: string, message: string): MarkdownHtmlBlockPolicyResult {
  return { supported: false, diagnostic: { code, message } };
}
