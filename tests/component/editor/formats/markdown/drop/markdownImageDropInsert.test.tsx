/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  insertMarkdownImageAt,
  resolveDropInsertPosition,
} from "../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";

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

describe("resolveDropInsertPosition", () => {
  function viewOf(doc: string, overrides: { coordinate?: number | null; contentBottom?: number } = {}) {
    const base = viewOfDocument(doc);
    return Object.assign(base, overrides);
  }
  function viewOfDocument(doc: string) {
    return {
      state: { doc: { length: doc.length }, selection: { main: { from: 3 } } },
      contentDOM: { getBoundingClientRect: () => new DOMRect(0, 0, 600, 100) },
      posAtCoords: harnessCoordinate,
    } as never;
  }
  let harnessCoordinate: (point: { x: number; y: number }) => number | null = () => null;

  it("uses the caret when no drop point was recorded", () => {
    harnessCoordinate = () => null;
    expect(resolveDropInsertPosition(viewOf("abcdef"), null)).toBe(3);
  });

  it("uses the coordinate when the view can map it", () => {
    harnessCoordinate = () => 5;
    expect(resolveDropInsertPosition(viewOf("abcdef"), { x: 40, y: 20 })).toBe(5);
  });

  it("appends at the end when the pointer is below the last line", () => {
    harnessCoordinate = () => null;
    expect(resolveDropInsertPosition(viewOf("abcdef"), { x: 40, y: 240 })).toBe(6);
  });

  it("keeps the caret inside the text area", () => {
    harnessCoordinate = () => null;
    expect(resolveDropInsertPosition(viewOf("abcdef"), { x: 40, y: 40 })).toBe(3);
  });
});
