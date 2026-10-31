import {
  isBrokerSafeResolvedAssetUrl,
} from "../../platform/policy/markdownAssetPolicy";
import {
  isEscapedInlineToken,
  scanUnescapedDelimiterOnLine,
  type InlineTokenClosingScan,
} from "../../shared/inlineTokenScan";
import {
  isObsidianImageEmbedSize,
  scanObsidianMediaEmbedAt,
} from "../media/obsidianMediaEmbed";

export type MarkdownImageToken = {
  from: number;
  to: number;
  alt: string;
  href: string;
  title: string | null;
  referenceKind: "markdown-path" | "wiki-target";
};

type BrokeredMarkdownImageUrlResolver = (
  documentPath: string,
  href: string,
  signal?: AbortSignal,
) => string | null | Promise<string | null>;

export const MARKDOWN_IMAGE_SRCSET_MAX_CANDIDATES = 16;
export const MARKDOWN_IMAGE_SRCSET_MAX_SOURCE_UNITS = 8_192;

export function findMarkdownImageTokens(source: string): MarkdownImageToken[] {
  return findImageTokens(source, true);
}

/** Standard `![alt](href)` only; Obsidian embeds come from parser nodes. */
export function findStandardMarkdownImageTokens(source: string): MarkdownImageToken[] {
  return findImageTokens(source, false);
}

function findImageTokens(source: string, includeObsidian: boolean): MarkdownImageToken[] {
  const tokens: MarkdownImageToken[] = [];

  for (let index = 0; index < source.length;) {
    if (!source.startsWith("![", index) || isEscapedInlineToken(source, index)) {
      index += 1;
      continue;
    }

    if (!includeObsidian && source.startsWith("![[", index)) {
      index += 3;
      continue;
    }

    const scan = scanMarkdownImageTokenAt(source, index);
    if (scan.token) tokens.push(scan.token);
    index = Math.max(index + 1, scan.nextIndex);
  }

  return tokens;
}

export function parseMarkdownImageTokenAt(source: string, from: number): MarkdownImageToken | null {
  if (!source.startsWith("![", from) || isEscapedInlineToken(source, from)) return null;
  return scanMarkdownImageTokenAt(source, from).token;
}

type MarkdownImageTokenScan = {
  token: MarkdownImageToken | null;
  nextIndex: number;
};

function scanMarkdownImageTokenAt(source: string, from: number): MarkdownImageTokenScan {
  if (source.startsWith("![[", from)) {
    const scan = scanObsidianMediaEmbedAt(source, from);
    if (!scan.token || scan.token.kind !== "image") {
      return { token: null, nextIndex: scan.nextIndex };
    }
    return {
      token: {
        from: scan.token.from,
        to: scan.token.to,
        alt: scan.token.alias && !isObsidianImageEmbedSize(scan.token.alias)
          ? scan.token.alias
          : scan.token.target,
        href: scan.token.target,
        title: null,
        referenceKind: "wiki-target",
      },
      nextIndex: scan.nextIndex,
    };
  }
  return scanStandardMarkdownImage(source, from);
}

function scanStandardMarkdownImage(source: string, from: number): MarkdownImageTokenScan {
  const labelFrom = from + 2;
  const labelScan = scanUnescapedDelimiterOnLine(source, labelFrom, "]");
  const labelTo = labelScan.closingIndex;
  if (labelTo < 0 || source[labelTo + 1] !== "(") {
    return { token: null, nextIndex: labelScan.nextIndex };
  }

  const destinationFrom = labelTo + 2;
  const destinationScan = findClosingParen(source, destinationFrom);
  const destinationTo = destinationScan.closingIndex;
  if (destinationTo <= destinationFrom) {
    return { token: null, nextIndex: destinationScan.nextIndex };
  }

  const parsed = parseMarkdownImageDestination(source.slice(destinationFrom, destinationTo));
  if (!parsed) return { token: null, nextIndex: destinationTo + 1 };

  return {
    token: {
      from,
      to: destinationTo + 1,
      alt: source.slice(labelFrom, labelTo),
      href: parsed.href,
      title: parsed.title,
      referenceKind: "markdown-path",
    },
    nextIndex: destinationTo + 1,
  };
}

