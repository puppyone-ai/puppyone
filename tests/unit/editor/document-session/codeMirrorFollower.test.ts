/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CodeMirrorDocumentModel } from "../../../../src/shared-ui/editor/document-session/CodeMirrorDocumentModel";
import { createCodeMirrorFollowerView, type CodeMirrorFollowerView } from "../../../../src/shared-ui/editor/document-session/codeMirrorFollower";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** The document's one editable view, mounted as an editor mounts it. */
function mountPrimary(model: CodeMirrorDocumentModel, readOnly = false) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: model.createViewState(EditorState.readOnly.of(readOnly)),
    dispatchTransactions: (transactions, target) => model.acceptTransactions(transactions, target),
  });
  model.attachView(view);
  cleanups.push(() => { model.detachView(view); view.destroy(); });
  return view;
}

function mountFollower(model: CodeMirrorDocumentModel): CodeMirrorFollowerView {
  const follower = createCodeMirrorFollowerView(model, { parent: document.body.appendChild(document.createElement("div")), extensions: [] });
  cleanups.push(follower.dispose);
  return follower;
}

const type = (view: EditorView, at: number, insert: string) =>
  view.dispatch({ changes: { from: at, insert }, userEvent: "input.type" });

describe("CodeMirror follower view", () => {
  it("starts with the document's text and takes edits made in its editable view", () => {
    const model = new CodeMirrorDocumentModel("# Plan\n");
    const primary = mountPrimary(model);
    const { view } = mountFollower(model);
    expect(view.state.doc.toString()).toBe("# Plan\n");

    type(primary, 7, "Body.");
    expect(view.state.doc.toString()).toBe("# Plan\nBody.");
  });

  it("sends its own edits through the document, into the editable view", () => {
    const model = new CodeMirrorDocumentModel("# Plan\n");
    const primary = mountPrimary(model);
    const { view } = mountFollower(model);
    // Counted after the follower subscribes: its edit reaches the document once, not echoed back.
    let documentChanges = 0;
    model.subscribeTransactions((transaction) => { if (transaction.docChanged) documentChanges += 1; });

    type(view, 7, "Typed in the source.");
    expect(primary.state.doc.toString()).toBe("# Plan\nTyped in the source.");
    expect(model.readSnapshot().content).toBe("# Plan\nTyped in the source.");
    expect(view.state.doc.toString()).toBe("# Plan\nTyped in the source.");
    expect(documentChanges).toBe(1);
  });

  it("edits a document whose editable view is read-only, which only stops typing there", () => {
    const model = new CodeMirrorDocumentModel("a");
    const primary = mountPrimary(model, true);
    const { view } = mountFollower(model);

    type(view, 1, "b");
    expect(primary.state.doc.toString()).toBe("ab");
  });

  it("shares one undo history with the editable view", () => {
    const model = new CodeMirrorDocumentModel("");
    const primary = mountPrimary(model);
    const { view } = mountFollower(model);

    type(view, 0, "from the follower");
    expect(model.moveHistory("undo")).toBe(true);
    expect(primary.state.doc.toString()).toBe("");
    expect(view.state.doc.toString()).toBe("");
    expect(model.moveHistory("redo")).toBe(true);
    expect(view.state.doc.toString()).toBe("from the follower");
  });

  it("takes a replacement read from storage", () => {
    const model = new CodeMirrorDocumentModel("old");
    mountPrimary(model);
    const { view } = mountFollower(model);

    model.replaceContent("changed on disk");
    expect(view.state.doc.toString()).toBe("changed on disk");
  });

  it("refuses typing while the document takes no edits, and keeps its copy unchanged", () => {
    const model = new CodeMirrorDocumentModel("locked");
    mountPrimary(model);
    const { view } = mountFollower(model);
    model.setInputEnabled(false);

    type(view, 0, "x");
    expect(view.state.doc.toString()).toBe("locked");
    expect(model.readSnapshot().content).toBe("locked");
  });

  it("works with no editable view mounted, as beside a page preview", () => {
    const model = new CodeMirrorDocumentModel("<p>a</p>", undefined, true);
    const { view } = mountFollower(model);

    type(view, 4, "b");
    expect(model.readSnapshot().content).toBe("<p>ab</p>");
  });

  it("keeps CRLF line endings when the document preserves them", () => {
    const model = new CodeMirrorDocumentModel("a\r\nb", undefined, true);
    const { view } = mountFollower(model);
    expect(view.state.doc.toString()).toBe("a\r\nb");

    type(view, view.state.doc.length, "c");
    expect(model.readSnapshot().content).toBe("a\r\nbc");
  });

  it("stays identical to the document through interleaved edits from both views", () => {
    const model = new CodeMirrorDocumentModel("");
    const primary = mountPrimary(model);
    const { view } = mountFollower(model);

    for (let index = 0; index < 50; index += 1) {
      const target = index % 2 ? primary : view;
      type(target, Math.floor(target.state.doc.length / 2), String(index % 10));
    }
    expect(view.state.doc.toString()).toBe(primary.state.doc.toString());
    expect(primary.state.doc.length).toBe(50);
  });

  it("stops following once disposed", () => {
    const model = new CodeMirrorDocumentModel("a");
    const primary = mountPrimary(model);
    const follower = createCodeMirrorFollowerView(model, { parent: document.body, extensions: [] });
    follower.dispose();

    type(primary, 1, "b");
    expect(follower.view.state.doc.toString()).toBe("a");
  });
});
