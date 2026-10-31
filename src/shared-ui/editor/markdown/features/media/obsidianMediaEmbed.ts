import {
  isEscapedInlineToken,
  scanUnescapedDelimiterOnLine,
} from "../../shared/inlineTokenScan";

export type MarkdownMediaKind = "image" | "video";

export type MarkdownObsidianMediaEmbedToken = {
  from: number;
  to: number;
  target: string;
  alias: string | null;
  kind: MarkdownMediaKind;
};

export type MarkdownObsidianMediaEmbedScan = {
  token: MarkdownObsidianMediaEmbedToken | null;
  nextIndex: number;
};

const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

// Keep this list aligned with formats that the native video viewer can hand
// to Chromium. A binary video format without a shipped browser adapter stays
// visible as source instead of silently acquiring media-loading authority.
const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "3gpp",
  "m4v",
  "mov",
  "mp4",
  "ogv",
  "qt",
  "webm",
]);

/** Parse the common Obsidian media envelope once, then classify its target. */
export function scanObsidianMediaEmbedAt(
  source: string,
  from: number,
): MarkdownObsidianMediaEmbedScan {
  if (!source.startsWith("![[", from) || isEscapedInlineToken(source, from)) {
    return { token: null, nextIndex: from + 1 };
  }

  const contentFrom = from + 3;
  const closingScan = scanUnescapedDelimiterOnLine(source, contentFrom, "]]");
  const closingFrom = closingScan.closingIndex;
  if (closingFrom === -1) return { token: null, nextIndex: closingScan.nextIndex };

  const content = source.slice(contentFrom, closingFrom);
  const pipeOffset = findUnescapedPipe(content);
  const rawTarget = pipeOffset === -1 ? content : content.slice(0, pipeOffset);
  const target = rawTarget.trim();
  const kind = classifyMarkdownMediaTarget(target);
  if (!target || !kind) return { token: null, nextIndex: closingScan.nextIndex };

  const rawAlias = pipeOffset === -1 ? "" : content.slice(pipeOffset + 1).trim();
  return {
    token: {
      from,
      to: closingFrom + 2,
      target,
      alias: rawAlias || null,
      kind,
    },
    nextIndex: closingScan.nextIndex,
  };
}

export function classifyMarkdownMediaTarget(value: string): MarkdownMediaKind | null {
  const normalized = value.split(/[?#]/, 1)[0]?.trim().toLowerCase() ?? "";
  const extension = /\.([a-z0-9]+)$/.exec(normalized)?.[1] ?? "";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function isObsidianImageEmbedSize(value: string | null): boolean {
  return Boolean(value && /^\d+(?:x\d+)?$/i.test(value.trim()));
}

function findUnescapedPipe(content: string): number {
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "|" && !isEscapedInlineToken(content, index)) return index;
  }
  return -1;
}
