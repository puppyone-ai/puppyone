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
import { renderMarkdownBlocksToHtml } from "./markdownHtmlRenderer";
import { resolveMarkdownLinkReference } from "../../core/links/markdownLinkReferences";
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
  crossing: readonly MarkdownHtmlFlowBounds[] | null;
};

const MARKDOWN_HTML_FLOW_MAX_SIBLINGS = 512;

const markdownHtmlFlowCache = new WeakMap<object, MarkdownHtmlFlowCacheEntry>();

export function getMarkdownHtmlBlock(state: EditorState, lineNumber: number): MarkdownHtmlBlock | null {
  const doc = state.doc;
  const requestedLine = doc.line(lineNumber);
  const crossing = findMarkdownCrossingFlow(state, requestedLine.from);
  if (crossing) return createMarkdownCrossingBlock(state, crossing);

  const requestedNode = findHtmlBlockStartingOnLine(state, requestedLine.from, requestedLine.to);
  if (!requestedNode) return null;

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

/**
 * Written as GitHub reads it: tags open in one block and close in another, and
 * the Markdown between them is ordinary content. The whole range becomes one
 * HTML document for the browser to build, so `<details>` works and its body
 * still renders as Markdown.
 */
function createMarkdownCrossingBlock(
  state: EditorState,
  { startNode, endNode }: MarkdownHtmlFlowBounds,
): MarkdownHtmlBlock {
  const firstLine = state.doc.lineAt(startNode.from);
  const lastLine = state.doc.lineAt(Math.max(endNode.from, endNode.to - 1));
  const source = renderMarkdownBlocksToHtml(state.sliceDoc(firstLine.from, lastLine.to), {
    resolveReference: (label) => resolveMarkdownLinkReference(state, label),
  });
  const structure = validateMarkdownHtmlBlockStructure(source, firstLine.from);
  return {
    from: firstLine.from,
    to: lastLine.to,
    nextLineNumber: lastLine.number + 1,
    source,
    tagName: structure.tagName,
    status: structure.status,
    diagnostic: structure.diagnostic,
    metrics: estimateHtmlBlockMetrics(structure.tokens),
  };
}

function findMarkdownCrossingFlow(state: EditorState, position: number): MarkdownHtmlFlowBounds | null {
  const flows = getMarkdownCrossingFlows(state);
  let low = 0;
  let high = flows.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const flow = flows[middle];
    if (!flow) return null;
    if (position < state.doc.lineAt(flow.startNode.from).from) high = middle - 1;
    else if (position > flow.endNode.to) low = middle + 1;
    else return flow;
  }
  return null;
}

function getMarkdownCrossingFlows(state: EditorState): readonly MarkdownHtmlFlowBounds[] {
  const cache = getMarkdownHtmlFlowCache(state);
  if (cache.crossing) return cache.crossing;

  const flows: MarkdownHtmlFlowBounds[] = [];
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (!MARKDOWN_HTML_BLOCK_NODE_NAMES.has(node.name)) continue;
    const endNode = findMarkdownCrossingFlowEnd(state, node);
    if (!endNode) continue;
    flows.push({ startNode: node, endNode });
    node = endNode;
  }
  cache.crossing = flows;
  return flows;
}

/** The balancing sibling, once at least one non-HTML block has been crossed. */
function findMarkdownCrossingFlowEnd(state: EditorState, firstNode: SyntaxNode): SyntaxNode | null {
  const sourceFrom = state.doc.lineAt(firstNode.from).from;
  const firstStructure = validateMarkdownHtmlBlockStructure(state.sliceDoc(sourceFrom, firstNode.to), sourceFrom);
  if (firstStructure.status !== "incomplete") return null;
  const openTags = collectExplicitOpenTags(firstStructure.tokens);
  if (openTags.length === 0) return null;

  let crossedMarkdown = false;
  let visited = 0;
  for (let node = firstNode.nextSibling; node && visited < MARKDOWN_HTML_FLOW_MAX_SIBLINGS; node = node.nextSibling) {
    visited += 1;
    if (!MARKDOWN_HTML_BLOCK_NODE_NAMES.has(node.name)) {
      crossedMarkdown = true;
      continue;
    }
    for (const token of scanMarkdownHtmlTagTokens(state.sliceDoc(node.from, node.to), node.from)) {
      if (!token.closing) {
        if (!token.selfClosing) openTags.push(token.tagName);
      } else if (openTags.at(-1) === token.tagName) {
        openTags.pop();
      } else {
        return null;
      }
    }
    if (openTags.length === 0) return crossedMarkdown ? node : null;
  }
  return null;
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
  const created = { tree, byNodeFrom: new Map<number, MarkdownHtmlFlowBounds>(), crossing: null };
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
