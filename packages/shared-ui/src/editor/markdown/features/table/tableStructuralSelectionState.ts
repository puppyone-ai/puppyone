import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";

export type MarkdownTableStructuralSelectionAxis = "column" | "row";

export type MarkdownTableStructuralSelection = Readonly<{
  axis: MarkdownTableStructuralSelectionAxis;
  index: number;
  tableFrom: number;
}>;

type MarkdownTableStructuralSelectionAction =
  | { type: "select"; selection: MarkdownTableStructuralSelection }
  | { type: "clear" };

export const markdownTableStructuralSelectionEffect =
  StateEffect.define<MarkdownTableStructuralSelectionAction>();

export const markdownTableStructuralSelectionField =
  StateField.define<MarkdownTableStructuralSelection | null>({
    create() {
      return null;
    },
    update(value, transaction) {
      let next = value && transaction.docChanged
        ? { ...value, tableFrom: transaction.changes.mapPos(value.tableFrom, 1) }
        : value;
      for (const effect of transaction.effects) {
        if (!effect.is(markdownTableStructuralSelectionEffect)) continue;
        next = effect.value.type === "select" ? effect.value.selection : null;
      }
      return next;
    },
  });

export const MARKDOWN_TABLE_STRUCTURAL_SELECTION_EVENT =
  "po-markdown-table-structural-selection";

export function requestMarkdownTableStructuralSelection(
  tableFrom: number,
  axis: MarkdownTableStructuralSelectionAxis,
  index: number,
) {
  return markdownTableStructuralSelectionEffect.of({
    type: "select",
    selection: { axis, index, tableFrom },
  });
}

export function clearMarkdownTableStructuralSelection() {
  return markdownTableStructuralSelectionEffect.of({ type: "clear" });
}

/**
 * Structural selection is persistent editor state, while its outline belongs
 * to the current table widget DOM. Synchronize after CodeMirror commits each
 * widget replacement so selection follows a reordered row or column without
 * becoming cell-edit focus.
 */
const markdownTableStructuralSelectionCoordinator = ViewPlugin.fromClass(class {
  private cancelScheduled: (() => void) | null = null;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.schedule();
  }

  update() {
    this.schedule();
  }

  destroy() {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private schedule() {
    if (this.cancelScheduled) return;
    const win = this.view.dom.ownerDocument.defaultView;
    if (win?.requestAnimationFrame) {
      const frame = win.requestAnimationFrame(() => this.synchronize());
      this.cancelScheduled = () => win.cancelAnimationFrame(frame);
      return;
    }
    const timeout = setTimeout(() => this.synchronize(), 0);
    this.cancelScheduled = () => clearTimeout(timeout);
  }

  private synchronize() {
    this.cancelScheduled = null;
    const selected = this.view.state.field(markdownTableStructuralSelectionField, false);
    const EventConstructor = this.view.dom.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    for (const wrapper of this.view.dom.querySelectorAll<HTMLElement>(
      ".cm-md-table-widget-wrap[data-md-table-from]",
    )) {
      const detail = selected && Number(wrapper.dataset.mdTableFrom) === selected.tableFrom
        ? selected
        : null;
      wrapper.dispatchEvent(new EventConstructor(MARKDOWN_TABLE_STRUCTURAL_SELECTION_EVENT, {
        detail,
      }));
    }
  }
}, {
  eventHandlers: {
    keydown(event, view) {
      if (event.key !== "Escape" || !view.state.field(markdownTableStructuralSelectionField, false)) {
        return false;
      }
      view.dispatch({ effects: clearMarkdownTableStructuralSelection() });
      return true;
    },
  },
});

export const markdownTableStructuralSelectionExtension: Extension = [
  markdownTableStructuralSelectionField,
  markdownTableStructuralSelectionCoordinator,
];
