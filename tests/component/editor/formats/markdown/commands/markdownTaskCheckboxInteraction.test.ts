/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

const mountedViews: Array<{ parent: HTMLElement; view: EditorView }> = [];

afterEach(() => {
  for (const { parent, view } of mountedViews.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

describe("Markdown task checkbox interaction", () => {
  it("owns one pointer activation and applies one atomic token change", () => {
    const view = mountMarkdown("- [ ] First\n- [x] Second");
    view.dispatch({ selection: { anchor: 6 } });
    const initialSelection = view.state.selection;
    const control = getTaskControl(view, 0);

    expect(control).toBeInstanceOf(HTMLButtonElement);
    expect(control.type).toBe("button");
    expect(control.getAttribute("role")).toBe("checkbox");
    expect(control.getAttribute("aria-checked")).toBe("false");

    dispatchPointerActivation(control, { x: 10, y: 10 });

    expect(view.state.doc.toString()).toBe("- [x] First\n- [x] Second");
    expect(view.state.selection.eq(initialSelection)).toBe(true);
    const updatedControl = getTaskControl(view, 0);
    expect(updatedControl).toBe(control);
    expect(updatedControl.getAttribute("aria-checked")).toBe("true");
  });

  it("supports repeated native activation without trusting stale widget state", () => {
    const view = mountMarkdown("- [ ] Repeat");

    getTaskControl(view, 0).click();
    expect(view.state.doc.toString()).toBe("- [x] Repeat");

    getTaskControl(view, 0).click();
    expect(view.state.doc.toString()).toBe("- [ ] Repeat");
  });

  it("resolves a task from the current document after edits before its line", () => {
    const view = mountMarkdown([
      "- [ ] Top",
      "",
      "Paragraph one",
      "Paragraph two",
      "Paragraph three",
      "",
      "- [ ] Middle",
      "",
      "- [ ] Bottom",
    ].join("\n"));
    const middleBeforeEdit = getTaskControl(view, 1);
    const insertAt = view.state.doc.line(2).to;

    view.dispatch({
      changes: { from: insertAt, insert: "\nInserted between task groups" },
    });

    const middleAfterEdit = getTaskControl(view, 1);
    expect(middleAfterEdit).toBe(middleBeforeEdit);
    middleAfterEdit.click();

    expect(view.state.doc.toString()).toContain("- [x] Middle");
    expect(view.state.doc.toString()).toContain("- [ ] Bottom");
  });

  it("changes only on native activation, never on pointer-down alone", () => {
    const view = mountMarkdown("- [ ] Native click");
    const control = getTaskControl(view, 0);

    control.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    control.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    expect(view.state.doc.toString()).toBe("- [ ] Native click");

    control.click();
    expect(view.state.doc.toString()).toBe("- [x] Native click");
  });

  it("preserves read-only documents", () => {
    const view = mountMarkdown("- [ ] Locked", true);

    getTaskControl(view, 0).click();

    expect(view.state.doc.toString()).toBe("- [ ] Locked");
    expect(getTaskControl(view, 0).getAttribute("aria-checked")).toBe("false");
  });
});

function mountMarkdown(source: string, readOnly = false): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        ...markdownCodeMirrorBaseExtensions(readOnly),
        markdownLivePreviewExtension("safe", null, "tasks.md", null),
      ],
    }),
  });
  mountedViews.push({ parent, view });
  return view;
}

function getTaskControl(view: EditorView, index: number): HTMLButtonElement {
  const control = view.dom.querySelectorAll<HTMLButtonElement>(".cm-md-task-checkbox-widget")[index];
  if (!control) throw new Error(`Missing task checkbox at index ${index}`);
  return control;
}

function dispatchPointerActivation(
  control: HTMLButtonElement,
  start: { x: number; y: number },
) {
  control.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    clientX: start.x,
    clientY: start.y,
  }));
  control.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    clientX: start.x,
    clientY: start.y,
  }));
  control.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: start.x,
    clientY: start.y,
    detail: 1,
  }));
}
