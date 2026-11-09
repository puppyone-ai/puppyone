import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdownLocalizationFacet } from "../../editor/markdownLocalization";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { canFormatSelection, placeSelectionToolbar, type ToolbarRect } from "./selectionToolbarModel";
import { createSelectionToolbarDom } from "./selectionToolbarDom";

/** Editor-owned controls; source, selection, persistence and undo stay in CodeMirror. */
export const markdownSelectionToolbar = ViewPlugin.fromClass(class {
  private readonly controls;
  private readonly removers: (() => void)[] = [];
  private readonly observer: ResizeObserver;
  private cachedState: EditorState | null = null;
  private cachedTree: ReturnType<typeof syntaxTree> | null = null;
  private eligible = false;
  private dragging = false;
  private dismissed = false;
  private composing = false;
  private inactive = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.controls = createSelectionToolbarDom(view);
    view.dom.append(this.controls.dom);
    const doc = view.dom.ownerDocument, win = doc.defaultView!;
    const listen = (target: EventTarget, event: string, callback: (event: Event) => void, capture = false) => {
      target.addEventListener(event, callback, capture);
      this.removers.push(() => target.removeEventListener(event, callback, capture));
    };
    listen(view.contentDOM, "pointerdown", event => {
      if ((event as PointerEvent).button !== 0) return;
      this.dragging = true; this.dismissed = false; this.refresh();
    });
    const released = () => { this.dragging = false; this.refresh(); };
    listen(doc, "pointerup", released); listen(doc, "pointercancel", released);
    listen(view.dom, "focusin", () => this.refresh());
    listen(view.dom, "focusout", () => queueMicrotask(() => this.refresh()));
    listen(view.contentDOM, "compositionstart", () => { this.composing = true; this.refresh(); });
    listen(view.contentDOM, "compositionend", () => { this.composing = false; this.refresh(); });
    listen(win, "blur", () => { this.inactive = true; this.refresh(); });
    listen(win, "focus", () => { this.inactive = false; this.refresh(); });
    listen(view.scrollDOM, "scroll", () => this.refresh());
    listen(win, "resize", () => this.refresh());
    listen(view.dom, "keydown", event => this.keydown(event as KeyboardEvent), true);
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(view.dom);
    this.refresh();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || !update.startState.selection.eq(update.state.selection)) this.dismissed = false;
    if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.transactions.length) this.refresh();
  }

  private keydown(event: KeyboardEvent) {
    if (this.controls.dom.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); this.dismissed = true;
      this.view.focus(); this.refresh();
    } else if (event.altKey && event.key === "F10") {
      event.preventDefault(); this.controls.dom.querySelector<HTMLElement>("select")?.focus();
    }
  }

  private refresh() {
    if (this.destroyed) return;
    const { view } = this, { dom } = this.controls;
    const state = view.state, tree = syntaxTree(state), previous = this.cachedState;
    const changed = !previous || previous.doc !== state.doc || !previous.selection.eq(state.selection)
      || previous.readOnly !== state.readOnly || tree !== this.cachedTree
      || previous.facet(markdownLocalizationFacet) !== state.facet(markdownLocalizationFacet);
    // Scroll/resize only measure geometry; they never rescan the selected text.
    if (changed) {
      this.cachedState = state; this.cachedTree = tree; this.eligible = canFormatSelection(state);
      if (this.eligible) this.controls.update();
    }
    const focused = view.hasFocus || dom.contains(view.dom.ownerDocument.activeElement);
    const show = focused && !this.inactive && !this.dragging && !this.dismissed && !this.composing && !view.composing && this.eligible;
    if (!show) { dom.hidden = true; return; }
    if (dom.hidden) dom.style.visibility = "hidden";
    dom.hidden = false;
    view.requestMeasure({ key: this,
      read: () => {
        const editor = view.dom.getBoundingClientRect();
        const win = view.dom.ownerDocument.defaultView!;
        const pane = { left: Math.max(0, editor.left), right: Math.min(win.innerWidth, editor.right),
          top: Math.max(0, editor.top), bottom: Math.min(win.innerHeight, editor.bottom) };
        const anchor = this.selectionAnchor(pane);
        const width = Math.min(dom.scrollWidth, Math.max(0, pane.right - pane.left - 12));
        const height = dom.offsetHeight;
        if (!anchor || pane.bottom - pane.top < height + 12 || width <= 0) return null;
        return { ...placeSelectionToolbar(anchor, pane, width, height), editor, width };
      },
      write: position => {
        if (this.destroyed || dom.hidden) return;
        if (!position) { dom.hidden = true; return; }
        dom.style.left = `${position.left - position.editor.left}px`;
        dom.style.top = `${position.top - position.editor.top}px`;
        dom.style.maxWidth = `${position.width}px`;
        dom.style.visibility = "visible";
      },
    });
  }

  private selectionAnchor(pane: ToolbarRect): ToolbarRect | null {
    const { view } = this;
    const selection = view.dom.ownerDocument.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed && selection.anchorNode && view.contentDOM.contains(selection.anchorNode)) {
      const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(rect => rect.width > 0
        && rect.bottom > pane.top && rect.top < pane.bottom && rect.right > pane.left && rect.left < pane.right);
      if (rects.length) {
        const first = rects[0];
        const row = rects.filter(rect => Math.abs(rect.top - first.top) < 3);
        return { left: Math.max(pane.left, Math.min(...row.map(rect => rect.left))), right: Math.min(pane.right, Math.max(...row.map(rect => rect.right))), top: first.top, bottom: first.bottom };
      }
    }
    const from = view.coordsAtPos(view.state.selection.main.from, 1);
    const to = view.coordsAtPos(view.state.selection.main.to, -1);
    if (!from || from.bottom <= pane.top || from.top >= pane.bottom) return null;
    return to && Math.abs(from.top - to.top) < 3 ? { ...from, right: to.right } : from;
  }

  destroy() {
    this.destroyed = true;
    for (const remove of this.removers) remove();
    this.observer.disconnect(); this.controls.dom.remove();
  }
});
