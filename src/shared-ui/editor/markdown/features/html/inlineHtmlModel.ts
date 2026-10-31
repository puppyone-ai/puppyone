import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type {
  MarkdownInlineHtml,
  MarkdownInlineHtmlStatus,
} from "../../core/features/markdownFeatureData";
export type {
  MarkdownInlineHtml,
  MarkdownInlineHtmlStatus,
} from "../../core/features/markdownFeatureData";
import {
  parseMarkdownHtmlTagToken,
  type MarkdownHtmlTagToken,
} from "./htmlTagTokenizer";

type InlineContainer = {
  from: number;
  to: number;
  tokens: MarkdownHtmlTagToken[];
};

type MarkdownInlineHtmlCacheEntry = {
  tree: ReturnType<typeof syntaxTree>;
  elements: readonly MarkdownInlineHtml[] | null;
  intervals: MarkdownInlineHtmlIntervalNode | null;
  containerElements: Map<string, readonly MarkdownInlineHtml[]>;
};

export type MarkdownInlineHtmlDiagnostics = Readonly<{
  fullDocumentScans: number;
  rangeScans: number;
  containersScanned: number;
  tokensScanned: number;
}>;

type MarkdownInlineHtmlIntervalNode = {
  element: MarkdownInlineHtml;
  maxTo: number;
  left: MarkdownInlineHtmlIntervalNode | null;
  right: MarkdownInlineHtmlIntervalNode | null;
};

const markdownInlineHtmlCache = new WeakMap<object, MarkdownInlineHtmlCacheEntry>();
const diagnostics = {
  fullDocumentScans: 0,
  rangeScans: 0,
  containersScanned: 0,
  tokensScanned: 0,
};

export function getMarkdownInlineHtml(state: EditorState): readonly MarkdownInlineHtml[] {
  const tree = syntaxTree(state);
  const cached = markdownInlineHtmlCache.get(state.doc);
  if (cached?.tree === tree && cached.elements) return cached.elements;

  const containers = collectInlineHtmlContainers(state, tree);
  diagnostics.fullDocumentScans += 1;
  diagnostics.containersScanned += containers.size;
  diagnostics.tokensScanned += countContainerTokens(containers);
  const containerElements = new Map<string, readonly MarkdownInlineHtml[]>();
  for (const [key, container] of containers) {
    containerElements.set(key, pairInlineHtmlContainer(container));
  }
  const elements = Array.from(containerElements.values())
    .flat()
    .sort(compareInlineHtmlElements);
  markdownInlineHtmlCache.set(state.doc, {
    tree,
    elements,
    intervals: buildInlineHtmlIntervalIndex(elements, 0, elements.length),
    containerElements,
  });
  return elements;
}

export function getMarkdownInlineHtmlInRange(
  state: EditorState,
  from: number,
  to: number,
): readonly MarkdownInlineHtml[] {
  const rangeFrom = Math.max(0, Math.min(from, to, state.doc.length));
  const rangeTo = Math.max(rangeFrom, Math.min(Math.max(from, to), state.doc.length));
  const tree = syntaxTree(state);
  const cached = getOrCreateInlineHtmlCacheEntry(state, tree);
  if (!cached.elements) {
    diagnostics.rangeScans += 1;
    const containers = collectInlineHtmlContainersInRange(state, tree, rangeFrom, rangeTo);
    diagnostics.containersScanned += containers.size;
    diagnostics.tokensScanned += countContainerTokens(containers);
    const elements: MarkdownInlineHtml[] = [];
    for (const [key, container] of containers) {
      const paired = cached.containerElements.get(key) ?? pairInlineHtmlContainer(container);
      cached.containerElements.set(key, paired);
      for (const element of paired) {
        if (element.from < rangeTo && element.to > rangeFrom) elements.push(element);
      }
    }
    return elements.sort(compareInlineHtmlElements);
  }
  const result: MarkdownInlineHtml[] = [];
  queryInlineHtmlIntervalIndex(
    cached.intervals,
    rangeFrom,
    rangeTo,
    result,
  );
  return result;
}

