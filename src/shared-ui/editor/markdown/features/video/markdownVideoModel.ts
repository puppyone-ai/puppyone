import { isEscapedInlineToken } from "../../shared/inlineTokenScan";
import type {
  MarkdownVideoModel,
  MarkdownVideoSource,
} from "../../core/features/markdownFeatureData";
export type {
  MarkdownVideoModel,
  MarkdownVideoSource,
} from "../../core/features/markdownFeatureData";
import { scanObsidianMediaEmbedAt } from "../media/obsidianMediaEmbed";
import type { MarkdownObsidianMediaEmbedToken } from "../media/obsidianMediaEmbed";

export type MarkdownVideoToken = {
  from: number;
  to: number;
  href: string;
  title: string | null;
  width: number | null;
  height: number | null;
  referenceKind: "wiki-target";
};

export function findMarkdownVideoTokens(source: string): MarkdownVideoToken[] {
  const tokens: MarkdownVideoToken[] = [];
  for (let index = 0; index < source.length;) {
    if (!source.startsWith("![[", index) || isEscapedInlineToken(source, index)) {
      index += 1;
      continue;
    }
    const scan = scanObsidianMediaEmbedAt(source, index);
    if (scan.token?.kind === "video") tokens.push(toVideoToken(scan.token));
    index = Math.max(index + 1, scan.nextIndex);
  }
  return tokens;
}

export function parseMarkdownVideoTokenAt(source: string, from: number): MarkdownVideoToken | null {
  const scan = scanObsidianMediaEmbedAt(source, from);
  return scan.token?.kind === "video" ? toVideoToken(scan.token) : null;
}

/** Video embeds are block atoms only when they own the complete physical line. */
export function getMarkdownVideoLine(source: string): MarkdownVideoToken | null {
  const token = findMarkdownVideoTokens(source)[0] ?? null;
  if (!token) return null;
  if (source.slice(0, token.from).trim() || source.slice(token.to).trim()) return null;
  return token;
}

export function createMarkdownVideoModel(token: MarkdownVideoToken): MarkdownVideoModel {
  return {
    sources: [{
      href: token.href,
      type: null,
      referenceKind: token.referenceKind,
    }],
    title: token.title,
    poster: null,
    width: token.width,
    height: token.height,
    loop: false,
    muted: false,
    playsInline: true,
    preload: "metadata",
  };
}

function toVideoToken(
  token: NonNullable<ReturnType<typeof scanObsidianMediaEmbedAt>["token"]>,
): MarkdownVideoToken {
  const size = parseVideoSize(token.alias);
  return {
    from: token.from,
    to: token.to,
    href: token.target,
    title: token.alias && !size ? token.alias : null,
    width: size?.width ?? null,
    height: size?.height ?? null,
    referenceKind: "wiki-target",
  };
}

export function createMarkdownVideoTokenFromObsidianEmbed(
  token: MarkdownObsidianMediaEmbedToken,
): MarkdownVideoToken {
  return toVideoToken(token);
}

function parseVideoSize(value: string | null): { width: number; height: number | null } | null {
  if (!value) return null;
  const match = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = match[2] ? Number(match[2]) : null;
  if (width <= 0 || width > 4096 || (height !== null && (height <= 0 || height > 4096))) return null;
  return { width, height };
}
