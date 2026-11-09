import { ChangeSet, EditorSelection, type EditorState } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { getInlineFormatCoverage, getMarkdownElementsInRange, type MarkdownElement } from "../../syntax/markdownElements";
import { canFormatInlineSelection, canFormatSelection } from "./selectionToolbarModel";

export const HIGHLIGHT_COLORS = {
  yellow: "#fff2a8", green: "#c9edc7", blue: "#cbe6ff", pink: "#ffd6e7", purple: "#e5d5ff",
} as const;
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;
function highlightColor(state: EditorState, format: MarkdownElement): string {
  if (format.kind === "highlight") return "default";
  const source = state.sliceDoc(format.from, format.contentRange?.from ?? format.to);
  return Object.entries(HIGHLIGHT_COLORS).find(([, hex]) => source.toLowerCase().includes(hex))?.[0] ?? "default";
}
export function selectionHighlightColor(state: EditorState): string | null {
  const { from, to } = state.selection.main;
  const coverage = getInlineFormatCoverage(state, from, to, "highlight");
  if (!coverage.neighbors.length) return null;
  const colors = new Set(coverage.neighbors.map(format => highlightColor(state, format)));
  if (colors.size !== 1) return "mixed";
  // Multiple marks separated only by hidden format markers are one visible color.
  const ranges = [
    ...coverage.neighbors.flatMap(format => format.contentRange ? [format.contentRange] : []),
    ...getMarkdownElementsInRange(state, from, to).flatMap(element => element.markerRanges),
  ].sort((a, b) => a.from - b.from);
  let cursor = from;
  for (const range of ranges) {
    if (range.to <= cursor) continue;
    if (range.from > cursor) return "mixed";
    cursor = range.to; if (cursor >= to) return [...colors][0];
  }
  return "mixed";
}

export function canHighlightSelection(state: EditorState): boolean {
  if (!canFormatSelection(state) || !canFormatInlineSelection(state)) return false;
  const { from, to } = state.selection.main;
  return !getMarkdownElementsInRange(state, from, to).some(element => {
    if (element.kind === "inlineCode" && (from > element.from || to < element.to)) return true;
    return element.markerRanges.some(marker => (from > marker.from && from < marker.to) || (to > marker.from && to < marker.to));
  });
}

/** Store portable inline HTML through the existing sanitized mark renderer. */
export function applySelectionHighlight(view: EditorView, color: HighlightColor | "none"): boolean {
  const { state } = view;
  if (!canHighlightSelection(state)) return false;
  if (color !== "none" && !Object.hasOwn(HIGHLIGHT_COLORS, color)) return false;
  const { from, to } = state.selection.main;
  const formats = getInlineFormatCoverage(state, from, to, "highlight").neighbors;
  const markers = new Map<string, { from: number; to: number; insert: string }>();
  for (const format of formats) for (const range of format.markerRanges) {
    markers.set(`${range.from}:${range.to}`, { ...range, insert: "" });
  }
  const removed = ChangeSet.of([...markers.values()], state.doc.length);
  const start = removed.mapPos(from, 1), end = removed.mapPos(to, -1);
  if (start >= end) return false;
  const inserts = new Map<number, string>();
  const append = (at: number, text: string) => inserts.set(at, (inserts.get(at) ?? "") + text);
  const otherFormats = getMarkdownElementsInRange(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to)
    .filter(element => element.kind !== "highlight" && !(element.kind === "inlineHtml" && element.inlineHtml.tagName === "mark"));
  // Split every generated mark at crossed format boundaries, including the
  // unchanged left/right fragments of an existing highlight.
  const wrapRange = (a: number, b: number, open: string, close: string): number => {
    const barriers = otherFormats.filter(element => {
      const left = removed.mapPos(element.from, 1), right = removed.mapPos(element.to, -1);
      return (left < a && right < b) || (left > a && right > b)
        || (left === a && right > b) || (left < a && right === b);
    }).flatMap(element => element.markerRanges)
      .map(range => ({ from: Math.max(a, removed.mapPos(range.from, 1)), to: Math.min(b, removed.mapPos(range.to, -1)) }))
      .filter(range => range.from < range.to).sort((x, y) => x.from - y.from);
    let cursor = a, firstLength = 0;
    const wrap = (left: number, right: number) => {
      if (left >= right) return;
      append(left, open); append(right, close);
      if (left === a) firstLength = open.length;
    };
    for (const barrier of barriers) { wrap(cursor, barrier.from); cursor = Math.max(cursor, barrier.to); }
    wrap(cursor, b); return firstLength;
  };
  // HTML remains valid beside whitespace; splitting == can create nested marks.
  for (const format of formats) {
    const content = format.contentRange;
    if (!content) continue;
    const open = format.kind === "highlight" ? "<mark>" : state.sliceDoc(format.from, content.from);
    const close = format.kind === "highlight" ? "</mark>" : state.sliceDoc(content.to, format.to);
    const a = removed.mapPos(content.from, 1), b = removed.mapPos(content.to, -1);
    if (a < start) wrapRange(a, start, open, close);
    if (b > end) wrapRange(end, b, open, close);
  }
  const before = inserts.get(start)?.length ?? 0;
  const after = inserts.get(end) ?? "";
  inserts.delete(end);
  const firstOpenLength = color === "none" ? 0 : wrapRange(start, end,
    `<mark style="background-color: ${HIGHLIGHT_COLORS[color]}; color: #202124">`, "</mark>");
  append(end, after);
  const wrapped = ChangeSet.of([...inserts].map(([at, insert]) => ({ from: at, insert })), removed.newLength);
  const selectionStart = wrapped.mapPos(start, -1) + before + firstOpenLength;
  const selectionEnd = wrapped.mapPos(end, -1);
  const selection = state.selection.main.anchor > state.selection.main.head
    ? EditorSelection.range(selectionEnd, selectionStart) : EditorSelection.range(selectionStart, selectionEnd);
  view.dispatch({ changes: removed.compose(wrapped), selection,
    annotations: isolateHistory.of("full"), userEvent: "input.markdown.highlight" });
  view.focus();
  return true;
}