export function getMarkdownInlineHtmlDiagnostics(): MarkdownInlineHtmlDiagnostics {
  return { ...diagnostics };
}

export function resetMarkdownInlineHtmlDiagnostics() {
  diagnostics.fullDocumentScans = 0;
  diagnostics.rangeScans = 0;
  diagnostics.containersScanned = 0;
  diagnostics.tokensScanned = 0;
}

function getOrCreateInlineHtmlCacheEntry(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
): MarkdownInlineHtmlCacheEntry {
  const cached = markdownInlineHtmlCache.get(state.doc);
  if (cached?.tree === tree) return cached;
  const created: MarkdownInlineHtmlCacheEntry = {
    tree,
    elements: null,
    intervals: null,
    containerElements: new Map(),
  };
  markdownInlineHtmlCache.set(state.doc, created);
  return created;
}

function buildInlineHtmlIntervalIndex(
  elements: readonly MarkdownInlineHtml[],
  from: number,
  to: number,
): MarkdownInlineHtmlIntervalNode | null {
  if (from >= to) return null;
  const middle = (from + to) >>> 1;
  const element = elements[middle];
  if (!element) return null;
  const left = buildInlineHtmlIntervalIndex(elements, from, middle);
  const right = buildInlineHtmlIntervalIndex(elements, middle + 1, to);
  return {
    element,
    maxTo: Math.max(element.to, left?.maxTo ?? Number.NEGATIVE_INFINITY, right?.maxTo ?? Number.NEGATIVE_INFINITY),
    left,
    right,
  };
}

function queryInlineHtmlIntervalIndex(
  node: MarkdownInlineHtmlIntervalNode | null,
  from: number,
  to: number,
  result: MarkdownInlineHtml[],
) {
  if (!node || node.maxTo <= from) return;
  queryInlineHtmlIntervalIndex(node.left, from, to, result);
  if (node.element.from < to && node.element.to > from) result.push(node.element);
  if (node.element.from < to) queryInlineHtmlIntervalIndex(node.right, from, to, result);
}

function collectInlineHtmlContainers(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
): Map<string, InlineContainer> {
  const containers = new Map<string, InlineContainer>();

  tree.iterate({
    enter(nodeRef) {
      const node = nodeRef.node;
      if (node.name !== "HTMLTag") return true;

      const containerNode = findInlineContainerNode(node);
      if (!containerNode) return false;

      const token = parseMarkdownHtmlTagToken(state.sliceDoc(node.from, node.to), node.from);
      if (!token) return false;

      const key = `${containerNode.from}:${containerNode.to}`;
      const container = containers.get(key) ?? {
        from: containerNode.from,
        to: containerNode.to,
        tokens: [],
      };
      container.tokens.push(token);
      containers.set(key, container);
      return false;
    },
  });

  for (const container of containers.values()) {
    container.tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  }
  return containers;
}

function collectInlineHtmlContainersInRange(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
): Map<string, InlineContainer> {
  const containers = new Map<string, InlineContainer>();
  if (state.doc.length === 0) return containers;
  const probeFrom = from >= state.doc.length ? Math.max(0, state.doc.length - 1) : from;
  const probeTo = Math.min(
    state.doc.length,
    Math.max(to, probeFrom + 1),
  );

  tree.iterate({
    from: probeFrom,
    to: probeTo,
    enter(nodeRef) {
      const node = nodeRef.node;
      if (node.name === "HTMLBlock") return false;
      if (!isInlineContainerName(node.name)) return true;
      const key = `${node.from}:${node.to}`;
      if (!containers.has(key)) {
        containers.set(key, collectInlineHtmlContainer(state, tree, node));
      }
      return false;
    },
  });
  return containers;
}

