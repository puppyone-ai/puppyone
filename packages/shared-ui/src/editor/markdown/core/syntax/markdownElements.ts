import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  markdownFeatureCompositionFacet,
  type MarkdownFeatureComposition,
  type MarkdownFeatureSourceLine,
} from "../features/markdownFeatureContract";
import { getMarkdownTaskLine } from "../rendering/taskModel";
import { findMarkdownLinkTokens } from "../links/markdownLinkModel";
import { findWikiLinkTokens } from "../links/wikiLinkModel";
import { isEscapedInlineToken } from "../../shared/inlineTokenScan";
import {
  type MarkdownElement,
  type MarkdownElementKind,
  type MarkdownMarkerRange,
  type MarkdownPlainElement,
} from "./markdownElementTypes";

export type {
  MarkdownElement,
  MarkdownElementBase,
  MarkdownElementBlockData,
  MarkdownElementKind,
  MarkdownElementOf,
  MarkdownInlineHtmlElement,
  MarkdownMarkerRange,
} from "./markdownElementTypes";

type MarkdownElementCapabilities = {
  inlineDecoration: boolean;
  inlineMarkerDeletion: boolean;
  inlineReveal: boolean;
};

const MARKDOWN_ELEMENT_CAPABILITIES = {
  blockquote: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  emphasis: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  escape: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: false },
  fence: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  heading: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  htmlBlock: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  image: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: false },
  inlineHtml: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  inlineCode: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  link: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  list: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  mathBlock: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  mathInline: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: false },
  mdxComponent: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  rule: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  strike: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  strong: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
  table: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  task: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  video: { inlineDecoration: false, inlineMarkerDeletion: false, inlineReveal: false },
  wikiLink: { inlineDecoration: true, inlineMarkerDeletion: true, inlineReveal: true },
} satisfies Record<MarkdownElementKind, MarkdownElementCapabilities>;

type LineSource = MarkdownFeatureSourceLine;

type MarkdownElementsCacheEntry = {
  tree: ReturnType<typeof syntaxTree>;
  composition: MarkdownFeatureComposition | null;
  elements: MarkdownElement[];
};

const markdownElementsCache = new WeakMap<object, MarkdownElementsCacheEntry>();

export function getMarkdownElements(state: EditorState): MarkdownElement[] {
  const tree = syntaxTree(state);
  const composition = state.facet(markdownFeatureCompositionFacet);
  const cached = markdownElementsCache.get(state.doc);
  if (cached?.tree === tree && cached.composition === composition) return cached.elements;
  const elements = collectMarkdownElements(state, 0, state.doc.length);
  markdownElementsCache.set(state.doc, { tree, composition, elements });
  return elements;
}

export function getMarkdownElementsInRange(state: EditorState, from: number, to: number): MarkdownElement[] {
  const rangeFrom = Math.max(0, Math.min(from, to, state.doc.length));
  const rangeTo = Math.max(rangeFrom, Math.min(Math.max(from, to), state.doc.length));
  return collectMarkdownElements(state, rangeFrom, rangeTo);
}

function collectMarkdownElements(state: EditorState, from: number, to: number): MarkdownElement[] {
  const elements: MarkdownElement[] = [];
  const tree = syntaxTree(state);
  const composition = state.facet(markdownFeatureCompositionFacet);

  tree.iterate({
    from,
    to,
    enter(nodeRef) {
      const node = nodeRef.node;
      const line = getLineSource(state, node.from);
      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6":
          elements.push(createHeadingElement(node, line));
          return true;
        case "ListItem": {
          const listElement = createListElement(node, line);
          if (listElement) elements.push(listElement);
          return true;
        }
        case "Blockquote": {
          const quoteElement = createBlockquoteElement(node, line);
          if (quoteElement) elements.push(quoteElement);
          return true;
        }
        case "StrongEmphasis":
          elements.push(createMarkedInlineElement("strong", node, "EmphasisMark"));
          return true;
        case "Emphasis":
          elements.push(createMarkedInlineElement("emphasis", node, "EmphasisMark"));
          return true;
        case "InlineCode":
          elements.push(createMarkedInlineElement("inlineCode", node, "CodeMark"));
          return true;
        case "Escape":
          elements.push(createEscapeElement(node));
          return true;
        case "Link":
          elements.push(createLinkElement(node));
          return true;
        case "Autolink":
          elements.push(createAutolinkElement(node));
          return true;
        case "HorizontalRule":
          elements.push({
            kind: "rule",
            from: node.from,
            to: node.to,
            markerRanges: [{ from: node.from, to: node.to }],
            lineFrom: line.from,
            lineTo: line.to,
          });
          return true;
        default:
          return true;
      }
    },
  });

  if (composition) elements.push(...composition.collectRangeElements(state, from, to));

  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);
  addExtendedLineElements(state, elements, fromLine.number, toLine.number, composition);
  elements.sort((left, right) => left.from - right.from || left.to - right.to || left.kind.localeCompare(right.kind));
  return dedupeElements(elements);
}

