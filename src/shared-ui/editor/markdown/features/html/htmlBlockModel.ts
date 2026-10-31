import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownHtmlBlockMetrics } from "../../core/features/markdownFeatureData";
export type { MarkdownHtmlBlockMetrics } from "../../core/features/markdownFeatureData";
import {
  scanMarkdownHtmlTagTokens,
  type MarkdownHtmlTagToken,
} from "./htmlTagTokenizer";
import { validateMarkdownHtmlBlockStructure } from "./htmlBlockStructure";
import type { MarkdownHtmlBlockStatus } from "../../core/features/markdownFeatureData";

export type MarkdownHtmlBlock = {
  from: number;
  to: number;
  nextLineNumber: number;
  source: string;
  tagName: string | null;
  status: MarkdownHtmlBlockStatus;
  diagnostic: string | null;
  metrics: MarkdownHtmlBlockMetrics;
};

type MarkdownHtmlFlowBounds = Readonly<{
  startNode: SyntaxNode;
  endNode: SyntaxNode;
}>;

type MarkdownHtmlFlowCacheEntry = {
  tree: ReturnType<typeof syntaxTree>;
  byNodeFrom: Map<number, MarkdownHtmlFlowBounds>;
};

const markdownHtmlFlowCache = new WeakMap<object, MarkdownHtmlFlowCacheEntry>();

export function getMarkdownHtmlBlock(state: EditorState, lineNumber: number): MarkdownHtmlBlock | null {
  const doc = state.doc;
  const requestedLine = doc.line(lineNumber);
  const requestedNode = findHtmlBlockStartingOnLine(state, requestedLine.from, requestedLine.to);
  if (!requestedNode) return getStandaloneMediaHtmlBlock(state, lineNumber);

  const { startNode, endNode: flowEndNode } = findMarkdownHtmlFlowContainingNode(state, requestedNode);
  const firstLine = doc.lineAt(startNode.from);
  const lastPosition = Math.max(flowEndNode.from, flowEndNode.to - 1);
  const lastLine = doc.lineAt(lastPosition);
  const from = firstLine.from;
  const to = lastLine.to;
  const source = state.sliceDoc(from, to);
  const structure = validateMarkdownHtmlBlockStructure(source, from);

  return {
    from,
    to,
    nextLineNumber: lastLine.number + 1,
    source,
    tagName: structure.tagName,
    status: structure.status,
    diagnostic: structure.diagnostic,
    metrics: estimateHtmlBlockMetrics(structure.tokens),
  };
}

function findMarkdownHtmlFlowContainingNode(
  state: EditorState,
  requestedNode: SyntaxNode,
): MarkdownHtmlFlowBounds {
  const cache = getMarkdownHtmlFlowCache(state);
  const cached = cache.byNodeFrom.get(requestedNode.from);
  if (cached) return cached;

  let runStart = requestedNode;
  while (
    runStart.prevSibling
    && MARKDOWN_HTML_BLOCK_NODE_NAMES.has(runStart.prevSibling.name)
    && state.sliceDoc(runStart.prevSibling.to, runStart.from).trim() === ""
  ) {
    runStart = runStart.prevSibling;
  }

  let runEnd = requestedNode;
  while (
    runEnd.nextSibling
    && MARKDOWN_HTML_BLOCK_NODE_NAMES.has(runEnd.nextSibling.name)
    && state.sliceDoc(runEnd.to, runEnd.nextSibling.from).trim() === ""
  ) {
    runEnd = runEnd.nextSibling;
  }

  let candidate: SyntaxNode | null = runStart;
  while (candidate) {
    const sourceFrom = state.doc.lineAt(candidate.from).from;
    const endNode = findMarkdownHtmlFlowEnd(state, candidate, sourceFrom);
    const bounds = { startNode: candidate, endNode } as const;
    let member: SyntaxNode | null = candidate;
    while (member) {
      cache.byNodeFrom.set(member.from, bounds);
      if (member.from === endNode.from && member.to === endNode.to) break;
      member = member.nextSibling;
    }

    const next = endNode.nextSibling;
    if (
      !next
      || !MARKDOWN_HTML_BLOCK_NODE_NAMES.has(next.name)
      || state.sliceDoc(endNode.to, next.from).trim() !== ""
    ) break;
    candidate = next;
    if (candidate.from > runEnd.from) break;
  }

  return cache.byNodeFrom.get(requestedNode.from) ?? {
    startNode: requestedNode,
    endNode: requestedNode,
  };
}

function getMarkdownHtmlFlowCache(state: EditorState): MarkdownHtmlFlowCacheEntry {
  const tree = syntaxTree(state);
  const existing = markdownHtmlFlowCache.get(state.doc);
  if (existing?.tree === tree) return existing;
  const created = { tree, byNodeFrom: new Map<number, MarkdownHtmlFlowBounds>() };
  markdownHtmlFlowCache.set(state.doc, created);
  return created;
}

/**
 * CommonMark raw-HTML block nodes are parser fragments, not necessarily one
 * balanced DOM root. Type-6/7 blocks end at a blank line, so a conventional
 * README header can become several sibling HTMLBlock nodes even though its
 * authored tag stack is one continuous flow.
 *
 * Reassembly remains parser-authoritative: only sibling HTML nodes with a
 * whitespace-only gap are consumed, and only while the first fragment has an
 * explicitly open authored stack. A Paragraph, Heading, Fence, component, or
 * any other syntax node is a hard boundary. The boundary scan is incremental;
 * full structural validation still runs exactly once over the final range.
 */
