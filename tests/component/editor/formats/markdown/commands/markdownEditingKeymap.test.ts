/**
 * @vitest-environment happy-dom
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownEditingKeymap } from "../../../../../../packages/shared-ui/src/editor/markdown/core/commands/markdownEditingKeymap";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

describe("Markdown editing shortcuts", () => {
  it("includes heading, bold, italic, strikethrough, and underline keybindings", () => {
    const keys = new Set(markdownEditingKeymap.map((binding) => binding.key));
    expect(keys.has("Mod-b")).toBe(true);
    expect(keys.has("Mod-i")).toBe(true);
    expect(keys.has("Mod-u")).toBe(true);
    expect(keys.has("Mod-d")).toBe(true);
    expect(keys.has("Mod-Shift-x")).toBe(true);
    expect(keys.has("Mod-1")).toBe(true);
    expect(keys.has("Mod-2")).toBe(true);
    expect(keys.has("Mod-3")).toBe(true);
  });

  it("toggles underline with Mod-u", () => {
    const view = createView("hello");
    view.dispatch({ selection: EditorSelection.range(0, 5) });
    const underlineBinding = markdownEditingKeymap.find((binding) => binding.key === "Mod-u");
    if (!underlineBinding?.run) throw new Error("Missing Mod-u binding");

    expect(underlineBinding.run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("<u>hello</u>");

    view.dispatch({ selection: EditorSelection.range(3, 8) });
    expect(underlineBinding.run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
  });
});

function createView(content: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: content }),
  });
  views.push(view);
  return view;
}
