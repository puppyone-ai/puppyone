import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getMarkdownTaskLine } from "../syntax/markdownListStructure";

export type MarkdownTaskCheckboxTarget = Readonly<{
  from: number;
  to: number;
}>;

const TASK_CHECKBOX_TOKEN = /^\[[ xX]\]$/;

/**
 * Resolves the task token from the current document at activation time.
 *
 * Incremental projections may map a widget through edits without rebuilding
 * its WidgetType. A render-time absolute range can therefore become stale
 * even though the widget is still mounted at the correct visual line.
 */
export function toggleMarkdownTaskCheckboxAt(
  view: EditorView,
  position: number,
): boolean {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.length));
  const task = getMarkdownTaskLine(view.state, safePosition);
  if (!task) return false;
  return toggleMarkdownTaskCheckbox(view, {
    from: task.checkboxFrom,
    to: task.checkboxTo,
  });
}

/**
 * Toggles a validated task marker against the current EditorState rather than
 * trusting the widget's render-time checked value.
 */
export function toggleMarkdownTaskCheckbox(
  view: EditorView,
  target: MarkdownTaskCheckboxTarget,
): boolean {
  if (view.state.readOnly) return false;
  if (target.from < 0 || target.to > view.state.doc.length || target.from >= target.to) return false;

  const currentToken = view.state.sliceDoc(target.from, target.to);
  if (!TASK_CHECKBOX_TOKEN.test(currentToken)) return false;

  const checked = currentToken[1]?.toLowerCase() === "x";
  view.dispatch({
    changes: {
      from: target.from,
      to: target.to,
      insert: checked ? "[ ]" : "[x]",
    },
    annotations: Transaction.userEvent.of("input.task.toggle"),
  });
  return true;
}
