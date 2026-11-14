/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEditorView } from "../../../support/editor/editorView";
import { withTestLocalization } from "../../../support/react/localization";
import { DocumentSessionBoundary } from "../../../../src/shared-ui/editor/document-session/DocumentSessionBoundary";
import { closeDocumentWorkingCopy } from "../../../../src/shared-ui/editor/document-session/documentWorkingCopies";
import {
  EditorPaneMenuContributionProvider,
  type EditorPaneMenuContribution,
  type EditorPaneMenuToggle,
} from "../../../../src/shared-ui/editor/editorPaneMenuContribution";
import { HtmlViewer } from "../../../../src/shared-ui/editor/viewers/html/HtmlViewer";
import { MarkdownViewer } from "../../../../src/shared-ui/editor/markdown/MarkdownViewer";
import { DEFAULT_EDITOR_INTERACTION_PREFERENCES } from "../../../../src/shared-ui/editor/registry/viewerTypes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;
let contribution: EditorPaneMenuContribution | null = null;
const storageIdentity = "test:document-source-panel";

afterEach(async () => {
  await act(async () => closeDocumentWorkingCopy({ storageIdentity, resourcePath: contribution?.documentId ?? "" }));
  act(() => root?.unmount());
  root = null;
  contribution = null;
  document.body.innerHTML = "";
});

async function mount(path: string, content: string, viewer: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const persist = vi.fn(async () => ({ ok: true as const, version: "v2" }));
  await act(async () => root?.render(withTestLocalization(
    <DocumentSessionBoundary documentId={path} initialContent={content} initialVersion="v1" saveMode="manual"
      persistence={{ kind: "local-fs", storageIdentity, persist }}>
      <EditorPaneMenuContributionProvider onContributionChange={(value) => { contribution = value; }}>
        {viewer}
      </EditorPaneMenuContributionProvider>
    </DocumentSessionBoundary>,
  )));
  await settle();
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

function toggle(id: string): EditorPaneMenuToggle {
  const item = contribution?.viewItems.find((candidate) => candidate.id === id);
  if (item?.kind !== "toggle") throw new Error(`No ${id} switch was offered.`);
  return item;
}

async function press(id: string) {
  await act(async () => toggle(id).setChecked(!toggle(id).checked));
  await settle();
}

const sourcePanelEditor = () => {
  const element = container.querySelector<HTMLElement>(".document-source-split__source .cm-editor");
  return element ? requireEditorView(element) : null;
};

const typeAtEnd = (view: ReturnType<typeof requireEditorView>, text: string) => act(() => {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
});

describe("a page with its source in a panel beside it", () => {
  describe("HTML", () => {
    const page = (canEdit = true) => (
      <HtmlViewer document={{ path: "page.html", name: "page.html", type: "html", version: "v1" }}
        content="<h1>Page</h1>" fileUrl={null} fileUrlLoading={false} fileUrlError={null} loading={false} error={null}
        htmlTrustMode="safe" canEdit={canEdit} hideSourceView={false} documentControls="edit-and-source-panel" />
    );

    it("offers Edit and the source panel as switches instead of a view menu, and opens on the page", async () => {
      await mount("page.html", "<h1>Page</h1>", page());

      expect(contribution?.viewItems.map((item) => [item.id, item.kind])).toEqual([
        ["document-editing", "toggle"],
        ["document-source-panel", "toggle"],
      ]);
      expect(toggle("document-editing")).toMatchObject({ checked: false, icon: expect.anything() });
      expect(toggle("document-source-panel")).toMatchObject({ checked: false, icon: expect.anything() });
      expect(container.querySelector(".html-visual-editor")).toBeNull();
      expect(container.querySelector(".document-source-split__source")).toBeNull();
    });

    it("opens the source beside the page, and keeps the page while editing it", async () => {
      await mount("page.html", "<h1>Page</h1>", page());

      await press("document-source-panel");
      expect(toggle("document-source-panel").checked).toBe(true);
      expect(container.querySelector(".document-source-split__page")).not.toBeNull();
      expect(container.querySelector('.document-source-split__divider[role="separator"]')).not.toBeNull();
      const source = sourcePanelEditor();
      expect(source?.state.doc.toString()).toBe("<h1>Page</h1>");

      await press("document-editing");
      expect(toggle("document-editing").checked).toBe(true);
      // Visual editing on the page, the same text still open beside it.
      expect(sourcePanelEditor()).toBe(source);

      await press("document-source-panel");
      expect(container.querySelector(".document-source-split__source")).toBeNull();
    });

    it("leaves Edit out for a page that cannot be changed", async () => {
      await mount("page.html", "<h1>Page</h1>", page(false));
      expect(contribution?.viewItems.map((item) => item.id)).toEqual(["document-source-panel"]);
    });
  });

  describe("Markdown", () => {
    const note = () => (
      <MarkdownViewer document={{ path: "plan.md", name: "plan.md", type: "markdown", version: "v1" }}
        content={"# Plan\n"} canEdit hideSourceView={false} documentControls="edit-and-source-panel"
        editorInteractionPreferences={DEFAULT_EDITOR_INTERACTION_PREFERENCES} htmlTrustMode="safe" />
    );
    const page = () => container.querySelector<HTMLElement>(".document-source-split__page .markdown-codemirror-editor");

    it("opens to read, and edits once Edit is on", async () => {
      await mount("plan.md", "# Plan\n", note());

      expect(contribution?.viewItems.map((item) => item.id)).toEqual(["document-editing", "document-source-panel"]);
      expect(page()?.dataset.readonly).toBe("true");
      await press("document-editing");
      expect(page()?.dataset.readonly).toBe("false");
    });

    it("keeps the page and its source panel on one text", async () => {
      await mount("plan.md", "# Plan\n", note());
      await press("document-source-panel");
      const pageView = requireEditorView(page()!.querySelector<HTMLElement>(".cm-editor")!);
      const source = sourcePanelEditor()!;
      expect(source.state.doc.toString()).toBe("# Plan\n");

      // The page only reads, but the source edits, and the page shows it.
      typeAtEnd(source, "From the source.");
      expect(pageView.state.doc.toString()).toBe("# Plan\nFrom the source.");

      await press("document-editing");
      typeAtEnd(pageView, "\nFrom the page.");
      expect(source.state.doc.toString()).toBe("# Plan\nFrom the source.\nFrom the page.");
    });
  });
});
