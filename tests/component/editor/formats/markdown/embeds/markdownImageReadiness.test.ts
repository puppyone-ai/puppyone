/**
 * @vitest-environment happy-dom
 */
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownLivePreviewContextExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { markdownLivePreviewFocusEffect } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";
import { markdownRevealedSourceField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/revealedSource";
import { ImagePreviewWidget } from "../../../../../../packages/shared-ui/src/editor/markdown/features/image/imagePreviewWidget";
import { disposeMarkdownEmbedHost } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewCoreExtension,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import type { MarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/registry/viewerTypes";

const mounted: Array<{
  widget: ImagePreviewWidget;
  wrapper: HTMLElement;
}> = [];
const views = new Set<EditorView>();

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    if (!entry) continue;
    entry.widget.destroy(entry.wrapper);
    entry.wrapper.remove();
  }
  for (const view of views) {
    view.destroy();
    disposeMarkdownEmbedHost(view);
  }
  views.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Markdown image readiness", () => {
  it("applies the same brokered HTTPS privacy attributes to native Markdown images", async () => {
    const source = "![Docs](https://img.shields.io/badge/Docs-Read-blue)";
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/should-not-be-used");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdownLivePreviewContextExtension(
            "safe",
            null,
            "README.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);
    const widget = new ImagePreviewWidget(
      0,
      source.length,
      "Docs",
      "https://img.shields.io/badge/Docs-Read-blue",
      null,
      "README.md",
    );
    const wrapper = widget.toDOM(view);
    document.body.appendChild(wrapper);
    mounted.push({ widget, wrapper });

    await waitFor(() => wrapper.querySelector("img") !== null);

    const image = wrapper.querySelector<HTMLImageElement>("img");
    expect(resolveAssetUrl).not.toHaveBeenCalled();
    expect(image?.getAttribute("src")).toBe("https://img.shields.io/badge/Docs-Read-blue");
    expect(image?.referrerPolicy).toBe("no-referrer");
    expect(image?.crossOrigin).toBe("anonymous");
    expect(image?.loading).toBe("lazy");
    expect(image?.decoding).toBe("async");
  });

  it("promotes a standalone raw HTML image to the brokered safe-media block", async () => {
    const source = [
      "文件系统-based context workspace",
      '<img src="asserts/Screenshot 2026-07-15 at 10.07.43 PM.png" alt="Context Base" width="600">',
      "版本管理，diff",
    ].join("\n");
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/context-base");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "Puppyone — One Pager.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => (
      view.dom.querySelector<HTMLImageElement>(".cm-md-html-rendered-surface img")
        ?.getAttribute("src") === "blob:https://app/context-base"
    ));

    const image = view.dom.querySelector<HTMLImageElement>(".cm-md-html-rendered-surface img");
    expect(image?.alt).toBe("Context Base");
    expect(image?.width).toBe(600);
    expect(resolveAssetUrl).toHaveBeenCalledWith(
      "Puppyone — One Pager.md",
      "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png",
      expect.any(AbortSignal),
    );
  });

  it("edits a standalone raw HTML image through the canonical source", async () => {
    const source = [
      "Before",
      '<img src="assets/context.png" alt="Context Base" width="600">',
      "After",
    ].join("\n");
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/editable-context-base");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-html-rendered-surface img") !== null);
    const sourceButton = view.dom.querySelector<HTMLButtonElement>(".cm-md-html-source-toggle");
    if (!sourceButton) throw new Error("HTML image source button did not mount.");
    sourceButton.click();
    await Promise.resolve();

    const imageLine = view.state.doc.line(2);
    expect(view.state.field(markdownRevealedSourceField)).toEqual({
      from: imageLine.from,
      to: imageLine.to,
      presentation: "block",
    });
    const widthFrom = view.state.doc.toString().indexOf("600", imageLine.from);
    view.dispatch({
      changes: { from: widthFrom, to: widthFrom + 3, insert: "800" },
      selection: EditorSelection.cursor(widthFrom + 3),
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toContain('width="800"');
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(0) });
    await waitFor(() => view.dom.querySelector<HTMLImageElement>(".cm-md-html-rendered-surface img")?.width === 800);
    expect(view.state.field(markdownRevealedSourceField)).toBeNull();
  });

  it("resolves Obsidian image embeds through the workspace link graph", async () => {
    const source = "![[diagram.png]]";
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/wiki-diagram");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            createLinkGraph(1, "assets/diagram.png"),
            "notes/note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-image-widget img") !== null);

    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(resolveAssetUrl).toHaveBeenCalledWith(
      "notes/note.md",
      "/assets/diagram.png",
      expect.any(AbortSignal),
    );
  });

  it("keeps the loading placeholder until the brokered image has loaded and decoded", async () => {
    const source = "![diagram](assets/diagram.png)";
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/diagram");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdownLivePreviewContextExtension(
            "safe",
            null,
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);
    const widget = new ImagePreviewWidget(
      0,
      source.length,
      "diagram",
      "assets/diagram.png",
      null,
      "note.md",
    );
    const wrapper = widget.toDOM(view);
    document.body.appendChild(wrapper);
    mounted.push({ widget, wrapper });

    await waitFor(() => wrapper.querySelector("img") !== null);

    const image = wrapper.querySelector<HTMLImageElement>("img");
    if (!image) throw new Error("Brokered Markdown image did not mount.");
    expect(resolveAssetUrl).toHaveBeenCalledWith("note.md", "assets/diagram.png", expect.any(AbortSignal));
    expect(image.getAttribute("src")).toBe("blob:https://app/diagram");
    expect(image.hidden).toBe(true);
    expect(image.dataset.previewState).toBe("loading");
    expect(image.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.querySelector(".cm-md-image-placeholder")).not.toBeNull();

    Object.defineProperty(image, "decode", { configurable: true, value: undefined });
    image.dispatchEvent(new Event("load"));

    expect(image.hidden).toBe(false);
    expect(image.dataset.previewState).toBe("ready");
    expect(image.hasAttribute("aria-hidden")).toBe(false);
    expect(wrapper.querySelector(".cm-md-image-placeholder")).toBeNull();
  });

  it("keeps one mounted image session when an adjacent paragraph shifts its source range", async () => {
    const source = "Intro paragraph\n![diagram](assets/diagram.png)\nTail";
    const revoke = vi.fn();
    const resolveAssetUrl = vi.fn(async () => ({
      url: "blob:https://app/stable-diagram",
      revoke,
    }));
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-image-widget img") !== null);
    const wrapperBefore = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const imageBefore = wrapperBefore?.querySelector<HTMLImageElement>("img");
    if (!wrapperBefore || !imageBefore) throw new Error("Markdown image widget did not mount.");

    Object.defineProperty(imageBefore, "decode", { configurable: true, value: undefined });
    imageBefore.dispatchEvent(new Event("load"));
    expect(imageBefore.dataset.previewState).toBe("ready");
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);

    view.dispatch({ changes: { from: 5, to: 5, insert: " updated" } });
    await waitFor(() => view.dom.querySelector(".cm-md-image-widget") !== null);

    const wrapperAfter = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const imageAfter = wrapperAfter?.querySelector<HTMLImageElement>("img");
    expect(wrapperAfter).toBe(wrapperBefore);
    expect(imageAfter).toBe(imageBefore);
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();

    wrapperAfter?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    const shiftedSource = view.state.doc.toString();
    const expectedFrom = shiftedSource.indexOf("![diagram]");
    expect(view.state.selection.main.from).toBe(expectedFrom + 2);
    expect(view.state.selection.main.to).toBe(expectedFrom + 2);
    expect(view.dom.querySelector(".cm-md-image-widget")).toBeNull();
  });

  it("keeps the decoded image and asset lease when a pointer selection crosses its line", async () => {
    const source = "Before text\n![diagram](assets/diagram.png)\nAfter text";
    const imageFrom = source.indexOf("![diagram]");
    const imageTo = imageFrom + "![diagram](assets/diagram.png)".length;
    const revoke = vi.fn();
    const resolveAssetUrl = vi.fn(async () => ({
      url: "blob:https://app/selection-stable-diagram",
      revoke,
    }));
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-image-widget img") !== null);
    const wrapperBefore = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const imageBefore = wrapperBefore?.querySelector<HTMLImageElement>("img");
    if (!wrapperBefore || !imageBefore) throw new Error("Markdown image widget did not mount.");
    Object.defineProperty(imageBefore, "decode", { configurable: true, value: undefined });
    imageBefore.dispatchEvent(new Event("load"));
    expect(imageBefore.dataset.previewState).toBe("ready");

    view.dispatch({ effects: markdownLivePreviewFocusEffect.of(true) });
    view.dispatch({ selection: EditorSelection.cursor(imageFrom - 2) });
    view.dispatch({
      selection: EditorSelection.range(imageFrom - 2, imageTo),
      userEvent: "select.pointer",
    });
    view.dispatch({
      selection: EditorSelection.range(imageFrom - 2, imageTo + 2),
      userEvent: "select.pointer",
    });
    await Promise.resolve();

    const wrapperAfter = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const imageAfter = wrapperAfter?.querySelector<HTMLImageElement>("img");
    expect(wrapperAfter).toBe(wrapperBefore);
    expect(imageAfter).toBe(imageBefore);
    expect(imageAfter?.dataset.previewState).toBe("ready");
    expect(wrapperAfter?.querySelector(".cm-md-image-placeholder")).toBeNull();
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("owns image mousedown before CodeMirror can reveal the replaced Markdown source", async () => {
    const source = "Before\n![diagram](assets/diagram.png)\nAfter";
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/pointer-stable-diagram");
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-image-widget img") !== null);
    const wrapper = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const image = wrapper?.querySelector<HTMLImageElement>("img");
    if (!wrapper || !image) throw new Error("Markdown image widget did not mount.");
    Object.defineProperty(image, "decode", { configurable: true, value: undefined });
    image.dispatchEvent(new Event("load"));

    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    wrapper.dispatchEvent(down);
    wrapper.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    }));

    expect(down.defaultPrevented).toBe(true);
    expect(view.dom.querySelector(".cm-md-image-widget")).toBe(wrapper);
    expect(wrapper.querySelector("img")).toBe(image);
    expect(wrapper.textContent).not.toContain("Loading image");
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " edited" },
      userEvent: "input.type",
    });
    expect(view.dom.querySelector(".cm-md-image-widget")).toBe(wrapper);
    expect(wrapper.querySelector("img")).toBe(image);
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps the decoded image mounted when a link-index refresh reconfigures preview context", async () => {
    const source = "![diagram](assets/diagram.png)";
    const resolveAssetUrl = vi.fn(async () => "blob:https://app/context-stable-diagram");
    const context = new Compartment();
    const editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    const view = new EditorView({
      parent: editorParent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          context.of(markdownLivePreviewContextExtension(
            "safe",
            createLinkGraph(1),
            "note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          )),
          markdownLivePreviewCoreExtension(),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-image-widget img") !== null);
    const wrapper = view.dom.querySelector<HTMLElement>(".cm-md-image-widget");
    const image = wrapper?.querySelector<HTMLImageElement>("img");
    if (!wrapper || !image) throw new Error("Markdown image widget did not mount.");
    Object.defineProperty(image, "decode", { configurable: true, value: undefined });
    image.dispatchEvent(new Event("load"));

    view.dispatch({
      effects: context.reconfigure(markdownLivePreviewContextExtension(
        "safe",
        createLinkGraph(2),
        "note.md",
        resolveAssetUrl,
        "workspace:test",
        "/workspace",
      )),
    });

    expect(view.dom.querySelector(".cm-md-image-widget")).toBe(wrapper);
    expect(wrapper.querySelector("img")).toBe(image);
    expect(image.dataset.previewState).toBe("ready");
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
  });
});

function createLinkGraph(documentCount: number, resolvedPath: string | null = null): MarkdownLinkGraph {
  return {
    revision: documentCount,
    documentCount,
    indexedDocumentCount: documentCount,
    resolveWikiLink: (_sourcePath, target) => ({
      exists: Boolean(resolvedPath),
      ambiguous: false,
      path: resolvedPath,
      name: target,
      displayName: target,
      target,
    }),
    resolveMarkdownLink: () => null,
  };
}

async function waitFor(assertion: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for Markdown image state.");
}
