/** @vitest-environment happy-dom */
import { vi, afterEach, describe, expect, it } from "vitest";
vi.hoisted(() => { Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true }); });
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { markdownBlockDragExtension } from "../../../../../../src/shared-ui/editor/markdown/addons/block-drag";
let view: EditorView | null = null;
afterEach(() => { view?.destroy(); document.body.replaceChildren(); });
describe("Mac Markdown key routing", () => {
  it("moves a block ahead of the default selection-to-document-end binding", () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: "one\n\ntwo",
      selection: EditorSelection.single(1), extensions: [markdownCodeMirrorBaseExtensions(false), markdownLivePreviewExtension(), markdownBlockDragExtension()] }) });
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true, shiftKey: true }), "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("two\n\none");
  });
  it("accepts Option-transformed letters from the physical keyboard", () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: "hello",
      selection: EditorSelection.single(0, 5), extensions: markdownCodeMirrorBaseExtensions(false) }) });
    const event = new KeyboardEvent("keydown", { key: "ø", code: "KeyO", keyCode: 79, metaKey: true, altKey: true });
    expect(runScopeHandlers(view, event, "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("1. hello");
  });
});
