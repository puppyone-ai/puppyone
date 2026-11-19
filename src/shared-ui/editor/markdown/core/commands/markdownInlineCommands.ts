import { ChangeSet, EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  getInlineFormatCoverage,
  type MarkdownElement,
  type MarkdownInlineFormatKind,
  type MarkdownMarkerRange,
} from "../syntax/markdownElements";

export type MarkdownFormatCommand = "emphasis" | "strike" | "strong" | "underline";

type MarkdownFormatSpec = {
  kind: MarkdownInlineFormatKind;
  open: string;
  close: string;
};

const MARKDOWN_FORMAT_SPECS: Record<MarkdownFormatCommand, MarkdownFormatSpec> = {
  strong: { kind: "strong", open: "**", close: "**" },
  emphasis: { kind: "emphasis", open: "*", close: "*" },
  strike: { kind: "strike", open: "~~", close: "~~" },
  underline: { kind: "underline", open: "<u>", close: "</u>" },
};

const INLINE_CODE_SPEC: MarkdownFormatSpec = { kind: "inlineCode", open: "`", close: "`" };

export function isMarkdownFormatCommand(value: unknown): value is MarkdownFormatCommand {
  return value === "emphasis" || value === "strike" || value === "strong" || value === "underline";
}

export function applyMarkdownFormatCommand(view: EditorView, type: MarkdownFormatCommand): boolean {
  const spec = MARKDOWN_FORMAT_SPECS[type];
  return spec ? toggleMarkdownFormat(view, spec) : false;
}

export function toggleMarkdownInline(delimiter: "**" | "*" | "`" | "~~") {
  const spec = delimiter === "**"
    ? MARKDOWN_FORMAT_SPECS.strong
    : delimiter === "*"
      ? MARKDOWN_FORMAT_SPECS.emphasis
      : delimiter === "~~"
        ? MARKDOWN_FORMAT_SPECS.strike
        : INLINE_CODE_SPEC;
  return (view: EditorView): boolean => toggleMarkdownFormat(view, spec);
}

export function toggleMarkdownHtmlTag(tagName: "u") {
  return (view: EditorView): boolean => {
    if (tagName !== "u") return false;
    return applyMarkdownFormatCommand(view, "underline");
  };
}

