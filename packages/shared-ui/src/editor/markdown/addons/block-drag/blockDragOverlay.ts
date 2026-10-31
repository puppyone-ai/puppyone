import type { EditorView } from "@codemirror/view";
import { getMarkdownMessage } from "../../core/editor/markdownLocalization";
import type { MarkdownMovableBlockRef } from "../../core/syntax/markdownBlockBoundaries";
import {
  BLOCK_DRAG_HANDLE_HEIGHT_PX,
  BLOCK_DRAG_HANDLE_WIDTH_PX,
  type BlockDragPoint,
  type BlockDragSpan,
} from "./blockDragGeometry";

const VISIBLE_CLASS = "is-visible";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

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
    this.handle.append(createGrip(doc));

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
    const left = point.x - BLOCK_DRAG_HANDLE_WIDTH_PX / 2;
    const top = point.y - BLOCK_DRAG_HANDLE_HEIGHT_PX / 2;
    this.handle.dataset.blockKind = block.kind;
    this.handle.classList.toggle("is-nested", block.depth > 1);
    this.handle.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    this.handle.classList.add(VISIBLE_CLASS);
  }

  hideHandle() {
    this.handle.classList.remove(VISIBLE_CLASS);
  }

  beginDrag(preview: HTMLElement, width: number) {
    this.ghost.replaceChildren(preview);
    this.ghost.style.width = `${width}px`;
    this.ghost.classList.add(VISIBLE_CLASS);
    this.handle.classList.add("is-dragging");
    this.view.dom.classList.add("is-markdown-block-dragging");
  }

  moveGhost(x: number, y: number) {
    this.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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
    this.ghost.replaceChildren();
    this.handle.classList.remove("is-dragging");
    this.view.dom.classList.remove("is-markdown-block-dragging");
  }

  destroy() {
    this.endDrag();
    this.root.remove();
    this.ghost.remove();
  }
}

function createGrip(doc: Document): SVGSVGElement {
  const grip = doc.createElementNS(SVG_NAMESPACE, "svg");
  grip.setAttribute("class", "cm-md-block-drag-grip");
  grip.setAttribute("viewBox", "0 0 10 16");
  grip.setAttribute("aria-hidden", "true");
  for (const x of [2, 8]) {
    for (const y of [2, 8, 14]) {
      const dot = doc.createElementNS(SVG_NAMESPACE, "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "1.5");
      grip.append(dot);
    }
  }
  return grip;
}
