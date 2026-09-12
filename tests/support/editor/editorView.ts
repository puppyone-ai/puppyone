import { EditorView } from "@codemirror/view";

/** A mounted editor is a fixture precondition, checked before reading its state. */
export function requireEditorView(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("Expected a mounted CodeMirror view for the test element.");
  return view;
}
