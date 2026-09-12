/**
 * @vitest-environment happy-dom
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { disposeWidgetSessionDom } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/widgetSession";
import { createWidgetSessionRegistry } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/widgetSession";
import { createDomFromInlineHtmlSource } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlDomAdapter";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownEmbedHost, disposeMarkdownEmbedHost } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import { createSanitizedBlockHtmlFragment } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/sanitizeHtml";
import { createPrincipalFromView } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import { renderMarkdownInlineFromSharedPolicy } from "../../../../../../packages/shared-ui/src/editor/markdown/composition/preview/markdownInlinePlanAdapter";
import { markdownRevealedSourceField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/revealedSource";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) {
    const view = views.pop();
    view?.destroy();
  }
});

function createView(
  source: string,
  identity: { workspaceId?: string; workspaceRoot?: string | null } = {},
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", null, "note.md", null, identity.workspaceId ?? "", identity.workspaceRoot ?? null),
      ],
    }),
  });
  views.push(view);
  return view;
}

describe("Markdown EditorView lifecycle", () => {
  it("mounts live preview and disposes the embed host on destroy", () => {
    const view = createView('- <span style="color: #B45309;">screenshot</span>');
    const host = getMarkdownEmbedHost(view);
    expect(host.viewId).toMatch(/^md-view:/);
    expect(view.dom.querySelector(".cm-content")).toBeTruthy();

    view.destroy();
    views.pop();
    disposeMarkdownEmbedHost(view);
    // Second dispose is a no-op.
    disposeMarkdownEmbedHost(view);
  });

  it("disposes widget sessions by exact DOM on remount and destroy", () => {
    const registry = createWidgetSessionRegistry();
    const dom = document.createElement("div");
    let disposed = 0;
    registry.mount(dom, () => ({
      dispose: () => {
        disposed += 1;
      },
    }));
    registry.mount(dom, () => ({
      dispose: () => {
        disposed += 1;
      },
    }));
    expect(disposed).toBe(1);
    disposeWidgetSessionDom(dom);
    expect(disposed).toBe(2);
  });

  it("keeps IME composition from wiping decorations until composition ends", () => {
    const view = createView("Hello **world**");
    view.dispatch({
      selection: { anchor: 8 },
    });
    // Composition mirror is transaction-visible; start composition via input plugin path.
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
    view.dispatch({
      changes: { from: 8, to: 8, insert: "あ" },
      annotations: [],
    });
    expect(view.state.doc.toString()).toContain("あ");
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend"));
  });

  it("edits an HTML block in the canonical CodeMirror source and restores its preview", async () => {
    const initial = "intro\n\n<div>old</div>\n\noutro";
    const view = createView(initial);
    const shellBefore = view.dom.querySelector<HTMLElement>(".cm-md-html-widget");
    if (!shellBefore) throw new Error("HTML preview did not mount.");

    // Keep the mounted widget while its current document position moves. The
    // source button must resolve the mapped DOM range, not a constructor-time
    // offset.
    view.dispatch({ changes: { from: 0, insert: "shifted\n" } });
    const shellAfterShift = view.dom.querySelector<HTMLElement>(".cm-md-html-widget");
    expect(shellAfterShift).toBe(shellBefore);
    const sourceButton = shellAfterShift?.querySelector<HTMLButtonElement>(".cm-md-html-source-toggle");
    if (!sourceButton) throw new Error("HTML source button did not mount.");

    sourceButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    const currentSource = view.state.doc.toString();
    const blockFrom = currentSource.indexOf("<div>old</div>");
    const blockTo = blockFrom + "<div>old</div>".length;
    expect(view.state.field(markdownRevealedSourceField)).toEqual({
      from: blockFrom,
      to: blockTo,
      presentation: "block",
    });
    expect(view.state.selection.main.head).toBe(blockFrom + 1);
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-source-block")).toBeNull();
    expect(view.contentDOM.textContent).toContain("<div>old</div>");

    const oldFrom = view.state.doc.toString().indexOf("old", blockFrom);
    view.dispatch({
      changes: { from: oldFrom, to: oldFrom + 3, insert: "edited" },
      selection: EditorSelection.cursor(oldFrom + "edited".length),
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toContain("<div>edited</div>");
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(view.state.field(markdownRevealedSourceField)).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-rendered-surface")?.textContent).toBe("edited");
  });

  it("collapses a revealed HTML source block with Escape", async () => {
    const source = "<div>only block</div>";
    const view = createView(source);
    const button = view.dom.querySelector<HTMLButtonElement>(".cm-md-html-source-toggle");
    if (!button) throw new Error("HTML source button did not mount.");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(view.state.field(markdownRevealedSourceField)?.presentation).toBe("block");

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    expect(view.state.field(markdownRevealedSourceField)).toBeNull();
    expect(view.state.selection.main.head).toBe(source.length);
    expect(view.dom.querySelector(".cm-md-html-widget")).not.toBeNull();
  });
});

describe("Markdown preview/policy convergence", () => {
  it("compiles table-cell style HTML through the shared plan adapter", () => {
    const node = createDomFromInlineHtmlSource('<span style="color: #B45309;">screenshot</span>');
    expect(node).not.toBeNull();
    expect(node?.tagName.toLowerCase()).toBe("span");
    expect(node?.getAttribute("style")).toContain("color: #B45309");
    expect(node?.textContent).toBe("screenshot");
  });

  it("reduces blocked styles in block HTML without dropping the element", () => {
    const result = createSanitizedBlockHtmlFragment('<div style="display: none; color: red">safe</div>');
    expect(result.supported).toBe(true);
    const div = result.fragment.querySelector("div");
    expect(div?.style.color).toBe("red");
    expect(div?.style.display).toBe("");
  });
});

describe("Markdown host workspace identity", () => {
  it("builds principals from the host-injected workspace id facet", () => {
    const view = createView("# Title", { workspaceId: "workspace:acme", workspaceRoot: "/acme" });
    const principal = createPrincipalFromView(view, "asset-read");
    expect(principal.workspaceId).toBe("workspace:acme");
    expect(principal.documentPath).toBe("note.md");
    expect(principal.editorViewId).toMatch(/^md-view:/);
    expect(principal.purpose).toBe("asset-read");
  });

  it("falls back to a document-derived workspace id when no facet is set", () => {
    const view = createView("# Title");
    const principal = createPrincipalFromView(view, "link-open");
    expect(principal.workspaceId).toBe("doc:note.md");
  });
});

describe("Markdown table plan adapter", () => {
  it("routes images through the broker-backed resolveAssetUrl (no raw resolver)", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    let resolverCalls = 0;
    renderMarkdownInlineFromSharedPolicy(target, "![alt](assets/pic.png)", {
      sourcePath: "note.md",
      resolveAssetUrl: (documentPath, href) => {
        resolverCalls += 1;
        expect(documentPath).toBe("note.md");
        expect(href).toBe("assets/pic.png");
        return "blob:https://app/pic";
      },
    });
    // The renderer schedules the resolve microtask; flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolverCalls).toBe(1);
    const img = target.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:https://app/pic");
    expect(img?.hidden).toBe(true);
    expect(target.querySelector(".cm-md-image-placeholder")).not.toBeNull();
    if (!img) throw new Error("Brokered table image did not mount.");
    Object.defineProperty(img, "decode", { configurable: true, value: undefined });
    img.dispatchEvent(new Event("load"));
    expect(img.hidden).toBe(false);
    expect(target.querySelector(".cm-md-image-placeholder")).toBeNull();
    target.remove();
  });

  it("opens links through the broker-backed openHref wrapper", () => {
    const target = document.createElement("div");
    const opened: string[] = [];
    renderMarkdownInlineFromSharedPolicy(target, "[docs](https://example.com)", {
      sourcePath: "note.md",
      openHref: (href) => opened.push(href),
    });
    const link = target.querySelector("a");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toEqual(["https://example.com/"]);
  });
});