function collectInlineHtmlContainer(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  containerNode: SyntaxNode,
): InlineContainer {
  const container: InlineContainer = {
    from: containerNode.from,
    to: containerNode.to,
    tokens: [],
  };
  tree.iterate({
    from: containerNode.from,
    to: containerNode.to,
    enter(nodeRef) {
      const node = nodeRef.node;
      if (node.name !== "HTMLTag") return true;
      const owner = findInlineContainerNode(node);
      if (owner?.from !== containerNode.from || owner.to !== containerNode.to) return false;
      const token = parseMarkdownHtmlTagToken(state.sliceDoc(node.from, node.to), node.from);
      if (token) container.tokens.push(token);
      return false;
    },
  });
  container.tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  return container;
}

function countContainerTokens(containers: ReadonlyMap<string, InlineContainer>): number {
  let count = 0;
  for (const container of containers.values()) count += container.tokens.length;
  return count;
}

function findInlineContainerNode(node: SyntaxNode): SyntaxNode | null {
  for (let current = node.parent; current; current = current.parent) {
    if (isInlineContainerName(current.name)) return current;
    if (current.name === "HTMLBlock" || current.name === "Document") break;
  }
  return null;
}

function isInlineContainerName(name: string): boolean {
  return (
    name === "Paragraph" ||
    /^ATXHeading[1-6]$/.test(name) ||
    /^SetextHeading[12]$/.test(name)
  );
}

function pairInlineHtmlContainer(container: InlineContainer): MarkdownInlineHtml[] {
  const elements: MarkdownInlineHtml[] = [];
  const stack: MarkdownHtmlTagToken[] = [];
  const invalidRanges: Array<{ from: number; to: number }> = [];

  for (const token of container.tokens) {
    if (token.selfClosing) {
      elements.push(createStandaloneElement(token, "complete", container));
      continue;
    }

    if (!token.closing) {
      stack.push(token);
      continue;
    }

    const opening = stack[stack.length - 1];
    if (!opening || opening.tagName !== token.tagName) {
      elements.push(createStandaloneElement(token, "malformed", container));
      invalidRanges.push({ from: token.from, to: token.to });
      continue;
    }

    stack.pop();
    elements.push({
      kind: "inlineHtml",
      from: opening.from,
      to: token.to,
      tagName: opening.tagName,
      openingMarker: { from: opening.from, to: opening.to },
      contentRange: { from: opening.to, to: token.from },
      closingMarker: { from: token.from, to: token.to },
      attributes: opening.attributes,
      status: "complete",
      containerFrom: container.from,
      containerTo: container.to,
    });
  }

  for (const opening of stack) {
    const invalidRange = { from: opening.from, to: container.to };
    invalidRanges.push(invalidRange);
    elements.push({
      kind: "inlineHtml",
      from: opening.from,
      to: container.to,
      tagName: opening.tagName,
      openingMarker: { from: opening.from, to: opening.to },
      contentRange: opening.to <= container.to ? { from: opening.to, to: container.to } : null,
      closingMarker: null,
      attributes: opening.attributes,
      status: "incomplete",
      containerFrom: container.from,
      containerTo: container.to,
    });
  }

  return elements.map((element) => {
    if (element.status !== "complete") return element;
    const enclosedByInvalidSource = invalidRanges.some((range) => (
      element.from >= range.from && element.to <= range.to
    ));
    return enclosedByInvalidSource ? { ...element, status: "malformed" } : element;
  });
}

function createStandaloneElement(
  token: MarkdownHtmlTagToken,
  status: MarkdownInlineHtmlStatus,
  container: InlineContainer,
): MarkdownInlineHtml {
  return {
    kind: "inlineHtml",
    from: token.from,
    to: token.to,
    tagName: token.tagName,
    openingMarker: { from: token.from, to: token.to },
    contentRange: null,
    closingMarker: null,
    attributes: token.attributes,
    status,
    containerFrom: container.from,
    containerTo: container.to,
  };
}

function compareInlineHtmlElements(left: MarkdownInlineHtml, right: MarkdownInlineHtml): number {
  return left.from - right.from || right.to - left.to || left.tagName.localeCompare(right.tagName);
}