export function getInlineRevealElement(
  state: EditorState,
  caret: number,
  elements?: MarkdownElement[],
): MarkdownElement | null {
  const candidates = elements ?? getMarkdownElementsInRange(state, state.doc.lineAt(caret).from, state.doc.lineAt(caret).to);
  let best: MarkdownElement | null = null;
  for (const element of candidates) {
    if (!isSelectableInlineFormat(element)) continue;
    if (caret <= element.from || caret >= element.to) continue;
    if (!best || element.to - element.from < best.to - best.from) best = element;
  }
  return best;
}

const INLINE_FORMAT_SELECTION_KINDS = new Set<MarkdownElementKind>([
  "emphasis",
  "inlineHtml",
  "strike",
  "strong",
]);

/**
 * When a selection covers the visible content of an inline format, return that
 * format so callers can inspect its markers without changing the selection.
 */
export function getInlineFormatSelectionElement(
  state: EditorState,
  from: number,
  to: number,
): MarkdownElement | null {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return getInlineRevealElement(state, start);

  const lineFrom = state.doc.lineAt(start).from;
  const lineTo = state.doc.lineAt(end).to;
  const candidates = getMarkdownElementsInRange(state, lineFrom, lineTo);
  let best: MarkdownElement | null = null;
  for (const element of candidates) {
    if (!INLINE_FORMAT_SELECTION_KINDS.has(element.kind) || !isSelectableInlineFormat(element)) continue;
    if (start < element.from || end > element.to) continue;
    const content = element.contentRange;
    const matchesContent = Boolean(content && start === content.from && end === content.to);
    const matchesWhole = start === element.from && end === element.to;
    if (!matchesContent && !matchesWhole) continue;
    if (!best || element.to - element.from < best.to - best.from) best = element;
  }
  return best;
}

function isSelectableInlineFormat(element: MarkdownElement): boolean {
  if (!isInlineRevealKind(element.kind)) return false;
  return !(element.kind === "inlineHtml" && element.inlineHtml?.status !== "complete");
}

export type MarkdownInlineFormatKind = "emphasis" | "highlight" | "inlineCode" | "mathInline" | "strike" | "strong" | "underline";

export type MarkdownInlineFormatCoverage = {
  formats: MarkdownElement[];
  neighbors: MarkdownElement[];
};

/**
 * MarkText-style coverage: formats fully contain the selection, neighbors overlap it.
 * An inner selection like `hello` inside `**hello**` still counts as strong.
 */
export function getInlineFormatCoverage(
  state: EditorState,
  from: number,
  to: number,
  kind: MarkdownInlineFormatKind,
): MarkdownInlineFormatCoverage {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const lineFrom = state.doc.lineAt(start).from;
  const lineTo = state.doc.lineAt(end).to;
  const formats: MarkdownElement[] = [];
  const neighbors: MarkdownElement[] = [];

  for (const element of getMarkdownElementsInRange(state, lineFrom, lineTo)) {
    if (!matchesInlineFormatKind(element, kind)) continue;
    if (isSelectionContainedByElement(start, end, element)) formats.push(element);
    if (isSelectionOverlappingElement(start, end, element)) neighbors.push(element);
  }

  return { formats, neighbors };
}

