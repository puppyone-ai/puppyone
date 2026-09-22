import { Annotation } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Record navigation when it is requested, before a concurrent host resize can
 * restore an older reading anchor. scrollHandler alone runs too late, during
 * engine measurement. Keep the actual scrolling owned by CodeMirror. */
export const codeMirrorNavigationIntent = Annotation.define<boolean>();

export function scrollCodeMirrorIntoView(
  view: EditorView,
  position: Parameters<typeof EditorView.scrollIntoView>[0],
  options?: Parameters<typeof EditorView.scrollIntoView>[1],
): void {
  view.dispatch({ effects: EditorView.scrollIntoView(position, options),
    annotations: codeMirrorNavigationIntent.of(true) });
}
