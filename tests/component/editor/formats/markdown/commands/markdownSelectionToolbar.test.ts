/** @vitest-environment happy-dom */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySelectionToolbarCommand, canFormatSelection, placeSelectionToolbar } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/selection-toolbar/selectionToolbarModel";
import { markdownCodeMirrorBaseExtensions } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) { const host = view.dom.parentElement; view.destroy(); host?.remove(); } });
function editor(doc = "选中文字之后可以设置格式", readOnly = false) {
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView({ parent: host, state: EditorState.create({ doc,
    extensions: [markdownCodeMirrorBaseExtensions(readOnly), EditorState.readOnly.of(readOnly)] }) });
  views.push(view); vi.spyOn(view, "focus").mockImplementation(() => undefined);
  view.dispatch({ selection: EditorSelection.range(0, 4) });
  return view;
}
function action(view: EditorView, id: string) {
  const button = view.dom.querySelector<HTMLButtonElement>(`[data-markdown-command="${id}"]`);
  expect(button, `selection toolbar command ${id}`).not.toBeNull();
  button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button!.click();
}
describe("Markdown selection formatting toolbar", () => {
  it("formats the retained selection and supports undo", () => {
    const view = editor(); const before = view.state.doc.toString();
    action(view, "strong");
    expect(view.state.doc.toString()).toBe("**选中文字**之后可以设置格式");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("选中文字");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(before);
  });
  it("toggles an existing inline format without adding another wrapper", () => {
    const view = editor("**hello** world");
    view.dispatch({ selection: EditorSelection.range(2, 7) });
    action(view, "strong"); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("keeps successive format actions as separate undo steps", () => {
    const view = editor("hello world"); view.dispatch({ selection: EditorSelection.range(0, 5) });
    action(view, "strong"); action(view, "emphasis");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("**hello** world");
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("highlights and clears selected text using canonical Markdown", () => {
    const view = editor("hello world"); view.dispatch({ selection: EditorSelection.range(0, 5) });
    action(view, "highlight"); expect(view.state.doc.toString()).toBe("==hello== world");
    action(view, "clearFormat"); expect(view.state.doc.toString()).toBe("hello world");
  });
  it("converts a list item into a heading atomically", () => {
    const view = editor("- hello\n- world"); view.dispatch({ selection: EditorSelection.range(2, 7) });
    expect(applySelectionToolbarCommand(view, "heading2")).toBe(true);
    expect(view.state.doc.toString()).toBe("## hello\n- world");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("hello");
    undo(view); expect(view.state.doc.toString()).toBe("- hello\n- world");
  });
  it.each(["```js\nhello\n```", "---\ntitle: hello\n---", "| hello | world |\n| --- | --- |\n| one | two |"])("leaves non-prose content untouched: %s", doc => {
    const view = editor(doc); const start = doc.indexOf("hello");
    view.dispatch({ selection: EditorSelection.range(start, start + 5) });
    expect(canFormatSelection(view.state)).toBe(false);
    expect(applySelectionToolbarCommand(view, "strong")).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("does not convert the next code fence when selection ends at its line start", () => {
    const view = editor("hello\n```js\nconst x = 1;\n```");
    view.dispatch({ selection: EditorSelection.range(0, 6) });
    expect(applySelectionToolbarCommand(view, "heading2")).toBe(true);
    expect(view.state.doc.toString()).toBe("## hello\n```js\nconst x = 1;\n```");
  });
  it.each([["# [x] Title", "paragraph", "[x] Title"], ["> [x] note", "heading2", "## [x] note"], ["> - nested", "paragraph", "nested"]])("preserves literal text while converting %s", (doc, type, expected) => {
    const view = editor(doc); view.dispatch({ selection: EditorSelection.range(0, doc.length) });
    expect(applySelectionToolbarCommand(view, type)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });
  it("does not insert invalid inline markers across separate paragraphs", () => {
    const view = editor("one\n\ntwo"); view.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(applySelectionToolbarCommand(view, "strong")).toBe(false);
    expect(view.state.doc.toString()).toBe("one\n\ntwo");
    expect(applySelectionToolbarCommand(view, "bulletList")).toBe(true);
  });
  it.each([["Title\n====", "heading2", "## Title"], ["Title\n----", "quote", "> Title"], ["## Title ##", "paragraph", "Title"]])("normalizes structural heading markers in %s", (doc, type, expected) => {
    const view = editor(doc); const from = doc.indexOf("Title"); view.dispatch({ selection: EditorSelection.range(from, from + 5) });
    expect(applySelectionToolbarCommand(view, type)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    undo(view); expect(view.state.doc.toString()).toBe(doc);
  });
  it("does not show for a caret or multiple selections", () => {
    const view = editor(); view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(canFormatSelection(view.state)).toBe(false);
    const state = EditorState.create({ doc: "hello world", extensions: EditorState.allowMultipleSelections.of(true),
      selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(7, 9)]) });
    expect(canFormatSelection(state)).toBe(false);
  });
  it("places controls below top-edge selections and inside a narrow pane", () => {
    const pane = { left: 100, right: 400, top: 80, bottom: 500 };
    const result = placeSelectionToolbar({ left: 110, right: 140, top: 90, bottom: 110 }, pane, 280, 42);
    expect(result).toEqual({ left: 106, top: 118 });
    expect(result.left + 280).toBeLessThan(pane.right);
  });
  it("does not modify a read-only document through toolbar actions", () => {
    const view = editor("read only", true);
    view.dom.querySelector<HTMLButtonElement>('[data-markdown-command="strong"]')?.click();
    expect(view.state.doc.toString()).toBe("read only");
  });
});
