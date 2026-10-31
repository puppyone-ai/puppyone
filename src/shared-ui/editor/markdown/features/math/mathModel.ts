import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type MarkdownMathBlock = Readonly<{
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  nextLineNumber: number;
  source: string;
}>;

export type MarkdownInlineMathToken = Readonly<{
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  source: string;
}>;

const BLOCK_DELIMITER = /^\s{0,3}\$\$\s*$/;
const SUPPRESSED_SYNTAX_NODES = new Set([
  "CodeBlock",
  "CodeInfo",
  "FencedCode",
  "HTMLBlock",
  "HTMLTag",
  "InlineCode",
  "URL",
]);

export function getMarkdownMathBlock(
  state: EditorState,
  openingLineNumber: number,
): MarkdownMathBlock | null {
  const opening = state.doc.line(openingLineNumber);
  if (!BLOCK_DELIMITER.test(opening.text) || isSuppressedSyntaxPosition(state, opening.from)) {
    return null;
  }

  for (let lineNumber = openingLineNumber + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const closing = state.doc.line(lineNumber);
    if (!BLOCK_DELIMITER.test(closing.text)) continue;

    const contentFrom = Math.min(opening.to + 1, closing.from);
    const contentTo = trimLineBreakBefore(state, closing.from, contentFrom);
    const source = state.sliceDoc(contentFrom, contentTo);
    if (!source.trim() || rangeIntersectsSuppressedSyntax(state, opening.from, closing.to)) {
      return null;
    }

    return {
      from: opening.from,
      to: closing.to,
      contentFrom,
      contentTo,
      nextLineNumber: closing.number + 1,
      source,
    };
  }

  return null;
}

export function findMarkdownInlineMathTokens(
  state: EditorState,
  from: number,
  to: number,
): MarkdownInlineMathToken[] {
  const rangeFrom = Math.max(0, Math.min(from, to, state.doc.length));
  const rangeTo = Math.max(rangeFrom, Math.min(Math.max(from, to), state.doc.length));
  const firstLine = state.doc.lineAt(rangeFrom);
  const lastLine = state.doc.lineAt(rangeTo);
  const tokens: MarkdownInlineMathToken[] = [];

  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    for (const token of scanInlineMath(line.text)) {
      const absoluteFrom = line.from + token.from;
      const absoluteTo = line.from + token.to;
      if (rangeIntersectsSuppressedSyntax(state, absoluteFrom, absoluteTo)) continue;
      tokens.push({
        from: absoluteFrom,
        to: absoluteTo,
        contentFrom: line.from + token.contentFrom,
        contentTo: line.from + token.contentTo,
        source: token.source,
      });
    }
  }

  return tokens;
}

function scanInlineMath(text: string): MarkdownInlineMathToken[] {
  const tokens: MarkdownInlineMathToken[] = [];
  for (let opening = 0; opening < text.length; opening += 1) {
    if (
      text[opening] !== "$"
      || text[opening + 1] === "$"
      || isEscaped(text, opening)
      || !text[opening + 1]
      || /\s/.test(text[opening + 1])
    ) continue;

    for (let closing = opening + 1; closing < text.length; closing += 1) {
      if (text[closing] !== "$" || isEscaped(text, closing)) continue;
      if (text[closing - 1] === "$" || text[closing + 1] === "$" || /\s/.test(text[closing - 1])) {
        opening = text[closing + 1] === "$" ? closing + 1 : closing - 1;
        break;
      }
      const source = text.slice(opening + 1, closing);
      if (isCompactCurrencyBoundary(source, text[closing + 1] ?? "")) {
        opening = closing;
        break;
      }
      tokens.push({
        from: opening,
        to: closing + 1,
        contentFrom: opening + 1,
        contentTo: closing,
        source,
      });
      opening = closing;
      break;
    }
  }
  return tokens;
}

function isEscaped(text: string, position: number): boolean {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isCompactCurrencyBoundary(source: string, nextCharacter: string): boolean {
  return /\d/.test(nextCharacter)
    && /^[+-]?\d[\d,]*(?:\.\d+)?[-–—]?$/.test(source);
}

function isSuppressedSyntaxPosition(state: EditorState, position: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1);
  while (node) {
    if (SUPPRESSED_SYNTAX_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

function rangeIntersectsSuppressedSyntax(state: EditorState, from: number, to: number): boolean {
  let intersects = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        !SUPPRESSED_SYNTAX_NODES.has(node.name)
        || node.from >= to
        || node.to <= from
      ) return true;
      intersects = true;
      return false;
    },
  });
  return intersects;
}

function trimLineBreakBefore(state: EditorState, position: number, minimum: number): number {
  let end = position;
  if (end > minimum && state.sliceDoc(end - 1, end) === "\n") end -= 1;
  if (end > minimum && state.sliceDoc(end - 1, end) === "\r") end -= 1;
  return end;
}
