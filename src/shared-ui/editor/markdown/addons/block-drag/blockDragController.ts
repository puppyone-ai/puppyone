import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  buildMarkdownBlockMoveTransaction,
  isMarkdownBlockMoveNoop,
} from "../../core/commands/markdownBlockMove";
import { markdownLocalizationFacet } from "../../core/editor/markdownLocalization";
import {
  getMarkdownMovableBlockGroup,
  sameMarkdownMovableBlock,
  type MarkdownMovableBlockRef,
} from "../../core/syntax/markdownBlockBoundaries";
import {
  getEdgeScrollVelocity,
  pickDropBoundary,
  readBlockBottom,
  readBlockDragSurface,
  readBlockTop,
  readBoundaryHeight,
  readDropSpan,
  readHandlePoint,
  readHoveredBlock,
  readPreviewPoint,
  readSourceSpan,
  toOverlayY,
  type BlockDragPoint,
  type BlockDragSpan,
  type BlockDragSurface,
} from "./blockDragGeometry";
import { BlockDragOverlay } from "./blockDragOverlay";
import { createBlockPreview } from "./blockDragPreview";

const DRAG_THRESHOLD_PX = 4;
const MAX_AUTOSCROLL_FRAME_MS = 34;

type DragFrame = {
  readonly surface: BlockDragSurface;
  readonly dropSpan: BlockDragSpan;
  readonly previewOrigin: BlockDragPoint;
};

type Press = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly source: MarkdownMovableBlockRef;
  readonly startDocument: Text;
  readonly listeners: AbortController;
  /** Null after the parser advances; read again before the next hit test. */
  blocks: readonly MarkdownMovableBlockRef[] | null;
  sourceIndex: number;
  clientX: number;
  clientY: number;
  boundary: number | null;
  frame: DragFrame | null;
};

type LayoutReading =
  | Readonly<{ kind: "handle"; source: MarkdownMovableBlockRef; surface: BlockDragSurface; x: number; y: number }>
  | Readonly<{ kind: "drag"; surface: BlockDragSurface; dropSpan: BlockDragSpan }>;

/**
 * Owns the gesture: which block the pointer means, and what happens when.
 * Pointer events arrive aligned to frames, ahead of rendering, so reading the
 * height map and writing a transform directly from them cannot thrash layout.
 * `requestMeasure` is kept for the rare reads that need CodeMirror's DOM.
 */
export class BlockDragController {
  private readonly view: EditorView;
  private readonly overlay: BlockDragOverlay;
  private readonly listeners = new AbortController();
  private readonly layoutMeasure = {};
  private target: MarkdownMovableBlockRef | null = null;
  private pointerY: number | null = null;
  private press: Press | null = null;
  private autoscrollFrame: number | null = null;
  private autoscrollTime: number | null = null;
  private autoscrollCarry = 0;
  private disposed = false;

