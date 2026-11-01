/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { findMarkdownLinkTokens } from "../../../../../../src/shared-ui/editor/markdown/core/links/markdownLinkModel";

const IMAGE = "https://example.com/a.png";
const LINK = "https://example.com/page";
const mountedViews: EditorView[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(source: string, openExternalUrl = vi.fn()) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(true),
        markdownLivePreviewExtension(
          "safe",
          null,
          "note.md",
          async () => IMAGE,
          "",
          null,
          "puppy-gfm",
          { openExternalUrl },
        ),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

describe("Markdown image inside a link", () => {
  it("hides the link syntax around a badge image", () => {
    const source = `[![badge](${IMAGE})](${LINK})`;
    const view = mount(source);
    expect(view.contentDOM.textContent).toBe("");
    expect(view.contentDOM.querySelectorAll(".cm-md-image-widget")).toHaveLength(1);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("wraps the image in the link label", () => {
    const view = mount(`[![badge](${IMAGE})](${LINK})`);
    const label = view.contentDOM.querySelector<HTMLElement>(".cm-md-link-label");
    expect(label?.dataset.mdHref).toBe(LINK);
    expect(label?.querySelector(".cm-md-image-widget")).not.toBeNull();
  });

  it("projects a row of badges independently", () => {
    const view = mount(`[![a](${IMAGE})](${LINK}) [![b](${IMAGE})](${LINK}2)`);
    expect(view.contentDOM.textContent?.trim()).toBe("");
    expect(Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-link-label"))
      .map((label) => label.dataset.mdHref)).toEqual([LINK, `${LINK}2`]);
  });

  it("keeps a label that mixes text and an image", () => {
    const view = mount(`[see ![badge](${IMAGE}) here](${LINK})`);
    expect(view.contentDOM.textContent).toBe("see  here");
    expect(view.contentDOM.querySelector(".cm-md-link-label .cm-md-image-widget")).not.toBeNull();
  });

  it("opens the link when the image is clicked", async () => {
    const openExternalUrl = vi.fn();
    const view = mount(`[![badge](${IMAGE})](${LINK})`, openExternalUrl);
    const widget = view.contentDOM.querySelector<HTMLElement>(".cm-md-image-widget");
    widget?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    widget?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    await vi.waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(1));
    expect(openExternalUrl.mock.calls[0]?.[0]).toBe(LINK);
  });

  it("does not treat an image beside a link as a label", () => {
    const view = mount(`![badge](${IMAGE}) [text](${LINK})`);
    expect(view.contentDOM.textContent?.trim()).toBe("text");
    expect(view.contentDOM.querySelector(".cm-md-link-label .cm-md-image-widget")).toBeNull();
  });
});

describe("Markdown link label scanning", () => {
  it("reads a nested image as part of the label", () => {
    const source = `[![badge](${IMAGE})](${LINK})`;
    expect(findMarkdownLinkTokens(source)).toMatchObject([{ from: 0, to: source.length, href: LINK }]);
  });

  it("recovers the inner link after a stray opening bracket", () => {
    const source = `[a[b](${LINK})`;
    expect(findMarkdownLinkTokens(source)).toMatchObject([{ from: 2, to: source.length, label: "b" }]);
  });

  it("does not pair brackets across a line break", () => {
    expect(findMarkdownLinkTokens(`[a\nb](${LINK})`)).toEqual([]);
  });

  it("honours an escaped closing bracket", () => {
    const source = `[a\\]b](${LINK})`;
    expect(findMarkdownLinkTokens(source)).toMatchObject([{ to: source.length, href: LINK }]);
  });

  it("stays linear on a pathological run of opening brackets", () => {
    const source = "[".repeat(200_000);
    const startedAt = performance.now();
    expect(findMarkdownLinkTokens(source)).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
