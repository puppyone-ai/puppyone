import { requireEditorView } from "../../../../support/editor/editorView";
/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSessionBoundary } from "../../../../../packages/shared-ui/src/editor/document-session/DocumentSessionBoundary";
import { closeDocumentWorkingCopy } from "../../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { HtmlViewer } from "../../../../../packages/shared-ui/src/editor/viewers/html/HtmlViewer";
import { HtmlPreviewFrame } from "../../../../../packages/shared-ui/src/editor/viewers/html/HtmlPreviewFrame";
import { EditorPreviewServicesBoundary } from "../../../../../packages/shared-ui/src/editor/preview-services/EditorPreviewServices";
import type { DocumentProjectionLease } from "../../../../../packages/shared-ui/src/editor/preview-services/types";
import { EditorPaneMenuContributionProvider, type EditorPaneMenuContribution } from "../../../../../packages/shared-ui/src/editor/editorPaneMenuContribution";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let contribution: EditorPaneMenuContribution | null = null;
const publish = (value: EditorPaneMenuContribution | null) => { contribution = value; };
function modeMenu() {
  const item = contribution?.viewItems[0];
  if (item?.kind !== "segmented") throw new Error("HTML mode menu contribution missing");
  return item;
}
async function selectMode(mode: "preview" | "edit" | "source") {
  await act(async () => modeMenu().setValue(mode));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("HTML interaction and editing", () => {
  it("shows a useful empty page and opens the unchanged source, then renders newly added content", async () => {
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const source = '<!doctype html><html><head><title>Untitled</title></head><body>\n</body></html>';
    await act(async () => root?.render(withTestLocalization(
      <EditorPaneMenuContributionProvider onContributionChange={publish}><HtmlViewer
        document={{ path: "Untitled.html", name: "Untitled.html", type: "html", version: "v1" }}
        content={source} fileUrl={null} fileUrlLoading={false} fileUrlError={null}
        loading={false} error={null} htmlTrustMode="safe" canEdit hideSourceView={false}
      /></EditorPaneMenuContributionProvider>,
    )));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".html-empty-page")?.textContent).toContain("This HTML page is empty");
    await act(async () => container.querySelector<HTMLButtonElement>(".html-empty-page button")?.click());
    const view = requireEditorView(container.querySelector<HTMLElement>(".cm-editor")!);
    expect(view.state.doc.toString()).toBe(source);
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<h1>Now visible</h1>" } }));
    await selectMode("preview");
    for (let i = 0; i < 100 && !container.querySelector("iframe"); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(container.querySelector(".html-empty-page")).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Now visible");
  });
  it("waits for the actual projected page rather than the initial blank iframe load", async () => {
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    let resolve!: (lease: DocumentProjectionLease) => void;
    const close = vi.fn(async () => undefined);
    const services = { documentProjection: { create: vi.fn(() => new Promise<DocumentProjectionLease>((done) => { resolve = done; })) } };
    await act(async () => root?.render(<EditorPreviewServicesBoundary services={services}>
      <HtmlPreviewFrame path="page.html" title="Page" content="<p>Page</p>" htmlTrustMode="safe" interactive />
    </EditorPreviewServicesBoundary>));
    const blank = container.querySelector("iframe")!;
    await act(async () => {
      blank.dispatchEvent(new Event("load"));
      await new Promise((done) => setTimeout(done, 30));
    });
    expect(blank.getAttribute("aria-busy")).toBe("true");
    await act(async () => resolve({ url: "about:blank#projected-page", close }));
    const page = container.querySelector("iframe")!;
    expect(page).not.toBe(blank);
    expect(page.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      page.dispatchEvent(new Event("load"));
      await new Promise((done) => setTimeout(done, 30));
    });
    expect(page.getAttribute("aria-busy")).toBe("false");
    await act(async () => root?.unmount()); root = null;
    expect(close).toHaveBeenCalledOnce();
  });
  it("opens Cloud HTML interactively and keeps source editing available without a native projection service", async () => {
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(withTestLocalization(
      <EditorPaneMenuContributionProvider onContributionChange={publish}><HtmlViewer
        document={{ path: "puppyone-cloud://cloud.example/account/project/page.html", name: "page.html", type: "html", version: "v1", sourceKind: "cloud" }}
        content="<!doctype html><h1>Cloud page</h1>" fileUrl="blob:cloud-version" fileUrlLoading={false}
        fileUrlError={null} loading={false} error={null} htmlTrustMode="safe" canEdit hideSourceView={false}
      /></EditorPaneMenuContributionProvider>,
    )));
    for (let i = 0; i < 100 && !container.querySelector("iframe"); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(container.querySelector(".html-visual-editor")).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(modeMenu().options.map((option) => option.id)).toEqual(["preview", "source"]);
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).not.toContain('href="blob:');
    expect(modeMenu().options.map((option) => option.id)).toContain("source");
    await selectMode("source");
    const view = requireEditorView(container.querySelector<HTMLElement>(".cm-editor")!);
    expect(view.state.doc.toString()).toContain("Cloud page");
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<h1>Edited Cloud page</h1>" } }));
    await selectMode("preview");
    for (let i = 0; i < 100 && !container.querySelector("iframe"); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Edited Cloud page");
    expect(container.querySelector(".html-visual-editor")).toBeNull();
  });
  it("fills the pane and switches between interaction, editing and source through its existing menu", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <EditorPaneMenuContributionProvider onContributionChange={publish}><HtmlViewer
          document={{ path: "page.html", name: "page.html", type: "html", version: "v1" }}
          content={'<!doctype html><h1 id="title">Before</h1><script>window.bad=true</script>'}
          fileUrl="puppyone-local://workspace/page.html?token=test"
          fileUrlLoading={false}
          fileUrlError={null}
          loading={false}
          error={null}
          htmlTrustMode="safe"
          canEdit
          hideSourceView={false}
        /></EditorPaneMenuContributionProvider>,
      ));
      await Promise.resolve();
    });

    for (let attempt = 0; attempt < 100 && !container.querySelector("iframe"); attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(modeMenu().value).toBe("preview");
    expect(container.querySelector(".html-mode-bar,.html-mode-switch")).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("window.bad");
    expect(container.querySelector(".html-visual-editor")).toBeNull();
    await selectMode("edit");
    for (let i = 0; i < 100 && !container.querySelector(".html-visual-editor iframe"); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(modeMenu().value).toBe("edit");
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).not.toContain("window.bad");
    expect(container.querySelector(".html-editor-toolbar")).toBeNull();
    expect(container.querySelector(".html-editor-options")).toBeNull();
    expect(modeMenu().options.map((option) => option.id)).toContain("source");
    await selectMode("source");
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    if (!editorElement) throw new Error("HTML CodeMirror editor did not mount.");
    const editor = requireEditorView(editorElement);
    expect(editor.state.doc.toString()).toContain("Before");
    act(() => editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: "<!doctype html><h1>After</h1><script>window.bad=true</script>" },
      userEvent: "input.type",
    }));

    expect(modeMenu().value).toBe("source");
    await selectMode("edit");
    for (let attempt = 0; attempt < 100 && !container.querySelector("iframe"); attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }

    const frame = container.querySelector<HTMLIFrameElement>("iframe.native-preview-frame");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBeNull();
    expect(frame?.getAttribute("srcdoc")).not.toContain("window.bad");
    expect(frame?.getAttribute("srcdoc")).toContain(">After</h1>");
    await selectMode("preview");
    for (let i = 0; i < 100 && !container.querySelector('[data-html-interactive="true"]'); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain(">After</h1>");
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("window.bad");
  });

  it("keeps standalone mode menus local to each pane and hides unavailable modes", async () => {
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const props = { content: "<p>Page</p>", fileUrlLoading: false, fileUrlError: null, loading: false,
      error: null, htmlTrustMode: "safe" as const, hideSourceView: true };
    await act(async () => root?.render(withTestLocalization(<>
      <HtmlViewer {...props} document={{ path: "one.html", name: "one.html", type: "html", version: "v1" }} canEdit />
      <HtmlViewer {...props} document={{ path: "two.html", name: "two.html", type: "html", version: "v1" }} canEdit={false} />
    </>)));
    const panes = container.querySelectorAll(".html-document-editor");
    expect(panes[1]?.querySelector(".html-editor-options")).toBeNull();
    expect(panes[0]?.querySelector('[data-mode="source"]')).toBeNull();
    act(() => panes[0]?.querySelector("summary")?.click());
    expect(panes[0]?.querySelector("details")?.open).toBe(true);
    await act(async () => panes[0]?.querySelector<HTMLButtonElement>('[data-mode="edit"]')?.click());
    expect(panes[0]?.querySelector('[data-mode="edit"]')?.getAttribute("aria-checked")).toBe("true");
    expect(panes[0]?.querySelector("details")?.open).toBe(false);
    expect(panes[1]?.querySelector(".html-visual-editor")).toBeNull();
  });

  it("keeps the latest source snapshot durable after switching to Preview", async () => {
    const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <DocumentSessionBoundary
          documentId="page.html"
          initialContent="<h1>Before</h1>"
          initialVersion="v1"
          saveMode="manual"
          persistence={{ kind: "local-fs", storageIdentity: "test:html-preview", persist }}
        >
          <EditorPaneMenuContributionProvider onContributionChange={publish}><HtmlViewer
            document={{ path: "page.html", name: "page.html", type: "html", version: "v1" }}
            content="<h1>Before</h1>"
            fileUrl={null}
            fileUrlLoading={false}
            fileUrlError={null}
            loading={false}
            error={null}
            htmlTrustMode="safe"
            canEdit
            hideSourceView={false}
          /></EditorPaneMenuContributionProvider>
        </DocumentSessionBoundary>,
      ));
    });
    expect(container.querySelector(".html-editor-toolbar")).toBeNull();
    expect(container.querySelector(".html-editor-options")).toBeNull();
    expect(modeMenu().options.map((option) => option.id)).toContain("source");
    await selectMode("source");
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    if (!editorElement) throw new Error("HTML CodeMirror editor did not mount.");
    const editor = requireEditorView(editorElement);
    act(() => editor.dispatch({
      changes: { from: 4, to: 10, insert: "After" },
      userEvent: "input.type",
    }));
    await selectMode("preview");
    await act(async () => closeDocumentWorkingCopy({
      storageIdentity: "test:html-preview",
      resourcePath: "page.html",
    }));
    act(() => root?.unmount());
    root = null;
    await act(async () => Promise.resolve());

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      path: "page.html",
      content: "<h1>After</h1>",
      reason: "document-close",
    }));
  });
});