function findMarkdownHtmlFlowEnd(
  state: EditorState,
  firstNode: SyntaxNode,
  sourceFrom: number,
): SyntaxNode {
  const firstSource = state.sliceDoc(sourceFrom, state.doc.lineAt(Math.max(firstNode.from, firstNode.to - 1)).to);
  const firstStructure = validateMarkdownHtmlBlockStructure(firstSource, sourceFrom);
  if (firstStructure.status !== "incomplete") return firstNode;

  const openTags = collectExplicitOpenTags(firstStructure.tokens);
  if (openTags.length === 0) return firstNode;

  let endNode = firstNode;
  while (endNode.nextSibling && MARKDOWN_HTML_BLOCK_NODE_NAMES.has(endNode.nextSibling.name)) {
    const nextNode = endNode.nextSibling;
    if (state.sliceDoc(endNode.to, nextNode.from).trim() !== "") break;

    endNode = nextNode;
    const tokens = scanMarkdownHtmlTagTokens(
      state.sliceDoc(nextNode.from, nextNode.to),
      nextNode.from,
    );
    let mismatched = false;
    for (const token of tokens) {
      if (!token.closing) {
        if (!token.selfClosing) openTags.push(token.tagName);
        continue;
      }
      if (openTags.at(-1) !== token.tagName) {
        mismatched = true;
        break;
      }
      openTags.pop();
    }

    // Include the fragment that either balances or invalidates the authored
    // flow so the semantic layer emits one exact-range result.
    if (mismatched || openTags.length === 0) break;
  }

  return endNode;
}

function collectExplicitOpenTags(tokens: readonly MarkdownHtmlTagToken[]): string[] {
  const stack: string[] = [];
  for (const token of tokens) {
    if (!token.closing) {
      if (!token.selfClosing) stack.push(token.tagName);
      continue;
    }
    if (stack.at(-1) !== token.tagName) return [];
    stack.pop();
  }
  return stack;
}

/**
 * Lezer does not consistently promote a standalone media element on one
 * physical line to HTMLBlock, especially when it follows paragraph text
 * without a blank line. Keep the product dialect deliberately narrow: only a
 * complete <img> or closed <video> root that owns the whole line gets block
 * media treatment. Other inline HTML remains under the normal Markdown parser,
 * and four-space-indented source remains an indented code block.
 */
function getStandaloneMediaHtmlBlock(
  state: EditorState,
  lineNumber: number,
): MarkdownHtmlBlock | null {
  const line = state.doc.line(lineNumber);
  const leadingWhitespace = line.text.match(/^[ \t]*/)?.[0] ?? "";
  if (leadingWhitespace.includes("\t") || leadingWhitespace.length > 3) return null;

  const trimmedSource = line.text.trim();
  if (!trimmedSource.startsWith("<")) return null;

  const sourceFrom = line.from + leadingWhitespace.length;
  const tokens = scanMarkdownHtmlTagTokens(trimmedSource, sourceFrom);
  const opening = tokens[0] ?? null;
  const closing = tokens.at(-1) ?? null;
  const sourceTo = sourceFrom + trimmedSource.length;
  const isCompleteImage = Boolean(
    opening
    && opening.tagName === "img"
    && !opening.closing
    && opening.selfClosing
    && opening.from === sourceFrom
    && opening.to === sourceTo
    && tokens.length === 1,
  );
  const isCompleteVideo = Boolean(
    opening
    && opening.tagName === "video"
    && !opening.closing
    && !opening.selfClosing
    && opening.from === sourceFrom
    && closing
    && closing.closing
    && closing.tagName === "video"
    && closing.to === sourceTo
    && validateMarkdownHtmlBlockStructure(trimmedSource, sourceFrom).status === "complete",
  );
  if (
    !opening
    || (!isCompleteImage && !isCompleteVideo)
  ) {
    return null;
  }

  return {
    from: line.from,
    to: line.to,
    nextLineNumber: line.number + 1,
    source: line.text,
    tagName: opening.tagName,
    status: "complete",
    diagnostic: null,
    metrics: estimateHtmlBlockMetrics(tokens),
  };
}

function estimateHtmlBlockMetrics(
  tokens: readonly MarkdownHtmlTagToken[],
): MarkdownHtmlBlockMetrics {
  const stack: string[] = [];
  let nestingDepth = 0;
  let elementCount = 0;
  let assetCount = 0;

  for (const token of tokens) {
    if (token.closing) {
      const matchingIndex = stack.lastIndexOf(token.tagName);
      if (matchingIndex >= 0) stack.length = matchingIndex;
      continue;
    }

    elementCount += 1;
    if (
      token.tagName === "img"
      || token.tagName === "video"
      || token.tagName === "audio"
      || token.tagName === "source"
    ) {
      assetCount += 1;
    }
    if (token.selfClosing) continue;
    stack.push(token.tagName);
    nestingDepth = Math.max(nestingDepth, stack.length);
  }

  return {
    logicalItems: tokens.length,
    // Text nodes and sanitizer wrappers are bounded by the tag count but are
    // not represented as tokens. A 2x estimate keeps policy conservative
    // without constructing DOM merely to decide whether DOM is affordable.
    estimatedDomNodes: Math.max(1, elementCount * 2 + 1),
    nestingDepth,
    assetCount,
  };
}

function findHtmlBlockStartingOnLine(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
): SyntaxNode | null {
  let match: SyntaxNode | null = null;

  syntaxTree(state).iterate({
    from: lineFrom,
    to: lineTo,
    enter(nodeRef) {
      const node = nodeRef.node;
      if (match || !MARKDOWN_HTML_BLOCK_NODE_NAMES.has(node.name)) return !match;
      if (node.from < lineFrom || node.from > lineTo) return false;
      if (state.sliceDoc(lineFrom, node.from).trim() !== "") return false;
      match = node;
      return false;
    },
  });

  return match;
}

const MARKDOWN_HTML_BLOCK_NODE_NAMES = new Set([
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
]);
