/** @vitest-environment happy-dom */
import { EMPTY_EDITOR_GROUP, EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT, createEditorInput, createEditorPaneLayout, openEditor, type DataNode } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
