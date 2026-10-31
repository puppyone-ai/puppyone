import type { EditorState } from "@codemirror/state";
import { BlockType, Direction, type BlockInfo, type EditorView } from "@codemirror/view";
import {
  getMarkdownMovableBlockAt,
  type MarkdownMovableBlockRef,
} from "../../core/syntax/markdownBlockBoundaries";

export const BLOCK_DRAG_HANDLE_SIZE_PX = 22;
const HANDLE_GAP_PX = 8;
const EDGE_SCROLL_ZONE_PX = 48;
const MAX_EDGE_SCROLL_PX_PER_SECOND = 840;
const MAX_GAP_LINES = 8;
const MAX_LABEL_LENGTH = 80;

/** Where the overlay sits, measured once per layout and reused until it changes. */
export type BlockDragSurface = Readonly<{
  /** Screen distance from a document height of 0 to the overlay's origin. */
  documentOffset: number;
  railLeft: number;
  railRight: number;
  originLeft: number;
  originTop: number;
  scaleX: number;
  scaleY: number;
}>;

export type BlockDragPoint = Readonly<{ x: number; y: number }>;
export type BlockDragSpan = Readonly<{ left: number; width: number }>;

export function readBlockDragSurface(view: EditorView, overlay: HTMLElement): BlockDragSurface {
  const origin = overlay.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const style = view.dom.ownerDocument.defaultView?.getComputedStyle(view.contentDOM);
  const { scaleX, scaleY } = view;
  return {
    documentOffset: view.documentTop - origin.top,
    railLeft: (content.left - origin.left) / scaleX + (Number.parseFloat(style?.paddingLeft ?? "") || 0),
    railRight: (content.right - origin.left) / scaleX - (Number.parseFloat(style?.paddingRight ?? "") || 0),
    originLeft: origin.left,
    originTop: origin.top,
    scaleX,
    scaleY,
  };
}

export function toOverlayY(surface: BlockDragSurface, documentHeight: number): number {
  return (documentHeight + surface.documentOffset) / surface.scaleY;
}

/**
 * The block for a pointer row. Reading the height map needs no DOM hit test, so
 * text, blank space, widgets, and controls inside widgets all answer alike. A
 * gap between blocks goes to the nearer neighbor, so crossing it cannot flicker.
 */
export function readHoveredBlock(view: EditorView, clientY: number): MarkdownMovableBlockRef | null {
  const height = clientY - view.documentTop;
  const line = view.lineBlockAtHeight(height);
  const inside = getMarkdownMovableBlockAt(view.state, line.from);
  if (inside || !isBlankLine(view, line)) return inside;
  const above = findFilledLine(view, line, -1);
  const below = findFilledLine(view, line, 1);
  const distanceAbove = above ? height - above.bottom : Infinity;
  const distanceBelow = below ? below.top - height : Infinity;
  const nearest = distanceAbove <= distanceBelow ? above : below;
  return nearest ? getMarkdownMovableBlockAt(view.state, nearest.from) : null;
}

function isBlankLine(view: EditorView, line: BlockInfo): boolean {
  return view.state.doc.lineAt(line.from).text.trim().length === 0;
}

function findFilledLine(view: EditorView, start: BlockInfo, direction: -1 | 1): BlockInfo | null {
  let line = start;
  for (let step = 0; step < MAX_GAP_LINES; step += 1) {
    const position = direction < 0 ? line.from - 1 : line.to + 1;
    if (position < 0 || position > view.state.doc.length) return null;
    line = view.lineBlockAt(position);
    if (!isBlankLine(view, line)) return line;
  }
  return null;
}

