import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export type MdxComponentTagToken = Readonly<{
  from: number;
  to: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributesSource: string;
}>;

/**
 * Incremental Markdown block grammar for the declarative component subset.
 * It runs before CommonMark HTML so blank lines remain inside one component
 * node. Only capitalized names are claimed; ordinary HTML keeps its own path.
 */
export const markdownMdxComponentParserExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "MdxComponentBlock",
      block: true,
      style: tags.meta,
    },
  ],
  parseBlock: [{
    name: "MdxComponentBlock",
    before: "HTMLBlock",
    parse(context, line) {
      return parseMdxComponentBlock(context, line);
    },
    endLeaf(_context, line) {
      return getOpeningComponentToken(line) !== null;
    },
  }],
};

function parseMdxComponentBlock(context: BlockContext, line: Line): boolean {
  const opening = getOpeningComponentToken(line);
  if (!opening) return false;

  const from = context.lineStart + line.pos;
  const stack: string[] = [];
  let firstLine = true;
  let codeFence: { character: string; length: number } | null = null;

  for (;;) {
    const lineOffset = firstLine ? line.pos : line.basePos;
    const absoluteLineFrom = context.lineStart + lineOffset;
    const lineSource = line.text.slice(lineOffset);
    const fenceMarker = firstLine ? null : getCodeFenceMarker(lineSource);
    let tokens: MdxComponentTagToken[] = [];
    if (codeFence) {
      if (
        fenceMarker
        && fenceMarker.character === codeFence.character
        && fenceMarker.length >= codeFence.length
      ) {
        codeFence = null;
      }
    } else if (fenceMarker) {
      codeFence = fenceMarker;
    } else {
      tokens = scanMdxComponentTagTokens(lineSource, absoluteLineFrom);
    }
    for (const token of tokens) {
      if (token.closing) {
        if (stack[stack.length - 1] === token.name) stack.pop();
      } else if (!token.selfClosing) {
        stack.push(token.name);
      }

      if (stack.length === 0) {
        context.nextLine();
        context.addElement(context.elt("MdxComponentBlock", from, context.prevLineEnd()));
        return true;
      }
    }

    firstLine = false;
    if (!context.nextLine()) break;
  }

  // Preserve one malformed semantic block through EOF. The Feature compiler
  // will expose exact source rather than sending parser fragments to HTML.
  context.addElement(context.elt("MdxComponentBlock", from, context.prevLineEnd()));
  return true;
}

function getCodeFenceMarker(source: string): { character: string; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(source);
  return match
    ? { character: match[1][0], length: match[1].length }
    : null;
}

function getOpeningComponentToken(line: Line): MdxComponentTagToken | null {
  if (line.next !== 60 /* < */) return null;
  const source = line.text.slice(line.pos);
  const tokens = scanMdxComponentTagTokens(source, line.pos);
  const token = tokens[0] ?? null;
  if (!token || token.from !== line.pos || token.closing) return null;
  return token;
}

export function scanMdxComponentTagTokens(
  source: string,
  absoluteFrom = 0,
): MdxComponentTagToken[] {
  const tokens: MdxComponentTagToken[] = [];
  let cursor = 0;
  let codeFence: string | null = null;

  while (cursor < source.length) {
    if (source[cursor] === "`" || source[cursor] === "~") {
      const run = readCharacterRun(source, cursor, source[cursor]);
      if (run.length >= 3 && isLinePrefixWhitespace(source, cursor)) {
        if (!codeFence) codeFence = run;
        else if (run[0] === codeFence[0] && run.length >= codeFence.length) codeFence = null;
        cursor += run.length;
        continue;
      }
    }
    if (codeFence) {
      cursor += 1;
      continue;
    }

    if (source[cursor] !== "<") {
      cursor += 1;
      continue;
    }
    const token = parseMdxComponentTagTokenAt(source, cursor, absoluteFrom);
    if (token) {
      tokens.push(token);
      cursor = token.to - absoluteFrom;
    } else {
      cursor += 1;
    }
  }

  return tokens;
}

export function parseMdxComponentTagTokenAt(
  source: string,
  start: number,
  absoluteFrom = 0,
): MdxComponentTagToken | null {
  if (source[start] !== "<") return null;
  let cursor = start + 1;
  const closing = source[cursor] === "/";
  if (closing) cursor += 1;

  const nameFrom = cursor;
  if (!isUpperAsciiLetter(source[cursor])) return null;
  cursor += 1;
  while (cursor < source.length && /[A-Za-z0-9_.-]/.test(source[cursor])) cursor += 1;
  const name = source.slice(nameFrom, cursor);

  let quote: "\"" | "'" | null = null;
  let braceDepth = 0;
  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}" && braceDepth > 0) braceDepth -= 1;
    else if (character === ">" && braceDepth === 0) break;
  }
  if (cursor >= source.length || quote || braceDepth !== 0) return null;

  const beforeClose = source.slice(nameFrom + name.length, cursor);
  const selfClosing = !closing && /\/\s*$/.test(beforeClose);
  const attributesSource = beforeClose.replace(/\/\s*$/, "");
  if (closing && attributesSource.trim()) return null;

  return {
    from: absoluteFrom + start,
    to: absoluteFrom + cursor + 1,
    name,
    closing,
    selfClosing,
    attributesSource,
  };
}

function isUpperAsciiLetter(character: string | undefined): boolean {
  return Boolean(character && /[A-Z]/.test(character));
}

function readCharacterRun(source: string, start: number, character: string): string {
  let end = start + 1;
  while (source[end] === character) end += 1;
  return source.slice(start, end);
}

function isLinePrefixWhitespace(source: string, position: number): boolean {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  return source.slice(lineStart, position).trim() === "";
}