  constructor(view: EditorView) {
    this.view = view;
    this.overlay = new BlockDragOverlay(view);
    const { signal } = this.listeners;
    view.dom.addEventListener("pointermove", this.onEditorPointerMove, { passive: true, signal });
    view.dom.addEventListener("pointerleave", this.onEditorPointerLeave, { signal });
    view.dom.addEventListener("compositionstart", this.onCompositionStart, { signal });
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true, signal });
    this.overlay.handle.addEventListener("pointerdown", this.onHandlePointerDown, { signal });
    this.overlay.handle.addEventListener("mousedown", this.onHandleMouseDown, { signal });
  }

  update(update: ViewUpdate) {
    if (update.startState.facet(markdownLocalizationFacet) !== update.state.facet(markdownLocalizationFacet)) {
      this.overlay.relabel();
    }
    if (update.docChanged || update.state.readOnly || this.view.composing) {
      this.pointerY = null;
      this.cancelPress();
      this.setTarget(null);
      return;
    }
    if (this.press && syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.press.blocks = null;
    }
    if (update.geometryChanged || update.heightChanged) this.scheduleLayout();
  }

  destroy() {
    this.disposed = true;
    this.cancelPress();
    this.listeners.abort();
    this.overlay.destroy();
  }

  private readonly onEditorPointerMove = (event: PointerEvent) => {
    if (this.press || event.pointerType === "touch") return;
    // A pressed button means a text selection is being made, not a hover.
    if (event.buttons !== 0) {
      this.setTarget(null);
      return;
    }
    // The handle sits outside its block, so it must not retarget itself away.
    if (event.target instanceof Node && this.overlay.handle.contains(event.target)) return;
    this.pointerY = event.clientY;
    this.retarget();
  };

  private readonly onEditorPointerLeave = (event: PointerEvent) => {
    if (this.press) return;
    // Entering an embedded frame leaves this document but not the editor.
    const hit = this.view.dom.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    if (hit && this.view.dom.contains(hit)) {
      this.pointerY = event.clientY;
      this.retarget();
      return;
    }
    this.pointerY = null;
    this.setTarget(null);
  };

  private readonly onCompositionStart = () => {
    this.pointerY = null;
    this.cancelPress();
    this.setTarget(null);
  };

  private readonly onScroll = () => {
    if (this.press?.frame) this.updateDrop(this.press);
    else if (!this.press) this.retarget();
  };

  // Stops the press from taking focus. Editor focus decides whether Markdown
  // source is revealed, so moving it would shift the layout under the pointer.
  private readonly onHandleMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onHandlePointerDown = (event: PointerEvent) => {
    const { view } = this;
    if (event.button !== 0 || !this.target || view.state.readOnly || view.composing) return;
    const group = getMarkdownMovableBlockGroup(view.state, this.target);
    if (!group || group.blocks.length < 2) return;

    // Not preventDefault: cancelling pointerdown suppresses the mousedown that
    // onHandleMouseDown needs in order to keep focus where it is.
    event.stopPropagation();
    const press: Press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: this.target,
      startDocument: view.state.doc,
      listeners: new AbortController(),
      blocks: group.blocks,
      sourceIndex: group.sourceIndex,
      clientX: event.clientX,
      clientY: event.clientY,
      boundary: null,
      frame: null,
    };
    try {
      this.overlay.handle.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    this.press = press;
    const { signal } = press.listeners;
    const { handle } = this.overlay;
    const doc = view.dom.ownerDocument;
    handle.addEventListener("pointermove", this.onPressMove, { signal });
    handle.addEventListener("pointerup", this.onPressUp, { signal });
    handle.addEventListener("pointercancel", this.onPressLost, { signal });
    handle.addEventListener("lostpointercapture", this.onPressLost, { signal });
    doc.addEventListener("keydown", this.onPressKeyDown, { capture: true, signal });
    doc.defaultView?.addEventListener("blur", this.onPressLost, { signal });
  };

  private readonly onPressMove = (event: PointerEvent) => {
    const { press } = this;
    if (!press || event.pointerId !== press.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    press.clientX = event.clientX;
    press.clientY = event.clientY;
    if (!press.frame) {
      const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (distance <= DRAG_THRESHOLD_PX) return;
      this.startDrag(press);
    }
    const { previewOrigin } = press.frame!;
    this.overlay.moveGhost(
      previewOrigin.x + event.clientX - press.startX,
      previewOrigin.y + event.clientY - press.startY,
    );
    this.updateDrop(press);
    this.startAutoscroll();
  };

  private readonly onPressUp = (event: PointerEvent) => {
    const { press } = this;
    if (!press || event.pointerId !== press.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    press.clientY = event.clientY;
    if (press.frame) this.updateDrop(press);
    this.commitPress(press);
  };

  private readonly onPressLost = () => this.cancelPress();

  private readonly onPressKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelPress();
  };

  private retarget() {
    const { view, pointerY } = this;
    if (this.disposed || pointerY == null) return;
    if (view.state.readOnly || view.composing) this.setTarget(null);
    else this.setTarget(readHoveredBlock(view, pointerY));
  }

  private setTarget(next: MarkdownMovableBlockRef | null) {
    if (sameMarkdownMovableBlock(this.target, next)) return;
    this.target = next;
    if (next) this.scheduleLayout();
    else this.overlay.hideHandle();
  }

  private scheduleLayout() {
    if (this.disposed || (!this.target && !this.press?.frame)) return;
    this.view.requestMeasure<LayoutReading | null>({
      key: this.layoutMeasure,
      read: (view) => this.readLayout(view),
      write: (reading) => this.writeLayout(reading),
    });
  }

  private readLayout(view: EditorView): LayoutReading | null {
    const surface = readBlockDragSurface(view, this.overlay.root);
    const { press, target } = this;
    if (press?.frame) {
      return { kind: "drag", surface, dropSpan: readDropSpan(view, surface, press.source) };
    }
    if (!target) return null;
    return { kind: "handle", source: target, surface, ...readHandlePoint(view, surface, target) };
  }

  private writeLayout(reading: LayoutReading | null) {
    if (reading?.kind === "handle") {
      if (!this.press && sameMarkdownMovableBlock(reading.source, this.target)) {
        this.overlay.showHandle(reading, reading.source);
      }
      return;
    }
    const { press } = this;
    if (reading?.kind !== "drag" || !press?.frame) return;
    press.frame = { ...press.frame, surface: reading.surface, dropSpan: reading.dropSpan };
    this.renderDrag(press);
  }

  private startDrag(press: Press) {
    const { view, overlay } = this;
    const surface = readBlockDragSurface(view, overlay.root);
    press.frame = {
      surface,
      dropSpan: readDropSpan(view, surface, press.source),
      previewOrigin: readPreviewPoint(view, surface, press.source),
    };
    // Read before the first write of the drag, so the copy costs no extra layout.
    const preview = createBlockPreview(view, press.source);
    overlay.beginDrag(preview, surface.railRight - surface.railLeft);
    this.renderDrag(press);
  }

  private readBlocks(press: Press): readonly MarkdownMovableBlockRef[] | null {
    if (press.blocks) return press.blocks;
    const group = getMarkdownMovableBlockGroup(this.view.state, press.source);
    if (!group) return null;
    press.blocks = group.blocks;
    press.sourceIndex = group.sourceIndex;
    return press.blocks;
  }

  private updateDrop(press: Press) {
    const { view } = this;
    const blocks = this.readBlocks(press);
    if (!blocks) {
      this.cancelPress();
      return;
    }
    const boundary = pickDropBoundary(
      blocks.length,
      press.clientY - view.documentTop,
      (index) => readBlockTop(view, blocks[index]),
      (index) => readBlockBottom(view, blocks[index]),
    );
    if (boundary === press.boundary) return;
    press.boundary = boundary;
    this.renderDrag(press);
  }

  private renderDrag(press: Press) {
    const { view, overlay } = this;
    const { frame } = press;
    const blocks = this.readBlocks(press);
    if (!frame || !blocks) return;
    const top = toOverlayY(frame.surface, readBlockTop(view, press.source));
    const bottom = toOverlayY(frame.surface, readBlockBottom(view, press.source));
    overlay.showSource(readSourceSpan(frame.surface), top, bottom - top);
    if (press.boundary == null || isMarkdownBlockMoveNoop(press.sourceIndex, press.boundary)) {
      overlay.hideDrop();
      return;
    }
    const height = readBoundaryHeight(view, blocks, press.boundary);
    overlay.showDrop(frame.dropSpan, toOverlayY(frame.surface, height));
  }

  private commitPress(press: Press) {
    const { view } = this;
    const boundary = press.frame ? press.boundary : null;
    const unchanged = view.state.doc === press.startDocument;
    this.clearPress(press);
    if (boundary == null || !unchanged || view.state.readOnly || view.composing) return;
    const spec = buildMarkdownBlockMoveTransaction(view.state, press.source, boundary);
    if (spec) view.dispatch(spec);
  }

  private cancelPress() {
    if (this.press) this.clearPress(this.press);
  }

  private clearPress(press: Press) {
    this.press = null;
    press.listeners.abort();
    this.stopAutoscroll();
    this.overlay.endDrag();
    const { handle } = this.overlay;
    if (handle.hasPointerCapture(press.pointerId)) {
      try {
        handle.releasePointerCapture(press.pointerId);
      } catch {
        // The platform may already have released the capture.
      }
    }
    this.scheduleLayout();
  }

  private startAutoscroll() {
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win || this.autoscrollFrame != null) return;
    this.autoscrollFrame = win.requestAnimationFrame(this.stepAutoscroll);
  }

  private readonly stepAutoscroll = (time: number) => {
    this.autoscrollFrame = null;
    const { press, view } = this;
    if (!press?.frame) return;
    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const velocity = getEdgeScrollVelocity(press.clientY, rect.top, rect.bottom);
    if (velocity === 0) {
      this.autoscrollTime = null;
      this.autoscrollCarry = 0;
      return;
    }
    const elapsed = Math.min(time - (this.autoscrollTime ?? time), MAX_AUTOSCROLL_FRAME_MS);
    this.autoscrollTime = time;
    // scrollTop truncates sub-pixel writes, so a slow scroll would never start.
    this.autoscrollCarry += (velocity * elapsed) / 1000;
    const whole = Math.trunc(this.autoscrollCarry);
    if (whole !== 0) {
      this.autoscrollCarry -= whole;
      scroller.scrollTop += whole;
    }
    this.startAutoscroll();
  };

  private stopAutoscroll() {
    if (this.autoscrollFrame != null) {
      this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.autoscrollFrame);
    }
    this.autoscrollFrame = null;
    this.autoscrollTime = null;
    this.autoscrollCarry = 0;
  }
}