export function readHandlePoint(
  view: EditorView,
  surface: BlockDragSurface,
  source: MarkdownMovableBlockRef,
): BlockDragPoint {
  const block = view.lineBlockAt(source.from);
  const anchor = view.coordsAtPos(source.from, 1);
  const rtl = view.textDirection === Direction.RTL;
  const inset = HANDLE_GAP_PX + BLOCK_DRAG_HANDLE_SIZE_PX / 2;
  // A top-level list shares the rail with paragraphs, so the handle holds still
  // moving between them. Only deeper items step in beside their own marker.
  const edge = source.depth > 1 && anchor ? toOverlayX(surface, anchor.left) : readRailStart(surface, rtl);
  // A widget reports its whole box here, so align to its first row instead.
  const y = block.type === BlockType.Text && anchor
    ? ((anchor.top + anchor.bottom) / 2 - surface.originTop) / surface.scaleY
    : toOverlayY(surface, block.top + Math.min(block.height / 2, view.defaultLineHeight));
  return {
    x: rtl ? edge + inset : Math.max(BLOCK_DRAG_HANDLE_SIZE_PX / 2, edge - inset),
    y,
  };
}

/** A drop line starts where its siblings do and is constant for the whole drag. */
export function readDropSpan(
  view: EditorView,
  surface: BlockDragSurface,
  source: MarkdownMovableBlockRef,
): BlockDragSpan {
  const rtl = view.textDirection === Direction.RTL;
  const anchor = source.kind === "list-item" ? view.coordsAtPos(source.from, 1) : null;
  const edge = anchor ? toOverlayX(surface, anchor.left) : readRailStart(surface, rtl);
  const left = rtl ? surface.railLeft : edge;
  const right = rtl ? edge : surface.railRight;
  return { left, width: Math.max(0, right - left) };
}

export function readSourceSpan(surface: BlockDragSurface): BlockDragSpan {
  return { left: surface.railLeft, width: surface.railRight - surface.railLeft };
}

function readRailStart(surface: BlockDragSurface, rtl: boolean): number {
  return rtl ? surface.railRight : surface.railLeft;
}

function toOverlayX(surface: BlockDragSurface, clientX: number): number {
  return (clientX - surface.originLeft) / surface.scaleX;
}

export function readBlockTop(view: EditorView, block: MarkdownMovableBlockRef): number {
  return view.lineBlockAt(block.from).top;
}

export function readBlockBottom(view: EditorView, block: MarkdownMovableBlockRef): number {
  return view.lineBlockAt(block.to).bottom;
}

/** Document height of the gap a drop boundary names, midway between its blocks. */
export function readBoundaryHeight(
  view: EditorView,
  blocks: readonly MarkdownMovableBlockRef[],
  boundary: number,
): number {
  const above = boundary > 0 ? readBlockBottom(view, blocks[boundary - 1]) : null;
  const below = boundary < blocks.length ? readBlockTop(view, blocks[boundary]) : null;
  if (above != null && below != null) return (above + below) / 2;
  return above ?? below ?? 0;
}

/** Sibling midpoints ascend, so the height map is searched, never walked. */
export function pickDropBoundary(
  count: number,
  height: number,
  topOf: (index: number) => number,
  bottomOf: (index: number) => number,
): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (height < (topOf(middle) + bottomOf(middle)) / 2) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Speed in px/s, so autoscroll feels the same at any display refresh rate. */
export function getEdgeScrollVelocity(clientY: number, top: number, bottom: number): number {
  const intoTop = top + EDGE_SCROLL_ZONE_PX - clientY;
  const intoBottom = clientY - (bottom - EDGE_SCROLL_ZONE_PX);
  const depth = intoTop > 0 ? -intoTop : Math.max(0, intoBottom);
  return Math.max(-1, Math.min(1, depth / EDGE_SCROLL_ZONE_PX)) * MAX_EDGE_SCROLL_PX_PER_SECOND;
}

/** A plain excerpt for the drag preview. Live block DOM is never cloned. */
export function getBlockDragLabel(state: EditorState, block: MarkdownMovableBlockRef): string {
  const lines = state.sliceDoc(block.from, block.to).split("\n", 8);
  for (const line of lines) {
    const text = line
      .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "")
      .trim();
    if (text && !/^(?:`{3,}|~{3,})/.test(text)) return text.slice(0, MAX_LABEL_LENGTH);
  }
  return lines[0].trim().slice(0, MAX_LABEL_LENGTH);
}
