/** @vitest-environment happy-dom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewDecorations } from "../../../../../../packages/shared-ui/src/editor/markdown/core/projection/markdownDocumentProjection";
import { markdownLivePreviewFocusEffect } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";
import { markdownPointerSelectionField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/pointerSelection";
import { markdownRevealedSourceEffect, markdownRevealedSourceField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/revealedSource";

const source = "Prefix **abcdefghij** suffix\n\nOther paragraph.";
const caret = source.indexOf("abcdefghij") + 4;
const views = new Set<EditorView>();

afterEach(() => {
  for (const view of views) view.destroy();
  views.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createView(doc = source) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, extensions: [
      ...markdownCodeMirrorBaseExtensions(false), markdownLivePreviewExtension(),
    ] }),
  });
  views.add(view);
  // happy-dom has no text layout. Only coordinate measurement is controlled;
  // real CodeMirror event routing, transactions and projection remain active.
  vi.spyOn(view, "posAndSideAtCoords").mockImplementation(({ x }) => ({ pos: x, assoc: 1 }));
  vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
  view.focus();
  view.dispatch({ effects: markdownLivePreviewFocusEffect.of(true) });
  return view;
}

function mouse(target: EventTarget, type: string, position = caret, buttons = 1) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons, detail: 1,
    clientX: position, clientY: 10,
  }));
}
const active = (view: EditorView) => view.state.field(markdownPointerSelectionField);
const reveal = (view: EditorView) => view.state.field(markdownLivePreviewDecorations).revealRange;
// Cross the release coordinator's next-task boundary, not a layout wait.
const released = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Markdown pointer selection lifecycle", () => {
  for (const [presentation, fragment] of [["inline", "$x^2$"], ["block", "$$\nx^2\n$$"]] as const) {
    it(`retains expanded ${presentation} source while dragging in the following paragraph`, async () => {
      const doc = `${fragment}\n\nFollowing paragraph.`;
      const view = createView(doc);
      const expanded = { from: 0, to: fragment.length, presentation };
      view.dispatch({ effects: markdownRevealedSourceEffect.of(expanded), selection: { anchor: 3 } });
      const anchor = doc.indexOf("paragraph") + 4;
      mouse(view.contentDOM, "mousedown", anchor);
      expect(view.state.field(markdownRevealedSourceField)).toEqual(expanded);
      mouse(document, "mousemove", anchor - 1);
      mouse(document, "mouseup", anchor - 1, 0);
      await released();
      expect(view.state.field(markdownRevealedSourceField)).toEqual(expanded);
      // happy-dom has no multi-line hit testing. Assert the selected interval
      // here; the Chromium scenario owns exact anchor/head direction and pixels.
      expect(view.state.selection.main).toMatchObject({ from: anchor - 1, to: anchor });
      view.dispatch({ selection: { anchor } });
      expect(view.state.field(markdownRevealedSourceField)).toBeNull();
      expect(view.state.doc.toString()).toBe(doc);
    });

    it(`folds expanded ${presentation} source after an outside single click completes`, async () => {
      const doc = `${fragment}\n\nFollowing paragraph.`;
      const view = createView(doc);
      const expanded = { from: 0, to: fragment.length, presentation };
      view.dispatch({ effects: markdownRevealedSourceEffect.of(expanded), selection: { anchor: 3 } });
      const anchor = doc.indexOf("paragraph") + 4;
      mouse(view.contentDOM, "mousedown", anchor);
      expect(view.state.field(markdownRevealedSourceField)).toEqual(expanded);
      mouse(document, "mouseup", anchor, 0);
      await released();
      expect(view.state.field(markdownRevealedSourceField)).toBeNull();
      expect(view.state.selection.main.head).toBe(anchor);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it(`retains expanded ${presentation} source for a keyboard range leaving it`, () => {
      const doc = `${fragment}\n\nFollowing paragraph.`;
      const view = createView(doc);
      const expanded = { from: 0, to: fragment.length, presentation };
      view.dispatch({ effects: markdownRevealedSourceEffect.of(expanded), selection: { anchor: 3 } });
      view.dispatch({ selection: { anchor: 3, head: doc.length }, userEvent: "select.extend" });
      expect(view.state.field(markdownRevealedSourceField)).toEqual(expanded);
      view.dispatch({ changes: { from: 3, to: doc.length, insert: "replacement" }, selection: { anchor: 14 }, userEvent: "input.type" });
      expect(view.state.doc.toString()).toBe(doc.slice(0, 3) + "replacement");
    });
  }

  it("keeps backward selection geometry through an outside release, then permits caret editing", async () => {
    const view = createView();
    mouse(view.contentDOM, "mousedown");
    expect(reveal(view)).toBeNull();
    mouse(document, "mousemove", caret - 1);
    expect(view.state.selection.main).toMatchObject({ anchor: caret, head: caret - 1 });
    mouse(document.body, "mouseup", caret - 1, 0);
    await released();
    expect(active(view)).toBe(false);
    expect(reveal(view)).toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("d");
    view.dispatch({ selection: { anchor: caret } });
    expect(reveal(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });

  it("waits for a consumed mouseup before revealing source", async () => {
    const view = createView();
    mouse(view.contentDOM, "mousedown");
    const states: boolean[] = [];
    view.contentDOM.addEventListener("mouseup", (event) => {
      states.push(active(view));
      event.stopPropagation();
    }, { once: true });
    mouse(view.contentDOM, "mouseup", caret, 0);
    await Promise.resolve();
    expect(states).toEqual([true]);
    expect(active(view)).toBe(true);
    await released();
    expect(active(view)).toBe(false);
    expect(reveal(view)).not.toBeNull();
  });

  for (const cancellation of ["pointercancel", "window-blur", "keydown", "dragstart", "released-button"] as const) {
    it(`releases a gesture after ${cancellation}`, async () => {
      const view = createView();
      mouse(view.contentDOM, "mousedown");
      expect(active(view)).toBe(true);
      if (cancellation === "window-blur") window.dispatchEvent(new Event("blur"));
      else if (cancellation === "released-button") mouse(document, "mousemove", caret, 0);
      else if (cancellation === "keydown") view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else view.contentDOM.dispatchEvent(new Event(cancellation, { bubbles: true }));
      await released();
      expect(active(view)).toBe(false);
      view.dispatch({ selection: { anchor: source.length } });
      expect(reveal(view)).toBeNull();
      view.dispatch({ selection: { anchor: caret } });
      expect(reveal(view)).not.toBeNull();
    });
  }

  it("does not let a queued release terminate the next gesture", async () => {
    const view = createView();
    mouse(view.contentDOM, "mousedown");
    mouse(document, "mouseup", caret, 0);
    mouse(view.contentDOM, "mousedown", caret + 1);
    await released();
    expect(active(view)).toBe(true);
    expect(reveal(view)).toBeNull();
    mouse(document, "mouseup", caret + 1, 0);
    await released();
    expect(active(view)).toBe(false);
    expect(reveal(view)).not.toBeNull();
  });

  it("keeps another editor's projection independent of the current gesture", async () => {
    const right = createView();
    const left = createView();
    mouse(left.contentDOM, "mousedown");
    right.dispatch({ effects: markdownLivePreviewFocusEffect.of(true), selection: { anchor: caret } });
    expect(active(left)).toBe(true);
    expect(active(right)).toBe(false);
    expect(reveal(left)).toBeNull();
    expect(reveal(right)).not.toBeNull();
    mouse(document, "mouseup", caret, 0);
    await released();
  });

  it("does not defer the projection of a committed edit", () => {
    const view = createView();
    mouse(view.contentDOM, "mousedown");
    view.dispatch({ changes: { from: caret, insert: "X" }, selection: { anchor: caret + 1 }, userEvent: "input.type" });
    expect(active(view)).toBe(false);
    expect(reveal(view)).not.toBeNull();
    expect(view.state.doc.toString()).toBe(source.slice(0, caret) + "X" + source.slice(caret));
  });

  it("removes document listeners and cancels deferred dispatch on destruction", async () => {
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const view = createView();
    const listeners = addListener.mock.calls.filter(([type]) => ["mousemove", "mouseup", "pointercancel"].includes(type));
    mouse(view.contentDOM, "mousedown");
    mouse(document, "mouseup", caret, 0);
    expect(active(view)).toBe(true);
    view.destroy();
    views.delete(view);
    for (const listener of listeners) expect(removeListener).toHaveBeenCalledWith(...listener);
    mouse(document, "mousemove", caret, 0);
    mouse(document, "mouseup", caret, 0);
    window.dispatchEvent(new Event("blur"));
    await released();
    // CodeMirror may still publish its own queued focus transaction after
    // destroy. The disposed gesture must never publish a release transaction.
    expect(active(view)).toBe(true);
  });
});
