import { Annotation, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { followerEdit, type CodeMirrorDocumentModel } from "./CodeMirrorDocumentModel";

/** A change copied in from the document, not typed into the follower. */
const mirrored = Annotation.define<boolean>();

export type CodeMirrorFollowerView = Readonly<{ view: EditorView; dispose: () => void }>;

/**
 * A second view of a document whose one editable view shows it elsewhere, as
 * CodeMirror's split view: it takes every change made to the document, and
 * sends its own edits through the document, so both views share one text and
 * one undo history. Undo and redo here move that history.
 */
export function createCodeMirrorFollowerView(model: CodeMirrorDocumentModel, { parent, extensions }: Readonly<{
  parent: Element;
  extensions: Extension;
}>): CodeMirrorFollowerView {
  const moveHistory = (direction: "undo" | "redo") => () => model.moveHistory(direction);
  const view: EditorView = new EditorView({
    parent,
    state: model.createFollowerState([
      Prec.high(keymap.of([
        { key: "Mod-z", run: moveHistory("undo"), preventDefault: true },
        { key: "Mod-Shift-z", run: moveHistory("redo"), preventDefault: true },
        { key: "Mod-y", run: moveHistory("redo"), preventDefault: true },
      ])),
      extensions,
    ]),
    dispatchTransactions: (transactions) => {
      for (const transaction of transactions) {
        const own = transaction.docChanged && !transaction.annotation(mirrored);
        // A document that takes no edits refuses them here too, before this copy changes.
        if (own && !model.editable) continue;
        view.update([transaction]);
        if (!own) continue;
        model.applyFollowerEdit(transaction, view);
        // The document's own view may adjust an edit as it takes it; this copy then follows the document.
        if (!model.editorState.doc.eq(view.state.doc)) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: model.editorState.doc }, annotations: mirrored.of(true) });
        }
      }
    },
  });
  const unsubscribe = model.subscribeTransactions((transaction) => {
    if (!transaction.docChanged || transaction.annotation(followerEdit) === view) return;
    view.dispatch({ changes: transaction.changes, annotations: mirrored.of(true) });
  });
  return { view, dispose: () => { unsubscribe(); view.destroy(); } };
}
