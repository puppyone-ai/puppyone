import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import type { MarkdownTableFocusTarget } from "./tableModel";
import {
  clearMarkdownTableFocus,
  markdownTableFocusField,
  type MarkdownTableFocusRequest,
} from "./tableFocusState";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { revealMarkdownTableWindowRow } from "./tableWindowController";
import { revealMarkdownTableInlineColumn } from "./tableInlineViewportController";

const MAX_FOCUS_RESTORE_ATTEMPTS = 3;

/**
 * Restores table focus only after CodeMirror has committed its DOM update.
 * Widget construction is deliberately render-only and never dispatches.
 */
const markdownTableFocusCoordinator = ViewPlugin.fromClass(class {
  private cancelScheduled: (() => void) | null = null;
  private attempts = 0;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.scheduleIfNeeded();
  }

  update() {
    this.scheduleIfNeeded();
  }

  destroy() {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private scheduleIfNeeded() {
    if (this.cancelScheduled || !this.view.state.field(markdownTableFocusField, false)) return;
    const win = this.view.dom.ownerDocument.defaultView;
    if (win?.requestAnimationFrame) {
      const frame = win.requestAnimationFrame(() => this.restore());
      this.cancelScheduled = () => win.cancelAnimationFrame(frame);
      return;
    }
    const timeout = setTimeout(() => this.restore(), 0);
    this.cancelScheduled = () => clearTimeout(timeout);
  }

  private restore() {
    this.cancelScheduled = null;
    const pending = this.view.state.field(markdownTableFocusField, false);
    if (!pending) {
      this.attempts = 0;
      return;
    }

    const wrapper = findMarkdownTableWrapper(this.view, pending);
    if (wrapper && focusMarkdownTableCell(wrapper, pending)) {
      this.attempts = 0;
      this.view.dispatch({ effects: clearMarkdownTableFocus(pending.requestId) });
      getMarkdownEmbedHost(this.view).requestMeasure();
      return;
    }

    this.attempts += 1;
    if (this.attempts < MAX_FOCUS_RESTORE_ATTEMPTS) {
      this.scheduleIfNeeded();
      return;
    }

    // A focus request is ephemeral. If its replacement widget never mounts,
    // clear only that exact request so it cannot focus a stale table later.
    this.attempts = 0;
    this.view.dispatch({ effects: clearMarkdownTableFocus(pending.requestId) });
  }
});

export const markdownTableFocusExtension: Extension = [
  markdownTableFocusField,
  markdownTableFocusCoordinator,
];

export function focusMarkdownTableCell(wrapper: HTMLElement | null, target: MarkdownTableFocusTarget): boolean {
  const cell = wrapper?.querySelector<HTMLElement>(
    `.cm-md-table-cell-content[data-md-table-row="${target.rowIndex}"][data-md-table-column="${target.columnIndex}"]`,
  );
  if (!cell) {
    revealMarkdownTableWindowRow(wrapper, target.rowIndex);
    return false;
  }
  cell.focus({ preventScroll: true });
  placeCaretAtEnd(cell);
  revealMarkdownTableInlineColumn(wrapper, target.columnIndex);
  return true;
}

function findMarkdownTableWrapper(view: EditorView, pending: MarkdownTableFocusRequest): HTMLElement | null {
  for (const wrapper of view.dom.querySelectorAll<HTMLElement>(".cm-md-table-widget-wrap[data-md-table-from]")) {
    if (Number(wrapper.dataset.mdTableFrom) === pending.tableFrom) return wrapper;
  }
  return null;
}

function placeCaretAtEnd(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
