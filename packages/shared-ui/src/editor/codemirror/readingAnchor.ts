import { EditorSelection, type StateEffect } from "@codemirror/state";
import { BlockType, EditorView, type ViewUpdate } from "@codemirror/view";

/** A source position on the visible wrapped line, not a paragraph number or
 * scrollTop. CodeMirror owns the outer height map and applies our scroll effects. */
export type ReadingAnchor = Readonly<{
  position: number;
  offset: number;
  edge: "start" | "end" | null;
  snapshot: StateEffect<unknown> | null;
}>;

export function captureReadingAnchor(view: EditorView): ReadingAnchor | null {
  const scroll = view.scrollDOM;
  if (!view.inView || !scroll.clientHeight || !scroll.clientWidth) return null;
  const rect = scroll.getBoundingClientRect();
  // A replaced block has no character geometry inside its source range.
  // Its own row/content viewport owns reading continuity there; applying a
  // source-character target would scroll to the edge of the entire widget.
  const block = view.elementAtHeight(rect.top + scroll.clientTop + 1 - view.documentTop);
  if (block.type !== BlockType.Text) return null;
  const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.contentDOM);
  const rtl = style.direction === "rtl";
  const x = rtl
    ? rect.right - scroll.clientLeft - (parseFloat(style.paddingRight) || 0) - 1
    : rect.left + scroll.clientLeft + (parseFloat(style.paddingLeft) || 0) + 1;
  const position = view.posAtCoords({ x, y: rect.top + scroll.clientTop + 1 }, false);
  if (position === null) return null;
  const coords = view.coordsAtPos(position, 1);
  if (!coords) return null;
  const maxScroll = scroll.scrollHeight - scroll.clientHeight;
  return {
    position,
    offset: coords.top - rect.top - scroll.clientTop,
    edge: scroll.scrollTop <= 1 ? "start"
      : maxScroll > 1 && maxScroll - scroll.scrollTop <= 1 ? "end" : null,
    snapshot: scroll.scrollTop <= 1 ? view.scrollSnapshot() : null,
  };
}

export function mapReadingAnchor(anchor: ReadingAnchor | null, update: ViewUpdate): ReadingAnchor | null {
  if (!anchor || !update.docChanged) return anchor;
  // Deleting the anchor invalidates it. Unrelated edits map it exactly once.
  if (update.changes.touchesRange(anchor.position, anchor.position) === "cover") return null;
  return { ...anchor, position: update.changes.mapPos(anchor.position, 1),
    snapshot: anchor.snapshot?.map(update.changes) ?? null };
}

export function restoreReadingAnchor(view: EditorView, anchor: ReadingAnchor): void {
  if (anchor.edge === "start" && anchor.snapshot) {
    view.dispatch({ effects: anchor.snapshot });
    return;
  }
  const position = anchor.edge === "start" ? 0
    : anchor.edge === "end" ? view.state.doc.length : Math.min(anchor.position, view.state.doc.length);
  view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.cursor(position, 1), {
    y: anchor.edge === "end" ? "end" : "start",
    yMargin: anchor.edge === "start" ? view.documentPadding.top
      : anchor.edge === "end" ? Math.min(view.scrollDOM.clientHeight - 1, view.documentPadding.bottom + view.defaultLineHeight) : anchor.offset,
    x: "nearest",
  }) });
}