export function wrapMarkdownLink(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  const range = selection.empty ? getWordRangeAt(state, selection.from) : { from: selection.from, to: selection.to };
  if (!range || range.from === range.to) return false;

  const selectedText = state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${selectedText}]()` },
    selection: EditorSelection.cursor(range.from + selectedText.length + 3),
  });
  return true;
}

function toggleMarkdownFormat(view: EditorView, spec: MarkdownFormatSpec): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  const coverage = getInlineFormatCoverage(state, selection.from, selection.to, spec.kind);
  if (coverage.formats.length > 0) {
    return unwrapMarkdownFormat(view, coverage.formats, selection.from, selection.to);
  }

  if (coverage.neighbors.length > 0) {
    unwrapMarkdownFormat(view, coverage.neighbors, selection.from, selection.to);
    return wrapMarkdownFormat(view, spec);
  }

  if (unwrapDelimitedRange(view, spec)) return true;
  return wrapMarkdownFormat(view, spec);
}

function unwrapDelimitedRange(view: EditorView, spec: MarkdownFormatSpec): boolean {
  if (unwrapWithDelimiters(view, spec)) return true;
  const htmlSpec = htmlFallbackSpec(spec);
  return htmlSpec ? unwrapWithDelimiters(view, htmlSpec) : false;
}

function htmlFallbackSpec(spec: MarkdownFormatSpec): MarkdownFormatSpec | null {
  if (spec.kind === "strong" && spec.open === "**") return { kind: "strong", open: "<strong>", close: "</strong>" };
  if (spec.kind === "emphasis" && spec.open === "*") return { kind: "emphasis", open: "<em>", close: "</em>" };
  return null;
}

function unwrapWithDelimiters(view: EditorView, spec: MarkdownFormatSpec): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const range = selection.empty
    ? (getWordRangeAt(state, selection.from) ?? { from: selection.from, to: selection.from })
    : { from: selection.from, to: selection.to };
  const selectedText = state.sliceDoc(range.from, range.to);
  const wrappedLength = spec.open.length + spec.close.length;
  if (
    selectedText.length >= wrappedLength
    && selectedText.startsWith(spec.open)
    && selectedText.endsWith(spec.close)
  ) {
    view.dispatch({
      changes: [
        { from: range.to - spec.close.length, to: range.to, insert: "" },
        { from: range.from, to: range.from + spec.open.length, insert: "" },
      ],
      selection: range.from + spec.open.length === range.to - spec.close.length
        ? EditorSelection.cursor(range.from)
        : EditorSelection.range(range.from, range.to - wrappedLength),
    });
    return true;
  }

  const beforeFrom = Math.max(0, range.from - spec.open.length);
  const afterTo = Math.min(state.doc.length, range.to + spec.close.length);
  const before = state.sliceDoc(beforeFrom, range.from);
  const after = state.sliceDoc(range.to, afterTo);
  if (before !== spec.open || after !== spec.close) return false;

  view.dispatch({
    changes: [
      { from: range.to, to: afterTo, insert: "" },
      { from: beforeFrom, to: range.from, insert: "" },
    ],
    selection: range.from === range.to
      ? EditorSelection.cursor(beforeFrom)
      : EditorSelection.range(beforeFrom, range.to - spec.open.length),
  });
  return true;
}

function unwrapMarkdownFormat(
  view: EditorView,
  elements: readonly MarkdownElement[],
  from: number,
  to: number,
): boolean {
  const markerRanges = collectUniqueMarkerRanges(elements);
  if (markerRanges.length === 0) return false;

  const changeSet = ChangeSet.of(
    markerRanges.map((range) => ({ from: range.from, to: range.to, insert: "" })),
    view.state.doc.length,
  );
  const mappedFrom = changeSet.mapPos(Math.min(from, to), 1);
  const mappedTo = changeSet.mapPos(Math.max(from, to), -1);
  view.dispatch({
    changes: changeSet,
    selection: mappedFrom >= mappedTo
      ? EditorSelection.cursor(mappedFrom)
      : EditorSelection.range(mappedFrom, mappedTo),
  });
  return true;
}

function wrapMarkdownFormat(view: EditorView, spec: MarkdownFormatSpec): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  const selectedRange = selection.empty
    ? (getWordRangeAt(state, selection.from) ?? { from: selection.from, to: selection.from })
    : { from: selection.from, to: selection.to };
  const range = (spec.kind === "strong" || spec.kind === "emphasis")
    ? (adjustWrapRangeForMarkdownEmphasis(state, selectedRange) ?? selectedRange)
    : selectedRange;

  view.dispatch({
    changes: [
      { from: range.to, insert: spec.close },
      { from: range.from, insert: spec.open },
    ],
    selection: range.from === range.to
      ? EditorSelection.cursor(range.from + spec.open.length)
      : EditorSelection.range(range.from + spec.open.length, range.to + spec.open.length),
  });
  return true;
}

function adjustWrapRangeForMarkdownEmphasis(
  state: EditorState,
  range: { from: number; to: number },
): { from: number; to: number } | null {
  if (range.from === range.to) return range;
  let { from, to } = range;
  while (from < to) {
    const prev = from === 0 ? "" : state.sliceDoc(from - 1, from);
    const first = state.sliceDoc(from, from + 1);
    if (isLeftFlankingDelimiter(prev, first)) break;
    from += 1;
  }
  while (from < to) {
    const last = state.sliceDoc(to - 1, to);
    const next = to === state.doc.length ? "" : state.sliceDoc(to, to + 1);
    if (isRightFlankingDelimiter(last, next)) break;
    to -= 1;
  }
  return from < to ? { from, to } : null;
}

function isLeftFlankingDelimiter(prev: string, next: string): boolean {
  if (!next || isMarkdownWhitespace(next)) return false;
  if (!isMarkdownPunctuation(next)) return true;
  return !prev || isMarkdownWhitespace(prev) || isMarkdownPunctuation(prev);
}

function isRightFlankingDelimiter(prev: string, next: string): boolean {
  if (!prev || isMarkdownWhitespace(prev)) return false;
  if (!isMarkdownPunctuation(prev)) return true;
  return !next || isMarkdownWhitespace(next) || isMarkdownPunctuation(next);
}

function isMarkdownWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isMarkdownPunctuation(char: string): boolean {
  return /[\p{P}\p{S}]/u.test(char);
}

function collectUniqueMarkerRanges(elements: readonly MarkdownElement[]): MarkdownMarkerRange[] {
  const seen = new Set<string>();
  const ranges: MarkdownMarkerRange[] = [];
  for (const element of elements) {
    const markers = element.markerRanges.length > 0
      ? element.markerRanges
      : contentFallbackMarkers(element);
    for (const range of markers) {
      if (range.to <= range.from) continue;
      const key = `${range.from}:${range.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(range);
    }
  }
  return ranges.sort((left, right) => right.from - left.from || right.to - left.to);
}

function contentFallbackMarkers(element: MarkdownElement): MarkdownMarkerRange[] {
  const content = element.contentRange;
  if (!content) return [{ from: element.from, to: element.to }];
  return [
    { from: element.from, to: content.from },
    { from: content.to, to: element.to },
  ];
}

function getWordRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const isWord = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_-]/u.test(char));
  let fromOffset = offset;
  let toOffset = offset;
  while (fromOffset > 0 && isWord(line.text[fromOffset - 1])) fromOffset -= 1;
  while (toOffset < line.text.length && isWord(line.text[toOffset])) toOffset += 1;
  if (fromOffset === toOffset) return null;
  return { from: line.from + fromOffset, to: line.from + toOffset };
}