function matchesInlineFormatKind(element: MarkdownElement, kind: MarkdownInlineFormatKind): boolean {
  if (kind === "underline") return isCompleteHtmlTag(element, "u");
  if (kind === "highlight") return isCompleteHtmlTag(element, "mark");
  if (kind === "strong") return (element.kind === "strong" && isSelectableInlineFormat(element)) || isCompleteHtmlTag(element, "strong");
  if (kind === "emphasis") return (element.kind === "emphasis" && isSelectableInlineFormat(element)) || isCompleteHtmlTag(element, "em");
  return element.kind === kind && isSelectableInlineFormat(element);
}

function isCompleteHtmlTag(element: MarkdownElement, tagName: string): boolean {
  return element.kind === "inlineHtml"
    && element.inlineHtml.tagName === tagName
    && element.inlineHtml.status === "complete";
}

function isSelectionContainedByElement(start: number, end: number, element: MarkdownElement): boolean {
  return start >= element.from && end <= element.to && start < element.to;
}

function isSelectionOverlappingElement(start: number, end: number, element: MarkdownElement): boolean {
  return start < element.to && end > element.from;
}

export function isInlineRevealKind(kind: MarkdownElementKind): boolean {
  return MARKDOWN_ELEMENT_CAPABILITIES[kind].inlineReveal;
}

export function isInlineDecorationKind(kind: MarkdownElementKind): boolean {
  return MARKDOWN_ELEMENT_CAPABILITIES[kind].inlineDecoration;
}

export function isInlineMarkerDeletionKind(kind: MarkdownElementKind): boolean {
  return MARKDOWN_ELEMENT_CAPABILITIES[kind].inlineMarkerDeletion;
}

export function getBlockMarkerAtVisibleStart(state: EditorState, caret: number): MarkdownMarkerRange | null {
  const line = state.doc.lineAt(caret);
  const element = getMarkdownElementsInRange(state, line.from, line.to).find((candidate) => (
    candidate.lineFrom === line.from &&
    isBlockMarkerDeletionKind(candidate.kind) &&
    getVisibleStart(candidate) === caret
  ));
  if (!element) return null;

  if (element.kind === "task") {
    const stagedTaskMarker = element.markerRanges.find((range) => state.sliceDoc(range.from, range.to).includes("["));
    return stagedTaskMarker ?? element.markerRanges[0] ?? null;
  }

  return element.markerRanges[0] ?? null;
}

export function getHiddenBlockMarkerCaretNormalization(state: EditorState, caret: number): number | null {
  const line = state.doc.lineAt(caret);
  const element = getMarkdownElementsInRange(state, line.from, line.to).find((candidate) => (
    candidate.lineFrom === line.from &&
    isBlockMarkerDeletionKind(candidate.kind)
  ));
  if (!element) return null;

  const visibleStart = getVisibleStart(element);
  if (caret >= element.from && caret < visibleStart) return visibleStart;
  return null;
}

export function getMarkdownVisibleLineStart(state: EditorState, lineFrom: number): number | null {
  const line = state.doc.lineAt(lineFrom);
  const element = getMarkdownElementsInRange(state, line.from, line.to).find((candidate) => (
    candidate.lineFrom === line.from &&
    isBlockMarkerDeletionKind(candidate.kind)
  ));
  return element ? getVisibleStart(element) : null;
}

function isBlockMarkerDeletionKind(kind: MarkdownElementKind): boolean {
  return kind === "blockquote" || kind === "heading" || kind === "list" || kind === "task";
}

function getVisibleStart(element: MarkdownElement): number {
  return element.markerRanges.reduce((start, range) => Math.max(start, range.to), element.from);
}

