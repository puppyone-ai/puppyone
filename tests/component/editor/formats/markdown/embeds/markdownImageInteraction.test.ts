/** @vitest-environment happy-dom */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const views: EditorView[] = [];
const source = "Before ![image](missing.png) after";
afterEach(() => { views.splice(0).forEach((view) => view.destroy()); document.body.replaceChildren(); });

function mount(readOnly: boolean) {
  const mode = new Compartment();
  const view = new EditorView({ parent: document.body.appendChild(document.createElement("div")), state: EditorState.create({
    doc: source,
    extensions: [...markdownCodeMirrorBaseExtensions(readOnly), mode.of(EditorState.readOnly.of(readOnly)), markdownLivePreviewExtension()],
  }) });
  views.push(view);
  const widget = view.dom.querySelector<HTMLElement>(".cm-md-image-widget")!;
  expect(widget).not.toBeNull();
  return { view, widget, mode };
}

describe("Markdown image keyboard interaction", () => {
  it.each(["Backspace", "Delete"])("preserves a read-only image on %s", (key) => {
    const { view, widget } = mount(true);
    widget.focus();
    widget.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe(source);
  });

  it("checks current read-only state after retaining the mounted image", () => {
    const { view, widget, mode } = mount(false);
    view.dispatch({ effects: mode.reconfigure(EditorState.readOnly.of(true)) });
    expect(view.dom.querySelector(".cm-md-image-widget")).toBe(widget);
    widget.focus();
    widget.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe(source);
  });

  it("deletes an editable image as one undoable change", () => {
    const { view, widget } = mount(false);
    widget.focus();
    widget.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("Before  after");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });
});
