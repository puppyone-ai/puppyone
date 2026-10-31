import type { EditorView } from "@codemirror/view";
import { getMarkdownMessage } from "../../core/editor/markdownLocalization";
import type { MarkdownMovableBlockRef } from "../../core/syntax/markdownBlockBoundaries";
import {
  BLOCK_DRAG_HANDLE_SIZE_PX,
  type BlockDragPoint,
  type BlockDragSpan,
} from "./blockDragGeometry";

const VISIBLE_CLASS = "is-visible";
const GHOST_POINTER_OFFSET_PX = 14;

/**
 * Every DOM write the add-on makes. Positions use `transform` so they composite
 * without layout. Hidden parts are `display: none`, because a stale transform
 * on a visible box could otherwise extend the scroller's scrollable area.
 */
export class BlockDragOverlay {
  readonly root: HTMLDivElement;
  readonly handle: HTMLButtonElement;
  private readonly indicator: HTMLDivElement;
  private readonly source: HTMLDivElement;
  private readonly ghost: HTMLDivElement;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    const doc = view.dom.ownerDocument;
    this.root = doc.createElement("div");
    this.root.className = "cm-md-block-drag-layer";

    this.handle = doc.createElement("button");
    this.handle.className = "cm-md-block-drag-handle";
    this.handle.type = "button";
    // Pointer-only affordance. The shortcuts cover keyboard access.
    this.handle.tabIndex = -1;
    this.handle.dataset.tooltipPlacement = "left";
    this.relabel();
    const grip = doc.createElement("span");
    grip.className = "cm-md-block-drag-grip";
    grip.setAttribute("aria-hidden", "true");
    this.handle.append(grip);

    this.source = doc.createElement("div");
    this.source.className = "cm-md-block-drag-source";
    this.indicator = doc.createElement("div");
    this.indicator.className = "cm-md-block-drop-indicator";
    this.root.append(this.source, this.indicator, this.handle);

    // The preview tracks the viewport, so it sits outside the scrolling content.
    this.ghost = doc.createElement("div");
    this.ghost.className = "cm-md-block-drag-ghost";

    view.scrollDOM.append(this.root);
    view.dom.append(this.ghost);
  }

  relabel() {
    const label = getMarkdownMessage(this.view, "editor.markdown.blockDrag.handle");
    this.handle.setAttribute("aria-label", label);
    this.handle.dataset.tooltip = label;
  }

  showHandle(point: BlockDragPoint, block: MarkdownMovableBlockRef) {
    const offset = BLOCK_DRAG_HANDLE_SIZE_PX / 2;
    this.handle.dataset.blockKind = block.kind;
    this.handle.classList.toggle("is-nested", block.depth > 1);
    this.handle.style.transform = `translate3d(${point.x - offset}px, ${point.y - offset}px, 0)`;
    this.handle.classList.add(VISIBLE_CLASS);
  }

  hideHandle() {
    this.handle.classList.remove(VISIBLE_CLASS);
  }

  beginDrag(label: string) {
    this.ghost.textContent = label;
    this.ghost.classList.add(VISIBLE_CLASS);
    this.handle.classList.add("is-dragging");
    this.view.dom.classList.add("is-markdown-block-dragging");
  }

  moveGhost(x: number, y: number) {
    const left = x + GHOST_POINTER_OFFSET_PX;
    const top = y + GHOST_POINTER_OFFSET_PX;
    this.ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  showSource(span: BlockDragSpan, top: number, height: number) {
    this.source.style.transform = `translate3d(${span.left}px, ${top}px, 0)`;
    this.source.style.width = `${span.width}px`;
    this.source.style.height = `${height}px`;
    this.source.classList.add(VISIBLE_CLASS);
  }

  showDrop(span: BlockDragSpan, y: number) {
    this.indicator.style.transform = `translate3d(${span.left}px, ${y}px, 0)`;
    this.indicator.style.width = `${span.width}px`;
    this.indicator.classList.add(VISIBLE_CLASS);
  }

  hideDrop() {
    this.indicator.classList.remove(VISIBLE_CLASS);
  }

  endDrag() {
    this.hideDrop();
    this.source.classList.remove(VISIBLE_CLASS);
    this.ghost.classList.remove(VISIBLE_CLASS);
    this.handle.classList.remove("is-dragging");
    this.view.dom.classList.remove("is-markdown-block-dragging");
  }

  destroy() {
    this.endDrag();
    this.root.remove();
    this.ghost.remove();
  }
}
