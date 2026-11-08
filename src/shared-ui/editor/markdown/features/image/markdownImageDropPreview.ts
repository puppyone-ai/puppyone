import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { DocumentDropPoint } from "../../../resource/DocumentDropTarget";
import { imageDropScrollVelocity, resolveMarkdownImageDrop, type MarkdownImageDropAnchor } from "./markdownImageDropGeometry";

export { resolveMarkdownImageDrop } from "./markdownImageDropGeometry";

/** The pane routes hover explicitly because its capture handler owns the HTML
 * drag. This view-owned layer never enters contentDOM, history or persistence. */
class MarkdownImageDropPreview {
  private readonly layer: HTMLDivElement;
  private readonly indicator: HTMLDivElement;
  private point: DocumentDropPoint | null = null;
  private painted: { anchor: MarkdownImageDropAnchor | null; doc: Text } | null = null;
  private disposed = false;
  private frame: number | null = null;
  private lastTime: number | null = null;
  private carry = 0;

  constructor(private readonly view: EditorView) {
    this.layer = view.dom.ownerDocument.createElement("div");
    this.layer.className = "cm-md-image-drop-layer";
    this.layer.setAttribute("aria-hidden", "true");
    this.indicator = view.dom.ownerDocument.createElement("div");
    this.indicator.className = "cm-md-image-drop-indicator";
    this.indicator.hidden = true;
    this.layer.append(this.indicator);
    view.dom.append(this.layer);
    view.scrollDOM.addEventListener("scroll", this.scheduleMeasure, { passive: true });
    view.dom.addEventListener("compositionstart", this.clear);
  }

  preview(point: DocumentDropPoint): boolean {
    if (this.disposed) return false;
    this.point = point;
    const anchor = resolveMarkdownImageDrop(this.view, point);
    this.paint(anchor);
    this.startScroll();
    return anchor !== null;
  }

  capture(point: DocumentDropPoint): MarkdownImageDropAnchor | null {
    // Once a hover was painted, that is the user's chosen boundary. A pending
    // measure (image decode, scroll, resize) must not silently pick another one.
    let anchor: MarkdownImageDropAnchor | null = null;
    if (!this.disposed) {
      if (!this.point) anchor = resolveMarkdownImageDrop(this.view, point);
      else if (this.painted?.doc === this.view.state.doc) anchor = this.painted.anchor;
    }
    this.clear();
    return anchor;
  }

  readonly clear = () => {
    this.point = null;
    this.painted = null;
    this.indicator.hidden = true;
    if (this.frame !== null) this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
    this.carry = 0;
  };

  update(update: ViewUpdate) {
    if (update.state.readOnly || this.view.composing) this.clear();
    else {
      if (update.docChanged) { this.painted = null; this.indicator.hidden = true; }
      if (update.docChanged || update.geometryChanged || update.viewportChanged
        || syntaxTree(update.state) !== syntaxTree(update.startState)) this.scheduleMeasure();
    }
  }

  destroy() {
    this.disposed = true;
    this.clear();
    this.view.scrollDOM.removeEventListener("scroll", this.scheduleMeasure);
    this.view.dom.removeEventListener("compositionstart", this.clear);
    this.layer.remove();
  }

  private readonly scheduleMeasure = () => {
    if (!this.point || this.disposed) return;
    const point = this.point;
    this.view.requestMeasure({
      key: this,
      read: () => ({ anchor: resolveMarkdownImageDrop(this.view, point), root: this.view.dom.getBoundingClientRect() }),
      write: ({ anchor, root }) => {
        if (this.point === point && !this.disposed) this.paint(anchor, root);
      },
    });
  };

  private paint(anchor: MarkdownImageDropAnchor | null, root = this.view.dom.getBoundingClientRect()) {
    this.painted = { anchor, doc: this.view.state.doc };
    this.indicator.hidden = anchor === null;
    if (!anchor) return;
    this.indicator.style.transform = `translate3d(${(anchor.left - root.left) / this.view.scaleX}px, ${(anchor.clientY - root.top) / this.view.scaleY}px, 0)`;
    this.indicator.style.width = `${anchor.width / this.view.scaleX}px`;
  }

  private startScroll() {
    if (this.frame !== null || !this.point) return;
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (imageDropScrollVelocity(this.point.y, rect.top, rect.bottom) === 0) {
      this.lastTime = null;
      this.carry = 0;
      return;
    }
    this.frame = this.view.dom.ownerDocument.defaultView?.requestAnimationFrame(this.scroll) ?? null;
  }

  private readonly scroll = (time: number) => {
    this.frame = null;
    if (!this.point || this.disposed) return;
    const scroller = this.view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const velocity = imageDropScrollVelocity(this.point.y, rect.top, rect.bottom);
    const elapsed = Math.min(34, time - (this.lastTime ?? time));
    this.lastTime = time;
    this.carry += velocity * elapsed / 1000;
    const whole = Math.trunc(this.carry);
    this.carry -= whole;
    if (whole !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop += whole;
      if (scroller.scrollTop === before) { this.lastTime = null; return; }
      this.scheduleMeasure();
    }
    this.startScroll();
  };
}

export const markdownImageDropPreview = ViewPlugin.fromClass(MarkdownImageDropPreview);
