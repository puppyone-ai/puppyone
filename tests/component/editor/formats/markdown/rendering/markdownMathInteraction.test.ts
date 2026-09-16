/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownRevealedSourceField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/revealedSource";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

vi.hoisted(() => {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const mountedViews: Array<{ parent: HTMLElement; view: EditorView }> = [];

afterEach(() => {
  for (const { parent, view } of mountedViews.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

describe("Markdown math live preview", () => {
  it("renders display and inline formulas through KaTeX", () => {
    const view = mountMarkdown([
      "Energy $E = mc^2$ is conserved.",
      "",
      "$$",
      "E = \\sum_{i=1}^{n} \\frac{1}{2} m_i v_i^2 + \\frac{1}{2} k x^2",
      "$$",
    ].join("\n"));

    const inline = view.dom.querySelector<HTMLElement>(".cm-md-math-inline-widget");
    const block = view.dom.querySelector<HTMLElement>(".cm-md-math-block-widget");
    if (!inline || !block) throw new Error(view.dom.innerHTML);
    expect(inline.querySelector(".katex-mathml math")).not.toBeNull();
    expect(block?.querySelector(".katex-display .katex-mathml math")).not.toBeNull();
    expect(block?.getAttribute("role")).toBe("math");
    expect(block?.textContent).not.toContain("$$");
  });

  it("keeps invalid LaTeX visible instead of dropping the source", () => {
    const view = mountMarkdown("Broken $\\frac{$ formula");
    const inline = view.dom.querySelector<HTMLElement>(".cm-md-math-inline-widget");

    expect(inline?.classList.contains("is-invalid")).toBe(true);
    expect(inline?.textContent).toBe("$\\frac{$");
  });

  it("reveals the canonical display source on double click", () => {
    const source = "$$\nE = mc^2\n$$";
    const view = mountMarkdown(source);
    const block = view.dom.querySelector<HTMLElement>(".cm-md-math-block-widget");
    if (!block) throw new Error("Display math widget did not mount.");

    block.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

    expect(view.state.field(markdownRevealedSourceField)).toEqual({
      from: 0,
      to: source.length,
      presentation: "block",
    });
    expect(view.dom.querySelector(".cm-md-math-block-widget")).toBeNull();
    expect(view.contentDOM.textContent).toContain("E = mc^2");
  });

  it("places the caret at math content start for indented display blocks", () => {
    const source = "  $$\nE = mc^2\n  $$";
    const view = mountMarkdown(source);
    const block = view.dom.querySelector<HTMLElement>(".cm-md-math-block-widget");
    if (!block) throw new Error("Display math widget did not mount.");

    block.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

    expect(view.state.selection.main.head).toBe(source.indexOf("E"));
  });

  it.each([
    ["inline", "$x^2$"],
    ["block", "$$\nx^2\n$$"],
  ])("protects read-only %s formulas from deletion", (_presentation, source) => {
    const view = mountMarkdown(source, true);
    const widget = view.dom.querySelector<HTMLElement>('[role="math"]');
    expect(widget).not.toBeNull();

    for (const key of ["Backspace", "Delete"]) {
      widget!.focus();
      widget!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).toBe(source);
    }
  });

  it.each([
    ["inline", "$x^2$"],
    ["block", "$$\nx^2\n$$"],
  ])("deletes an editable %s formula as one undoable edit", (_presentation, source) => {
    const view = mountMarkdown(source);
    const widget = view.dom.querySelector<HTMLElement>('[role="math"]');
    expect(widget).not.toBeNull();
    widget!.focus();
    widget!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
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
        markdownLivePreviewExtension("safe", null, "physics.md", null),
      ],
    }),
  });
  mountedViews.push({ parent, view });
  return view;
}
