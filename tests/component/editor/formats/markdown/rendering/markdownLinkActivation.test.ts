/** @vitest-environment happy-dom */
import { EditorState } from "@codemirror/state";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import type { MarkdownLinkCommands } from "../../../../../../packages/shared-ui/src/editor/registry/viewerTypes";
import { openMarkdownHref } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

describe("Markdown live-preview link activation", () => {
  it("resolves an empty explicit HTML anchor without a mounted target DOM element", () => {
    const source = '[Jump](#target)\n\n<a id="target"></a>\n\nBody';
    const view = createView(source, {});
    expect(getLink(view).dataset.mdLinkInteraction).toBe("navigate");
    expect(view.contentDOM.querySelector("#md-doc-target")).toBeNull();
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    try {
      expect(openMarkdownHref("#target", view)).toBe(true);
      expect(scroll).toHaveBeenCalledWith(source.indexOf("<a"), { y: "start" });
    } finally {
      scroll.mockRestore();
    }
  });

  it("updates remote link affordances when a target is removed and restored", () => {
    const source = '[Jump](#target)\n\nUnrelated paragraph\n\nMore body\n\n<a id="target"></a>';
    const view = createView(source, {});
    const from = source.indexOf('id="target"') + 4;
    view.dispatch({ changes: { from, to: from + 6, insert: "renamed" } });
    expect(getLink(view).dataset.mdLinkInteraction).toBe("unavailable");
    expect(openMarkdownHref("#target", view)).toBe(false);
    view.dispatch({ changes: { from, to: from + 7, insert: "target" } });
    expect(getLink(view).dataset.mdLinkInteraction).toBe("navigate");
    expect(openMarkdownHref("#target", view)).toBe(true);
  });

  it("updates a visible link when parsing reaches a target outside the viewport", () => {
    const source = '[Jump](#target)\n\n' + 'Unrelated paragraph.\n\n'.repeat(400) + '<a id="target"></a>';
    const view = createView(source, {});
    expect(syntaxTree(view.state).length).toBeLessThan(source.length);
    expect(getLink(view).dataset.mdLinkInteraction).toBe("unavailable");
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    expect(getLink(view).dataset.mdLinkInteraction).toBe("navigate");
    expect(openMarkdownHref("#target", view)).toBe(true);
  });

  it.each(['[Jump](#target)', '[[#target]]', '<a href="#target">Jump</a>'])(
    "routes %s through the same explicit target resolver",
    (linkSource) => {
      const source = `${linkSource}\n\n<a id="target"></a>`;
      const view = createView(source, {});
      const link = view.contentDOM.querySelector<HTMLElement>('[data-md-link-interaction="navigate"]')!;
      expect(link).not.toBeNull();
      const scroll = vi.spyOn(EditorView, "scrollIntoView");
      try {
        link.focus();
        link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        expect(scroll).toHaveBeenCalledExactlyOnceWith(source.lastIndexOf('<a id='), { y: "start" });
      } finally {
        scroll.mockRestore();
      }
    },
  );

  it("projects navigation semantics from the same executable policy used by events", () => {
    const view = createView([
      "[Section](#section)",
      "[Missing heading](#missing)",
      "[Workspace](target.md)",
      "[Missing file](missing.md)",
      "[External](https://example.com)",
      "",
      "# Section",
    ].join("\n"), {
      openWikiLink: vi.fn(),
      openExternalUrl: vi.fn(),
    });

    const links = [...view.dom.querySelectorAll<HTMLElement>(".cm-md-link-label")];
    expect(links.map((link) => link.dataset.mdLinkInteraction)).toEqual([
      "navigate",
      "unavailable",
      "navigate",
      "unavailable",
      "navigate",
    ]);
    expect(links[0]?.getAttribute("role")).toBe("link");
    expect(links[0]?.getAttribute("tabindex")).toBe("0");
    expect(links[1]?.hasAttribute("role")).toBe(false);
    expect(links[1]?.hasAttribute("tabindex")).toBe(false);
    expect(links[1]?.dataset.mdLinkUnavailableReason).toBe("unresolved");
  });

  it("does not let a standalone pointer click bypass gesture validation", async () => {
    const openExternalUrl = vi.fn();
    const view = createView("[External](https://example.com)", { openExternalUrl });

    getLink(view).dispatchEvent(mouse("click", 10, 10, 1));
    await Promise.resolve();

    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("keeps drag and range-selection gestures in editing mode", async () => {
    const openExternalUrl = vi.fn();
    const view = createView("[External](https://example.com) and body", { openExternalUrl });
    let link = getLink(view);

    link.dispatchEvent(preventedMouse("mousedown", 10, 10));
    link.dispatchEvent(preventedMouse("mousemove", 30, 10));
    link.dispatchEvent(preventedMouse("mouseup", 30, 10));
    await Promise.resolve();
    expect(openExternalUrl).not.toHaveBeenCalled();

    link = getLink(view);
    link.dispatchEvent(preventedMouse("mousedown", 10, 10));
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    link = getLink(view);
    link.dispatchEvent(preventedMouse("mouseup", 10, 10));
    await Promise.resolve();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("switches a link from navigation to text editing while its source range owns the caret", async () => {
    const view = createView("[External](https://example.com) and body", {
      openExternalUrl: vi.fn(),
    });
    view.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    view.dispatch({ selection: { anchor: 3 } });
    let link = getLink(view);
    expect(link.dataset.mdLinkInteraction).toBe("edit");
    expect(link.hasAttribute("role")).toBe(false);
    expect(link.hasAttribute("tabindex")).toBe(false);

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    link = getLink(view);
    expect(link.dataset.mdLinkInteraction).toBe("navigate");
    expect(link.getAttribute("role")).toBe("link");
  });

  it("keeps Enter as editing unless the rendered link itself owns keyboard focus", async () => {
    const openExternalUrl = vi.fn();
    const view = createView("[External](https://example.com)", { openExternalUrl });
    const link = getLink(view);

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    expect(openExternalUrl).not.toHaveBeenCalled();

    link.focus();
    link.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });
});

function createView(
  source: string,
  linkCommands: MarkdownLinkCommands,
): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const linkGraph = createMarkdownLinkGraph([
    { path: "note.md", name: "note.md", content: source },
    { path: "target.md", name: "target.md", content: "# Target" },
  ]);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", linkGraph, "note.md", null, "", null, "puppy-gfm", linkCommands),
      ],
    }),
  });
  views.push(view);
  return view;
}

function getLink(view: EditorView): HTMLElement {
  const link = view.dom.querySelector<HTMLElement>(".cm-md-link-label");
  if (!link) throw new Error("Markdown link projection did not mount.");
  return link;
}

function mouse(type: string, clientX: number, clientY: number, detail = 0): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    detail,
  });
}

function preventedMouse(type: string, clientX: number, clientY: number): MouseEvent {
  const event = mouse(type, clientX, clientY);
  event.preventDefault();
  return event;
}
