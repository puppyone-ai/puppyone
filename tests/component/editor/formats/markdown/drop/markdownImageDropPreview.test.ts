/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownCodeMirrorLanguageExtension } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import {
  markdownImageDropPreview,
  resolveMarkdownImageDrop,
} from "../../../../../../src/shared-ui/editor/markdown/features/image/markdownImageDropPreview";
import { getMarkdownInsertBoundaries } from "../../../../../../src/shared-ui/editor/markdown/core/syntax/markdownInsertBoundaries";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); }
  vi.restoreAllMocks();
});
function fixture(doc = "alpha\n\nbeta") {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [markdownCodeMirrorLanguageExtension(), markdownImageDropPreview] }) });
  views.push(view);
  vi.spyOn(view, "documentTop", "get").mockReturnValue(0);
  vi.spyOn(view, "scaleX", "get").mockReturnValue(1);
  vi.spyOn(view, "scaleY", "get").mockReturnValue(1);
  view.dom.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
  view.scrollDOM.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
  view.contentDOM.getBoundingClientRect = () => new DOMRect(20, 10, 360, 170);
  vi.spyOn(view, "lineBlockAt").mockImplementation((position) => {
    const line = view.state.doc.lineAt(position);
    const top = 10 + (line.number - 1) * 30;
    return { from: line.from, to: line.to, top, bottom: top + 20, height: 20 } as ReturnType<EditorView["lineBlockAt"]>;
  });
  return view;
}

describe("image paragraph drop preview", () => {
  it.each([25, 45, 75])("resolves paragraph after/before/gap to the same boundary at y=%s", (y) => {
    const view = fixture();
    expect(resolveMarkdownImageDrop(view, { x: 250, y })).toMatchObject({ position: 5, clientY: 50 });
  });
  it("uses paragraph boundaries even beside text, not the old caret", () => {
    const view = fixture();
    view.dispatch({ selection: { anchor: 9 } });
    expect(resolveMarkdownImageDrop(view, { x: 390, y: 15 })?.position).toBe(0);
    expect(resolveMarkdownImageDrop(view, { x: 20, y: 150 })?.position).toBe(view.state.doc.length);
  });
  it("supports an empty document", () => {
    const view = fixture("");
    expect(resolveMarkdownImageDrop(view, { x: 200, y: 100 })?.position).toBe(0);
  });
  it("places the first and last marker beside the block, preserving outer blank lines", () => {
    const view = fixture("\n\nalpha\n\n");
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 70 })?.position).toBe(2);
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 120 })?.position).toBe(7);
  });
  it.each(["    code\n    more", "  indented paragraph"])("keeps indentation with the block when inserting before %s", (doc) => {
    const view = fixture(doc);
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 15 })?.position).toBe(0);
  });
  it("locks the last painted anchor if layout changes just before release", () => {
    const view = fixture();
    const preview = view.plugin(markdownImageDropPreview)!;
    const point = { x: 250, y: 75 };
    preview.preview(point);
    vi.mocked(view.lineBlockAt).mockReturnValue({ from: 0, to: 11, top: 100, bottom: 180, height: 80 } as ReturnType<EditorView["lineBlockAt"]>);
    expect(resolveMarkdownImageDrop(view, point)?.position).toBe(0);
    expect(preview.capture(point)?.position).toBe(5);
  });
  it("never invents a visible marker for an offscreen boundary of a tall paragraph", () => {
    const view = fixture("A tall paragraph");
    vi.mocked(view.lineBlockAt).mockReturnValue({ from: 0, to: 16, top: -100, bottom: 900, height: 1000 } as ReturnType<EditorView["lineBlockAt"]>);
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 100 })).toBeNull();
  });
  it("does not edit source or selection during hover, and clears the line on cancel", () => {
    const view = fixture();
    const initial = view.state;
    const preview = view.plugin(markdownImageDropPreview)!;
    expect(preview.preview({ x: 250, y: 75 })).toBe(true);
    expect(view.dom.querySelector<HTMLElement>(".cm-md-image-drop-indicator")?.hidden).toBe(false);
    expect(view.state).toBe(initial);
    preview.clear();
    expect(view.dom.querySelector<HTMLElement>(".cm-md-image-drop-indicator")?.hidden).toBe(true);
  });
  it.each([
    "alpha\nbeta",
    "- one\n- two\n  - nested",
    "> quote\n>\n> paragraph",
    "```js\none\n\ntwo\n```",
    "| a | b |\n| - | - |\n| c | d |",
    "![a](a.png)",
  ])("keeps the complete Markdown block intact: %s", (doc) => {
    const view = fixture(doc);
    expect(getMarkdownInsertBoundaries(view.state)?.blocks).toEqual([{ from: 0, to: doc.length }]);
  });
  it("keeps YAML metadata ahead of every insertion", () => {
    const view = fixture("---\ntitle: x\n---\n\nbody");
    const boundaries = getMarkdownInsertBoundaries(view.state)!;
    expect(boundaries.blocks).toEqual([{ from: 18, to: 22 }]);
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 20 })?.position).toBeGreaterThanOrEqual(17);
  });
  it.each(["```js\ncode", "<!-- comment", "<script>\ncode"])("does not offer a tail drop swallowed by an unclosed block: %s", (doc) => {
    const view = fixture(doc);
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 150 })).toBeNull();
    expect(resolveMarkdownImageDrop(view, { x: 250, y: 15 })?.position).toBe(0);
  });
});