function parseMarkdownImageDestination(value: string): { href: string; title: string | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angleDestination = /^<([^>\n]+)>(?:\s+["']([^"']*)["'])?$/.exec(trimmed);
  if (angleDestination) {
    return {
      href: angleDestination[1],
      title: angleDestination[2] ?? null,
    };
  }

  const quotedTitle = findTrailingQuotedTitle(trimmed);
  if (quotedTitle) {
    return {
      href: quotedTitle.href,
      title: quotedTitle.title,
    };
  }

  return {
    href: trimmed,
    title: null,
  };
}

function findClosingParen(source: string, from: number): InlineTokenClosingScan {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") return { closingIndex: -1, nextIndex: index + 1 };
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      if (depth === 0) return { closingIndex: index, nextIndex: index + 1 };
      depth -= 1;
    }
  }

  return { closingIndex: -1, nextIndex: source.length };
}

function findTrailingQuotedTitle(value: string): { href: string; title: string } | null {
  const quote = value[value.length - 1];
  if (quote !== "\"" && quote !== "'") return null;

  for (let index = value.length - 2; index >= 0; index -= 1) {
    if (value[index] !== quote || isEscapedInlineToken(value, index)) continue;

    const href = value.slice(0, index).trim();
    const title = value.slice(index + 1, -1);
    if (!href) return null;
    return { href, title };
  }

  return null;
}

export function isSafeMarkdownImageUrl(value: string): boolean {
  // Compatibility helper for already-brokered sink URLs. It must not be used
  // to authorize a URL copied directly from Markdown source.
  return isBrokerSafeResolvedAssetUrl(value);
}

export function isSafeMarkdownImageSrcset(value: string): boolean {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .every((candidate) => {
      const [url] = candidate.split(/\s+/);
      return url ? isSafeMarkdownImageUrl(url) : false;
    });
}

export async function resolveMarkdownHtmlImageSources(
  source: string,
  documentPath: string,
  resolver: BrokeredMarkdownImageUrlResolver | null,
): Promise<string> {
  if (!resolver || !/<img\b/i.test(source)) return source;

  const template = document.createElement("template");
  template.innerHTML = source;
  const images = Array.from(template.content.querySelectorAll<HTMLImageElement>("img"));
  if (images.length === 0) return source;

  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute("src");
    if (src) {
      const resolvedUrl = await resolver(documentPath, src);
      if (resolvedUrl && isBrokerSafeResolvedAssetUrl(resolvedUrl)) image.setAttribute("src", resolvedUrl);
      else image.removeAttribute("src");
    }

    const srcset = image.getAttribute("srcset");
    if (srcset) {
      const resolvedSrcset = await resolveMarkdownImageSrcset(srcset, documentPath, resolver);
      if (resolvedSrcset) image.setAttribute("srcset", resolvedSrcset);
      else image.removeAttribute("srcset");
    }
  }));

  return template.innerHTML;
}

export async function resolveMarkdownImageSrcset(
  value: string,
  documentPath: string,
  resolver: BrokeredMarkdownImageUrlResolver,
  signal?: AbortSignal,
): Promise<string | null> {
  if (
    value.length > MARKDOWN_IMAGE_SRCSET_MAX_SOURCE_UNITS
    || countSrcsetCandidates(value) > MARKDOWN_IMAGE_SRCSET_MAX_CANDIDATES
  ) return null;
  const entries = await Promise.all(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(async (candidate) => {
        const parsed = /^(\S+)(.*)$/.exec(candidate);
        if (!parsed) return null;

        const resolvedUrl = await resolver(documentPath, parsed[1], signal);
        if (!resolvedUrl || !isBrokerSafeResolvedAssetUrl(resolvedUrl)) return null;
        return `${resolvedUrl}${parsed[2] ?? ""}`;
      }),
  );

  return entries.every(Boolean) ? entries.join(", ") : null;
}

function countSrcsetCandidates(value: string): number {
  let count = value.trim() ? 1 : 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 44) count += 1;
    if (count > MARKDOWN_IMAGE_SRCSET_MAX_CANDIDATES) return count;
  }
  return count;
}
