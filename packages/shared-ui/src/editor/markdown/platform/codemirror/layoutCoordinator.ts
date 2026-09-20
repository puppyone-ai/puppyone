import { EditorView, ViewPlugin } from "@codemirror/view";
import { createCodeMirrorViewportLayout, type CodeMirrorViewportLayout } from "../../../codemirror/viewportLayout";

export type MarkdownLayoutCoordinator = CodeMirrorViewportLayout;
const coordinators = new WeakMap<EditorView, MarkdownLayoutCoordinator>();
const VIEWPORT_PROPERTY = "--po-markdown-scroll-viewport-inline-size";

/** Markdown contributes presentation geometry to the shared engine adapter.
 * Source mode and Live Preview share the same view-local layout lifetime. */
export function createMarkdownLayoutCoordinator(view: EditorView): MarkdownLayoutCoordinator {
  let layout = coordinators.get(view);
  if (!layout) {
    layout = createCodeMirrorViewportLayout(view, width => {
      const value = `${width}px`;
      if (view.dom.style.getPropertyValue(VIEWPORT_PROPERTY) !== value) {
        view.dom.style.setProperty(VIEWPORT_PROPERTY, value);
      }
    });
    coordinators.set(view, layout);
  }
  return layout;
}

export const markdownViewportLayoutExtension = [ViewPlugin.define(view => {
  const layout = createMarkdownLayoutCoordinator(view);
  return {
    update: update => layout.update(update),
    destroy() {
      layout.dispose();
      coordinators.delete(view);
      view.dom.style.removeProperty(VIEWPORT_PROPERTY);
    },
  };
}), EditorView.scrollHandler.of(view => {
  createMarkdownLayoutCoordinator(view).navigation();
  return false;
})];

/** DOM-session facade that makes unregistration deterministic. */
export class MarkdownWidgetMeasureController {
  private stopObserving: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly coordinator: MarkdownLayoutCoordinator) {}

  get destroyed(): boolean {
    return this.disposed;
  }

  observe(element: HTMLElement) {
    this.stopObserving?.();
    this.stopObserving = this.coordinator.observe(element);
  }

  schedule() {
    if (!this.disposed) this.coordinator.request();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopObserving?.();
    this.stopObserving = null;
  }
}
