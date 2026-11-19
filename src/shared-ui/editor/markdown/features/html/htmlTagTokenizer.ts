import type { MarkdownHtmlAttribute } from "../../core/features/markdownFeatureData";

export type { MarkdownHtmlAttribute } from "../../core/features/markdownFeatureData";

export const MARKDOWN_HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

export type MarkdownHtmlTagToken = {
  from: number;
  to: number;
  tagName: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: readonly MarkdownHtmlAttribute[];
};

export function parseMarkdownHtmlTagToken(
  source: string,
  absoluteFrom = 0,
): MarkdownHtmlTagToken | null {
  if (source.length < 3 || source[0] !== "<") return null;

  const tagEnd = findMarkdownHtmlTagEnd(source, 0);
  if (tagEnd !== source.length - 1) return null;

  let cursor = 1;
  const closing = source[cursor] === "/";
  if (closing) cursor += 1;

  const nameFrom = cursor;
  if (!isAsciiLetter(source[cursor])) return null;
  cursor += 1;
  while (cursor < tagEnd && isTagNameCharacter(source[cursor])) cursor += 1;

  const tagName = source.slice(nameFrom, cursor).toLowerCase();
  if (cursor < tagEnd && !isHtmlWhitespace(source[cursor]) && source[cursor] !== "/") return null;

  const attributes: MarkdownHtmlAttribute[] = [];
  let explicitSelfClosing = false;

  while (cursor < tagEnd) {
    cursor = skipHtmlWhitespace(source, cursor, tagEnd);
    if (cursor >= tagEnd) break;

    if (source[cursor] === "/") {
      explicitSelfClosing = true;
      cursor += 1;
      cursor = skipHtmlWhitespace(source, cursor, tagEnd);
      if (cursor !== tagEnd) return null;
      break;
    }

    if (closing) return null;

    const attributeFrom = cursor;
    if (!isAttributeNameCharacter(source[cursor])) return null;
    cursor += 1;
    while (cursor < tagEnd && isAttributeNameCharacter(source[cursor])) cursor += 1;

    const name = source.slice(attributeFrom, cursor).toLowerCase();
    cursor = skipHtmlWhitespace(source, cursor, tagEnd);

    let value: string | null = null;
    if (source[cursor] === "=") {
      cursor += 1;
      cursor = skipHtmlWhitespace(source, cursor, tagEnd);
      if (cursor >= tagEnd) return null;

      const quote = source[cursor] === "\"" || source[cursor] === "'"
        ? source[cursor]
        : null;
      if (quote) {
        cursor += 1;
        const valueFrom = cursor;
        while (cursor < tagEnd && source[cursor] !== quote) cursor += 1;
        if (cursor >= tagEnd) return null;
        value = source.slice(valueFrom, cursor);
        cursor += 1;
      } else {
        const valueFrom = cursor;
        while (cursor < tagEnd && !isHtmlWhitespace(source[cursor])) {
          if (/['"<=`>]/.test(source[cursor])) return null;
          cursor += 1;
        }
        if (cursor === valueFrom) return null;
        value = source.slice(valueFrom, cursor);
      }
    }

    attributes.push({
      name,
      value,
      from: absoluteFrom + attributeFrom,
      to: absoluteFrom + cursor,
    });
  }

  if (closing && explicitSelfClosing) return null;

  return {
    from: absoluteFrom,
    to: absoluteFrom + source.length,
    tagName,
    closing,
    selfClosing: !closing && (explicitSelfClosing || MARKDOWN_HTML_VOID_TAGS.has(tagName)),
    attributes,
  };
}

export function scanMarkdownHtmlTagTokens(source: string, absoluteFrom = 0): MarkdownHtmlTagToken[] {
  const tokens: MarkdownHtmlTagToken[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) break;

    const specialEnd = findMarkdownHtmlSpecialConstructEnd(source, tagStart);
    if (specialEnd !== null) {
      if (specialEnd < 0) break;
      cursor = specialEnd;
      continue;
    }

    const tagEnd = findMarkdownHtmlTagEnd(source, tagStart);
    if (tagEnd === -1) break;

    const token = parseMarkdownHtmlTagToken(
      source.slice(tagStart, tagEnd + 1),
      absoluteFrom + tagStart,
    );
    if (token) {
      tokens.push(token);
      cursor = tagEnd + 1;
    } else {
      // The candidate may be plain text containing '<'. Advance only past
      // that character so a real tag later in the same slice is not skipped.
      cursor = tagStart + 1;
    }
  }

  return tokens;
}

/**
 * Returns the first offset after a complete non-element HTML construct, `-1`
 * when that construct is incomplete, and `null` when `start` begins a normal
 * element candidate. Tag-looking text inside comments/CDATA/PI/declarations
 * must never participate in authored element-stack validation.
 */
export function findMarkdownHtmlSpecialConstructEnd(
  source: string,
  start: number,
): number | null {
  if (source.startsWith("<!--", start)) {
    const end = source.indexOf("-->", start + 4);
    return end < 0 ? -1 : end + 3;
  }
  if (source.startsWith("<![CDATA[", start)) {
    const end = source.indexOf("]]>", start + 9);
    return end < 0 ? -1 : end + 3;
  }
  if (source.startsWith("<?", start)) {
    const end = source.indexOf("?>", start + 2);
    return end < 0 ? -1 : end + 2;
  }
  if (source.startsWith("<!", start)) {
    const end = findMarkdownHtmlTagEnd(source, start);
    return end < 0 ? -1 : end + 1;
  }
  return null;
}

export function findMarkdownHtmlTagEnd(source: string, tagStart: number): number {
  let quote: "\"" | "'" | null = null;

  for (let index = tagStart + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === ">") return index;
  }

  return -1;
}

function skipHtmlWhitespace(source: string, from: number, to: number): number {
  let cursor = from;
  while (cursor < to && isHtmlWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

function isHtmlWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}

function isAsciiLetter(character: string | undefined): boolean {
  return Boolean(character && /[a-z]/i.test(character));
}

function isTagNameCharacter(character: string | undefined): boolean {
  return Boolean(character && /[a-z0-9-]/i.test(character));
}

function isAttributeNameCharacter(character: string | undefined): boolean {
  return Boolean(character && !isHtmlWhitespace(character) && !/["'<>/=]/.test(character));
}
