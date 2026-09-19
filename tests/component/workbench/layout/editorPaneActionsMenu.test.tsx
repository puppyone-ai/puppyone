/** @vitest-environment happy-dom */
import { EMPTY_EDITOR_GROUP, EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT, createEditorInput, createEditorPaneLayout, openEditor, type DataNode } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Window as HappyWindow } from "happy-dom";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPaneMenu(handle: HTMLButtonElement) {
  await act(async () => handle.click());
}

describe("Editor pane actions menu", () => {
  it("reduces a resource-only pane menu to two icon actions without headings or a filename", async () => {
    const path = "009_Bauhaus.png";
    const node = {
      id: path,
      path,
      name: path,
      type: "image",
      mimeType: "image/png",
      source: "local",
    } satisfies DataNode;
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const openExternal = vi.fn();
    const closePane = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(withTestLocalization(
      <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
        aiEditRequest={null}
        dataPort={{
          listChildren: async () => [node],
          getFileUrl: async () => `blob:${path}`,
        }}
        editorGroup={group}
        editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
        externalOpen={{ open: openExternal }}
        editorTree={[node]}
        fileIconTheme="default"
        layout={createEditorPaneLayout(path)}
        markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onClosePane={closePane}
        onFocusPane={vi.fn()}
        onMovePane={vi.fn()}
        onOpenAtPaneEdge={vi.fn()}
        onResizeSplit={vi.fn()}
        onSplitPane={vi.fn()}
      />,
    )));

    const handle = container.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    await openPaneMenu(handle);
    const menu = document.querySelector<HTMLElement>(".desktop-editor-pane-menu")!;
    expect(menu.style.width).toBe("63px");
    const actions = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    expect(menu.dataset.hasSecondary).toBeUndefined();
    expect(menu.textContent).toBe("");
    expect(actions).toHaveLength(2);
    expect(actions.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Open in default app",
      "Close editor pane",
    ]);
    expect(menu.querySelector(".desktop-menu-section")).toBeNull();

    const closeAction = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close editor pane"]',
    );
    await act(async () => closeAction?.click());
    expect(closePane).toHaveBeenCalledWith("editor-pane-1");
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();
  });

  it("keeps PDF controls in pane chrome instead of rendering a Viewer header", async () => {
    (window as unknown as HappyWindow).happyDOM.settings.disableIframePageLoading = true;
    vi.spyOn(window.console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      headers: { "content-type": "application/pdf", "content-length": "1024" },
    })));
    const path = "report.pdf";
    const node = {
      id: path,
      path,
      name: path,
      type: "pdf",
      mimeType: "application/pdf",
      source: "local",
    } satisfies DataNode;
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const openExternal = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(withTestLocalization(
      <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
        aiEditRequest={null}
        dataPort={{
          listChildren: async () => [node],
          getFileUrl: async () => "puppyone-local://file/workspace/file-preview/report.pdf",
        }}
        editorGroup={group}
        editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
        externalOpen={{ open: openExternal }}
        editorTree={[node]}
        fileIconTheme="default"
        layout={createEditorPaneLayout(path)}
        markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onClosePane={vi.fn()}
        onFocusPane={vi.fn()}
        onMovePane={vi.fn()}
        onOpenAtPaneEdge={vi.fn()}
        onResizeSplit={vi.fn()}
        onSplitPane={vi.fn()}
      />,
    )));

    await waitForCondition(() => container.querySelector(".pdf-preview-frame") !== null);
    expect(container.querySelector(".pdf-preview-actions")).toBeNull();
    expect(container.querySelector(".pdf-preview-shell > button")).toBeNull();

    const handle = container.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    await openPaneMenu(handle);
    await waitForCondition(() => document.querySelector(".desktop-editor-pane-menu") !== null);
    const menu = document.querySelector<HTMLElement>(".desktop-editor-pane-menu")!;
    const primaryLabels = Array.from(menu.querySelectorAll<HTMLButtonElement>(
      ".desktop-editor-pane-menu-primary-action",
    )).map((item) => item.getAttribute("aria-label"));
    expect(primaryLabels).toEqual(["Open in default app", "Close editor pane"]);
    expect(menu.textContent).toContain("Reload page");

    const firstFrame = container.querySelector(".pdf-preview-frame");
    const reload = Array.from(menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]"))
      .find((item) => item.textContent === "Reload page");
    await act(async () => reload?.click());
    await waitForCondition(() => container.querySelector(".pdf-preview-frame") !== firstFrame);

    await openPaneMenu(handle);
    await waitForCondition(() => document.querySelector(".desktop-editor-pane-menu") !== null);
    const external = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open in default app"]',
    );
    await act(async () => external?.click());
    expect(openExternal).toHaveBeenCalledWith(path);
  });
});

async function waitForCondition(condition: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for editor pane action state.");
}
