/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { insertMarkdownImageAt } from "../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";
import { markdownCodeMirrorLanguageExtension } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); } });
function viewOf(doc: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [history(), markdownCodeMirrorLanguageExtension()] }), parent });
  views.push(view);
  return view;
}

describe("paragraph image insertion", () => {
  it.each([
    { doc: "", at: 0, expected: "![a](a.png)" },
    { doc: "第一段\n\n第二段", at: 3, expected: "第一段\n\n![a](a.png)\n\n第二段" },
    { doc: "第一段", at: 0, expected: "![a](a.png)\n\n第一段" },
    { doc: "第一段", at: 3, expected: "第一段\n\n![a](a.png)" },
    { doc: "第一段\n", at: 4, expected: "第一段\n\n![a](a.png)" },
    { doc: "第一段\n\n\n第二段", at: 3, expected: "第一段\n\n![a](a.png)\n\n\n第二段" },
  ])("isolates the image at $at in $doc", ({ doc, at, expected }) => {
    const view = viewOf(doc);
    insertMarkdownImageAt(view, at, "![a](a.png)");
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("does not split a paragraph if an async anchor is no longer a boundary", () => {
    const view = viewOf("这是一句话");
    insertMarkdownImageAt(view, 4, "![a](a.png)");
    expect(view.state.doc.toString()).toBe("这是一句话");
  });
  it("keeps consecutive image drops as separate undo steps", () => {
    const view = viewOf("正文");
    insertMarkdownImageAt(view, 0, "![a](a.png)");
    const first = view.state.doc.toString();
    insertMarkdownImageAt(view, view.state.doc.length, "![b](b.png)");
    undo(view);
    expect(view.state.doc.toString()).toBe(first);
  });
  it.each(["```js\ncode", "~~~\ncode\n", "<!-- comment", "<script>\ncode", "<![CDATA[\ntext", "<?open", "<script", "<script>\ncode\n</script  >"])("does not insert an invisible image inside an unclosed block: %s", (doc) => {
    const view = viewOf(doc);
    expect(insertMarkdownImageAt(view, doc.length, "![a](a.png)")).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    expect(insertMarkdownImageAt(view, 0, "![a](a.png)")).toBe(true);
    expect(view.state.doc.toString()).toBe(`![a](a.png)\n\n${doc}`);
  });
  it.each(["```js\ncode\n```", "~~~\ncode\n~~~", "<!-- comment -->", "<script>\ncode\n</script>", "    code\n    more", "<?closed?>", "<textarea>\ntext"])("allows an image after a complete block: %s", (doc) => {
    const view = viewOf(doc);
    expect(insertMarkdownImageAt(view, doc.length, "![a](a.png)")).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n\n![a](a.png)`);
  });
});
