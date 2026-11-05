/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertMarkdownImageAt } from "../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";

function viewOf(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({ state: EditorState.create({ doc }), parent });
}

describe("insertMarkdownImageAt", () => {
  it("inserts on an empty line without extra padding", () => {
    const view = viewOf("");
    insertMarkdownImageAt(view, 0, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("![a](a.png)");
  });

  it("pads when inserted mid-word", () => {
    const view = viewOf("这是一句话");
    insertMarkdownImageAt(view, 4, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("这是一句 ![a](a.png) 话");
  });

  it("does not add a leading space at the start of a line", () => {
    const view = viewOf("句子");
    insertMarkdownImageAt(view, 0, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("![a](a.png)句子");
  });
});
