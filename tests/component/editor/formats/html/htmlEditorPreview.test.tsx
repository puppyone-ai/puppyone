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
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("HTML editor and safe preview", () => {
  it("opens a safe preview and exposes editable Source with the latest snapshot", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(withTestLocalization(
        <HtmlViewer
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
        />,
      ));
      await Promise.resolve();
    });

    for (let attempt = 0; attempt < 100 && !container.querySelector("iframe"); attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    expect(container.querySelector("iframe")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="HTML source"]')?.click());
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    if (!editorElement) throw new Error("HTML CodeMirror editor did not mount.");
    const editor = requireEditorView(editorElement);
    expect(editor.state.doc.toString()).toContain("Before");
    act(() => editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: "<!doctype html><h1>After</h1><script>window.bad=true</script>" },
      userEvent: "input.type",
    }));

    const previewButton = container.querySelector<HTMLButtonElement>('[aria-label="HTML preview"]');
    if (!previewButton) throw new Error("HTML Preview mode button did not mount.");
    await act(async () => previewButton.click());

    const frame = container.querySelector<HTMLIFrameElement>("iframe.native-preview-frame");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame?.getAttribute("src")).toBeNull();
    expect(frame?.getAttribute("srcdoc")).toContain("script-src 'none'");
    expect(frame?.getAttribute("srcdoc")).toContain("<h1>After</h1>");
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
          <HtmlViewer
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
          />
        </DocumentSessionBoundary>,
      ));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="HTML source"]')?.click());
    const editorElement = container.querySelector<HTMLElement>(".cm-editor");
    if (!editorElement) throw new Error("HTML CodeMirror editor did not mount.");
    const editor = requireEditorView(editorElement);
    act(() => editor.dispatch({
      changes: { from: 4, to: 10, insert: "After" },
      userEvent: "input.type",
    }));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="HTML preview"]')?.click());
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
