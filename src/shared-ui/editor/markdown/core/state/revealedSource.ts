import { StateEffect, StateField } from "@codemirror/state";
import { markdownPointerSelectionField } from "./pointerSelection";

export type MarkdownRevealedSourceRange = {
  from: number;
  to: number;
  presentation: "inline" | "block";
};

/**
 * Explicitly exposes one canonical Markdown source range in the main
 * CodeMirror document. Widgets never own a second editable source copy.
 */
export const markdownRevealedSourceEffect = StateEffect.define<MarkdownRevealedSourceRange | null>();

export const markdownRevealedSourceField = StateField.define<MarkdownRevealedSourceRange | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(markdownRevealedSourceEffect)) return effect.value;
    }

    if (!value) return null;
    const mapped = {
      from: transaction.changes.mapPos(value.from, -1),
      to: transaction.changes.mapPos(value.to, 1),
      presentation: value.presentation,
    } satisfies MarkdownRevealedSourceRange;
    const selection = transaction.state.selection.main;
    // Expanded atoms change line width/height when folded. Keep the same
    // projection through mouse hit testing and a covering/adjacent selection,
    // just as for automatically revealed inline syntax. Reconcile on the next
    // caret placement or committed edit; explicit effects above still win.
    if (!transaction.docChanged && (
      transaction.state.field(markdownPointerSelectionField, false)
      || !selection.empty
    )) return mapped;
    return selection.from >= mapped.from && selection.to <= mapped.to
      ? mapped
      : null;
  },
});
