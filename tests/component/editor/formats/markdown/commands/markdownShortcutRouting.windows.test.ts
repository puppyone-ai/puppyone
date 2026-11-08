/** @vitest-environment happy-dom */
import { vi, afterEach, describe, expect, it } from "vitest";
vi.hoisted(() => { Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true }); });
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownCodeMirrorBaseExtensions } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
let view: EditorView | null = null;
afterEach(() => { view?.destroy(); document.body.replaceChildren(); });
describe("Windows Markdown key routing", () => {
  it("inserts code with Ctrl Shift C while leaving AltGr text entry alone", () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: "hello",
      selection: EditorSelection.single(0, 5), extensions: markdownCodeMirrorBaseExtensions(false) }) });
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "@", code: "KeyQ", keyCode: 81, ctrlKey: true, altKey: true }), "editor")).toBe(false);
    expect(view.state.doc.toString()).toBe("hello");
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "C", code: "KeyC", keyCode: 67, ctrlKey: true, shiftKey: true }), "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("```\nhello\n```");
  });
});