function createHeadingElement(node: SyntaxNode, line: LineSource): MarkdownElement {
  const markerRange = directChildRanges(node, "HeaderMark")[0] ?? { from: node.from, to: node.from };
  const markerTo = line.text[markerRange.to - line.from] === " " ? markerRange.to + 1 : markerRange.to;
  return {
    kind: "heading",
    from: node.from,
    to: node.to,
    markerRanges: [{ from: markerRange.from, to: markerTo }],
    contentRange: { from: markerTo, to: node.to },
    lineFrom: line.from,
    lineTo: line.to,
    level: markerRange.to - markerRange.from,
  };
}

function createListElement(node: SyntaxNode, line: LineSource): MarkdownElement | null {
  const markerRange = directChildRanges(node, "ListMark")[0];
  if (!markerRange) return null;
  const markerTo = line.text[markerRange.to - line.from] === " " ? markerRange.to + 1 : markerRange.to;
  return {
    kind: "list",
    from: node.from,
    to: node.to,
    markerRanges: [{ from: markerRange.from, to: markerTo }],
    contentRange: { from: markerTo, to: node.to },
    lineFrom: line.from,
    lineTo: line.to,
  };
}

function createBlockquoteElement(node: SyntaxNode, line: LineSource): MarkdownElement | null {
  const markerRanges = createBlockquoteMarkerRanges(line);
  if (markerRanges.length === 0) return null;
  const markerTo = markerRanges.reduce((end, range) => Math.max(end, range.to), markerRanges[0].to);
  return {
    kind: "blockquote",
    from: node.from,
    to: node.to,
    markerRanges,
    contentRange: { from: markerTo, to: node.to },
    lineFrom: line.from,
    lineTo: line.to,
  };
}

function createBlockquoteMarkerRanges(line: LineSource): MarkdownMarkerRange[] {
  const match = /^(\s*)(>+)(\s?)/.exec(line.text);
  if (!match) return [];

  const ranges: MarkdownMarkerRange[] = [];
  const quoteFrom = line.from + match[1].length;
  const quotes = match[2];
  const trailingSpaceLength = match[3].length;
  for (let index = 0; index < quotes.length; index += 1) {
    const from = quoteFrom + index;
    const to = from + 1 + (index === quotes.length - 1 ? trailingSpaceLength : 0);
    ranges.push({ from, to });
  }
  return ranges;
}

function createMarkedInlineElement(
  kind: "emphasis" | "inlineCode" | "strong",
  node: SyntaxNode,
  markerNames: string | readonly string[],
): MarkdownPlainElement<"emphasis" | "inlineCode" | "strong"> {
  const markerRanges = directChildRanges(node, markerNames);
  const contentFrom = markerRanges[0]?.to ?? node.from;
  const contentTo = markerRanges[markerRanges.length - 1]?.from ?? node.to;
  return {
    kind,
    from: node.from,
    to: node.to,
    markerRanges,
    contentRange: contentFrom <= contentTo ? { from: contentFrom, to: contentTo } : undefined,
  };
}

function createLinkElement(node: SyntaxNode): MarkdownElement {
  const markerRanges = directChildRanges(node, "LinkMark");
  const labelFrom = markerRanges[0]?.to ?? node.from;
  const labelTo = markerRanges[1]?.from ?? labelFrom;
  return {
    kind: "link",
    from: node.from,
    to: node.to,
    markerRanges,
    contentRange: { from: labelFrom, to: labelTo },
  };
}

function createAutolinkElement(node: SyntaxNode): MarkdownElement {
  const markerRanges = directChildRanges(node, "LinkMark");
  const contentFrom = markerRanges[0]?.to ?? node.from;
  const contentTo = markerRanges[1]?.from ?? node.to;
  return {
    kind: "link",
    from: node.from,
    to: node.to,
    markerRanges,
    contentRange: { from: contentFrom, to: contentTo },
  };
}

function createEscapeElement(node: SyntaxNode): MarkdownElement {
  return {
    kind: "escape",
    from: node.from,
    to: node.to,
    markerRanges: [{ from: node.from, to: Math.min(node.from + 1, node.to) }],
    contentRange: { from: Math.min(node.from + 1, node.to), to: node.to },
  };
}

