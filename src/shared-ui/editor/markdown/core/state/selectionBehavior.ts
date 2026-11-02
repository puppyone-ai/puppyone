import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, type MouseSelectionStyle } from "@codemirror/view";
import { getHiddenBlockMarkerCaretNormalization } from "../syntax/markdownElements";
import { markdownComposingBlockLineField } from "./composingBlockLine";

/**
 * Keeps the caret on the visible side of hidden block markers so there is a
 * single caret position per visual position ("honest caret").
 */
export const markdownHiddenMarkerSelectionNormalizer = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.selection && !transaction.docChanged) return transaction;

  let changed = false;
  const ranges = transaction.state.selection.ranges.map((range) => {
    if (!range.empty) return range;

    const line = transaction.state.doc.lineAt(range.from);
    const composingLine = transaction.state.field(markdownComposingBlockLineField, false);
    if (composingLine?.from === line.from) return range;

    const normalized = getHiddenBlockMarkerCaretNormalization(transaction.state, range.from);
    if (normalized == null || normalized === range.from) return range;

    changed = true;
    return EditorSelection.cursor(normalized);
  });

  if (!changed) return transaction;

  return [
    transaction,
    {
      selection: EditorSelection.create(ranges, transaction.state.selection.mainIndex),
      sequential: true,
    },
  ];
});

const TRAILING_LINE_WHITESPACE_SELECTION_GAP = 3;

export const trailingLineWhitespaceSelectionExtension = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
    return null;
  }

  const start = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
  const startEdge = getTrailingLineSelectionEdge(view, start.pos);
  if (
    !startEdge ||
    event.clientY < startEdge.top ||
    event.clientY > startEdge.bottom ||
    event.clientX <= startEdge.x + TRAILING_LINE_WHITESPACE_SELECTION_GAP
  ) {
    return null;
  }

  let anchor = startEdge.pos;
  return {
    get(curEvent) {
      const currentEdge = getTrailingLineSelectionEdge(view, anchor) ?? startEdge;
      if (
        curEvent.clientY >= currentEdge.top &&
        curEvent.clientY <= currentEdge.bottom &&
        curEvent.clientX > currentEdge.x + TRAILING_LINE_WHITESPACE_SELECTION_GAP
      ) {
        return EditorSelection.create([EditorSelection.cursor(anchor, -1)]);
      }

      const head = view.posAndSideAtCoords({ x: curEvent.clientX, y: curEvent.clientY }, false);
      return EditorSelection.create([EditorSelection.range(anchor, head.pos, undefined, undefined, head.assoc)]);
    },
    update(update) {
      if (!update.docChanged) return false;
      anchor = update.changes.mapPos(anchor);
      return true;
    },
  } satisfies MouseSelectionStyle;
});

function getTrailingLineSelectionEdge(
  view: EditorView,
  pos: number,
): { pos: number; x: number; top: number; bottom: number } | null {
  const line = view.state.doc.lineAt(pos);
  if (line.from === line.to) return null;

  const edgeRect = view.coordsAtPos(line.to, -1);
  if (!edgeRect) return null;

  return {
    pos: line.to,
    x: Math.max(edgeRect.left, edgeRect.right),
    top: edgeRect.top,
    bottom: edgeRect.bottom,
  };
}
