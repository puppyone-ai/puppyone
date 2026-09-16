import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { markdownLivePreviewDecorations } from "../decorations/livePreviewDecorations";

/**
 * Replaced widgets are atomic: the browser's native selection can paint text
 * runs but never the interior of a replaced block, so a selection that sweeps
 * across a table (or code/diagram/HTML block) gives no visual feedback on the
 * widget itself. This plugin supplies the block-editor convention instead:
 * when the document selection fully covers a widget's source range, the whole
 * widget gets an `is-doc-selected` accent state.
 */
const SELECTABLE_WIDGET_SELECTOR = [
  ".cm-md-table-widget-wrap",
  ".cm-md-code-widget",
  ".cm-md-mermaid-widget",
  ".cm-md-html-widget",
  ".cm-md-image-widget",
  ".cm-md-math-block-widget",
].join(", ");

const SELECTED_CLASS = "is-doc-selected";

export const markdownBlockWidgetSelectionExtension = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.scheduleRefresh();
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged || update.viewportChanged || update.focusChanged) {
        this.scheduleRefresh();
      }
    }

    private scheduleRefresh() {
      this.view.requestMeasure({
        read: () => null,
        write: () => this.refresh(),
      });
    }

    private refresh() {
      const { view } = this;
      const selection = view.state.selection.main;
      const decorations = view.state.field(markdownLivePreviewDecorations, false)?.decorations;
      // Keep the block accent while the editor owns a covering selection.
      // Cell editing clears that selection (see tableCellEditor), so a focused
      // contenteditable inside the widget never competes with is-doc-selected.
      const active = !selection.empty && (view.hasFocus || isFocusInsideSelectableWidget(view))
        ? selection
        : null;

      for (const element of view.contentDOM.querySelectorAll(SELECTABLE_WIDGET_SELECTOR)) {
        element.classList.toggle(SELECTED_CLASS, isWidgetCovered(view, element, active, decorations));
      }
    }
  },
);

function isFocusInsideSelectableWidget(view: EditorView): boolean {
  const active = view.contentDOM.ownerDocument.activeElement;
  return active instanceof Element && Boolean(active.closest(SELECTABLE_WIDGET_SELECTOR));
}

function isWidgetCovered(
  view: EditorView,
  element: Element,
  selection: { from: number; to: number } | null,
  decorations: DecorationSet | undefined,
): boolean {
  if (!selection || !decorations) return false;

  let covered = false;
  try {
    const widgetFrom = view.posAtDOM(element, 0);
    decorations.between(widgetFrom, widgetFrom, (from, to, decoration) => {
      if (from !== widgetFrom || !decoration.spec?.widget) return;
      if (selection.from <= from && selection.to >= to) covered = true;
      return false;
    });
  } catch {
    // posAtDOM throws for orphaned nodes mid-update; treat as not covered.
    return false;
  }
  return covered;
}
