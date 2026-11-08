import type { EditorView } from "@codemirror/view";
import type { DocumentDropPoint } from "../../../resource/DocumentDropTarget";
import { getMarkdownImageInsertBoundaries } from "../../core/syntax/markdownInsertBoundaries";

export type MarkdownImageDropAnchor = Readonly<{
  position: number;
  clientY: number;
  left: number;
  width: number;
}>;

/** Reading only: use semantic block ranges and CodeMirror's height map. Neither
 * the character column nor a widget's inner DOM may split a paragraph. */
export function resolveMarkdownImageDrop(view: EditorView, point: DocumentDropPoint): MarkdownImageDropAnchor | null {
  if (view.state.readOnly || view.composing) return null;
  const viewport = view.scrollDOM.getBoundingClientRect();
  if (point.x < viewport.left || point.x > viewport.right || point.y < viewport.top || point.y > viewport.bottom) return null;
  const boundaries = getMarkdownImageInsertBoundaries(view.state);
  if (!boundaries) return null;
  const { blocks, bodyFrom } = boundaries;
  const topOf = (index: number) => view.lineBlockAt(blocks[index].from).top;
  const bottomOf = (index: number) => view.lineBlockAt(blocks[index].to).bottom;
  const height = point.y - view.documentTop;
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (height < (topOf(middle) + bottomOf(middle)) / 2) high = middle;
    else low = middle + 1;
  }
  if (low === blocks.length && !boundaries.endAllowed) return null;
  if (low > 0 && !blocks[low - 1].afterAllowed) return null;
  const above = low > 0 ? bottomOf(low - 1) : null;
  const below = low < blocks.length ? topOf(low) : null;
  const emptyLine = view.lineBlockAt(view.state.doc.length);
  const boundaryHeight = above !== null && below !== null ? (above + below) / 2
    : above ?? below ?? (bodyFrom > 0 ? emptyLine.bottom : emptyLine.top);
  const clientY = view.documentTop + boundaryHeight;
  // A long paragraph can have both boundaries outside the viewport. Do not
  // draw a pretend line at the viewport edge or drop at the old text caret.
  if (clientY < viewport.top || clientY > viewport.bottom) return null;
  const content = view.contentDOM.getBoundingClientRect();
  const style = view.dom.ownerDocument.defaultView?.getComputedStyle(view.contentDOM);
  const left = Math.max(viewport.left, content.left + (Number.parseFloat(style?.paddingLeft ?? "") || 0) * view.scaleX);
  const right = Math.min(viewport.right, content.right - (Number.parseFloat(style?.paddingRight ?? "") || 0) * view.scaleX);
  return {
    position: low > 0 ? blocks[low - 1].to : blocks[0]?.from ?? view.state.doc.length,
    clientY,
    left,
    width: Math.max(0, right - left),
  };
}

/** Smaller panes have smaller edge zones, leaving a stationary central area. */
export function imageDropScrollVelocity(y: number, top: number, bottom: number): number {
  const zone = Math.min(48, (bottom - top) / 3);
  if (zone <= 0 || y < top || y > bottom) return 0;
  const depth = y < top + zone ? (y - top - zone) / zone : Math.max(0, (y - bottom + zone) / zone);
  return depth * 480;
}