function addExtendedLineElements(
  state: EditorState,
  elements: MarkdownElement[],
  fromLineNumber: number,
  toLineNumber: number,
  composition: MarkdownFeatureComposition | null,
) {
  for (let lineNumber = fromLineNumber; lineNumber <= toLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    const blockMatch = composition?.collectBlockElement(state, line) ?? null;
    if (blockMatch) {
      elements.push(blockMatch.element);
      lineNumber = blockMatch.nextLineNumber - 1;
      continue;
    }

    const taskLine = getMarkdownTaskLine(line);
    if (taskLine) {
      elements.push({
        kind: "task",
        from: taskLine.from,
        to: taskLine.to,
        markerRanges: [
          { from: taskLine.prefixFrom, to: taskLine.checkboxFrom },
          { from: taskLine.checkboxFrom, to: taskLine.prefixTo },
        ],
        contentRange: { from: taskLine.contentFrom, to: taskLine.contentTo },
        lineFrom: line.from,
        lineTo: line.to,
        blockData: { kind: "task", checked: taskLine.checked },
      });
    }

    for (const token of findWikiLinkTokens(line.text)) {
      // `![[...]]` is an embed envelope, not a wiki-link label. A recognized
      // image/video feature owns the complete range; an unsupported or
      // context-invalid embed stays exact visible source instead of becoming
      // a misleading literal `!` followed by a collapsed link.
      if (
        token.from > 0
        && line.text[token.from - 1] === "!"
        && !isEscapedInlineToken(line.text, token.from - 1)
      ) continue;
      const from = line.from + token.from;
      const to = line.from + token.to;
      const visibleFrom = line.from + (token.aliasFrom ?? token.targetFrom);
      const visibleTo = line.from + (token.aliasTo ?? token.targetTo);
      elements.push({
        kind: "wikiLink",
        from,
        to,
        markerRanges: [
          { from, to: visibleFrom },
          { from: visibleTo, to },
        ],
        contentRange: { from: visibleFrom, to: visibleTo },
      });
    }

    if (composition) elements.push(...composition.collectLineElements(line));

    addStrikeElements(line, elements);
  }
}

function addStrikeElements(line: LineSource, elements: MarkdownElement[]) {
  for (const match of line.text.matchAll(/(~~)(\S(?:.*?\S)?)(~~)/g)) {
    if (match.index == null || !match[2]?.trim()) continue;
    const from = line.from + match.index;
    const openingTo = from + match[1].length;
    const closingFrom = openingTo + match[2].length;
    const to = closingFrom + match[3].length;
    elements.push({
      kind: "strike",
      from,
      to,
      markerRanges: [
        { from, to: openingTo },
        { from: closingFrom, to },
      ],
      contentRange: { from: openingTo, to: closingFrom },
    });
  }
}

function directChildRanges(node: SyntaxNode, markerNames: string | readonly string[]): MarkdownMarkerRange[] {
  const names = new Set(Array.isArray(markerNames) ? markerNames : [markerNames]);
  const ranges: MarkdownMarkerRange[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (names.has(child.name)) ranges.push({ from: child.from, to: child.to });
  }
  return ranges;
}

function getLineSource(state: EditorState, pos: number): LineSource {
  const line = state.doc.lineAt(pos);
  return {
    from: line.from,
    to: line.to,
    number: line.number,
    text: line.text,
  };
}

function dedupeElements(elements: MarkdownElement[]): MarkdownElement[] {
  const seen = new Map<string, number>();
  const result: MarkdownElement[] = [];
  for (const element of elements) {
    if (
      element.kind === "link" &&
      result.some((candidate) => candidate.kind === "wikiLink" && element.from >= candidate.from && element.to <= candidate.to)
    ) {
      continue;
    }

    const key = `${element.kind}:${element.from}:${element.to}`;
    const existingIndex = seen.get(key);
    if (existingIndex != null) {
      // A semantic range has one owner. Feature payload refinement happens in
      // its collector, never as a second element merged here.
      continue;
    }
    seen.set(key, result.length);
    result.push(element);
  }
  return result;
}
