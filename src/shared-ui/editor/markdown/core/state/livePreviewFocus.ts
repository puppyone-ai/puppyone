import { StateEffect, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export const markdownLivePreviewFocusEffect = StateEffect.define<boolean>();

/**
 * Couples Live Preview's focus projection with CodeMirror's own exact scroll
 * snapshot in one focus-change transaction.
 *
 * Revealing or hiding Markdown source can invalidate CodeMirror's height map.
 * Without a snapshot, its generic scroll anchoring may add the measured line
 * delta on every blur, which makes a background MDI pane creep vertically.
 * The captured view is deliberately extension-instance local: sibling panes
 * must never read or restore one another's scroll state.
 */
export function markdownLivePreviewFocusExtension(): Extension {
  let owner: EditorView | null = null;
  const ownerLifecycle = ViewPlugin.define((view) => {
    owner = view;
    return {
      destroy() {
        if (owner === view) owner = null;
      },
    };
  });

  return [
    ownerLifecycle,
    EditorView.focusChangeEffect.of((_state, focusing) => (
      markdownLivePreviewFocusEffect.of(focusing)
    )),
    EditorView.focusChangeEffect.of(() => owner?.scrollSnapshot() ?? null),
  ];
}

export function getLivePreviewFocusState(focused: boolean, effects: readonly StateEffect<unknown>[]): boolean {
  for (const effect of effects) {
    if (effect.is(markdownLivePreviewFocusEffect)) return effect.value;
  }
  return focused;
}
