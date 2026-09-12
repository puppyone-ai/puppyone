import type { DocumentDataNode } from "@puppyone/shared-ui";
import { unavailableDocumentNavigation } from "../../../../support/editor/documentFixtures";
/**
 * @vitest-environment happy-dom
 */
import {
  EMPTY_EDITOR_GROUP,
  assignEditorToActivePane,
  createEditorInput,
  createEditorPaneLayout,
  openEditor,
  splitEditorPane,
  type DataNode,
  type DataWorkspaceState,
} from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopEditorSplitView } from "../../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
});

describe("CSV pane-menu settings", () => {
  it("keeps file, view, and pane actions scoped to the CSV pane", async () => {
    const path = "data.csv";
    const node = {
      id: path,
      path,
      name: path,
      type: "spreadsheet",
      mimeType: "text/csv",
      source: "local",
    } satisfies DataNode;
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const openExternal = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          documentNavigation={unavailableDocumentNavigation}
          dataPort={{
            listChildren: async () => [node],
            readFile: async () => ({
              ...node,
              content: "Name,Score\nAda,1\nLin,2",
              version: "v1",
            }),
          }}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          externalOpen={{ open: openExternal }}
          editorTree={[node]}
          fileIconTheme="default"
          layout={createEditorPaneLayout(path)}
          markdownEnvironment={workspaceState(node).markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      ));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitForCondition(() => container.querySelector(".csv-table-editor") !== null);

    const handle = container.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle");
    expect(handle).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector(".desktop-titlebar-csv-settings")).toBeNull();

    await openPaneMenu(handle!);
    const menu = document.querySelector<HTMLElement>(".desktop-editor-pane-menu");
    expect(menu?.style.width).toBe("196px");
    expect(menu?.textContent).not.toContain("data.csv");
    expect(document.querySelector(".desktop-editor-pane-menu-title")).toBeNull();
    const primaryActions = menu?.querySelectorAll<HTMLButtonElement>(
      ".desktop-editor-pane-menu-primary-action",
    );
    expect(primaryActions).toHaveLength(3);
    expect(Array.from(primaryActions ?? []).map((item) => item.getAttribute("aria-label"))).toEqual([
      "Find in file",
      "Open in default app",
      "Close editor pane",
    ]);
    expect(primaryActions?.item(primaryActions.length - 1).classList.contains(
      "desktop-editor-pane-menu-close-action",
    )).toBe(true);
    expect(Array.from(primaryActions ?? []).every((item) => item.textContent === "")).toBe(true);
    expect(menu?.textContent).not.toContain("Find in file");
    expect(menu?.querySelector('[aria-label="Find in file"]')).not.toBeNull();
    expect(menu?.textContent).toContain("Header row");
    expect(menu?.textContent).toContain("Row numbers");
    expect(menu?.textContent).toContain("Fit columns to viewport");
    expect(menu?.textContent).toContain("Reset column widths");
    expect(menu?.querySelector(".desktop-editor-pane-menu-action-divider")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Find in file");

    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
    })));
    expect(document.activeElement?.textContent).toContain("Reset column widths");
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
    })));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Find in file");

    const toggles = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]');
    expect(toggles).toHaveLength(2);
    expect(toggles?.[0]?.getAttribute("aria-checked")).toBe("true");

    await act(async () => toggles?.[0]?.click());
    expect(container.querySelector(".csv-table-editor__table thead")).toBeNull();
    expect(document.querySelector(".desktop-editor-pane-menu")).not.toBeNull();
    expect(document.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked"))
      .toBe("false");

    const externalItem = menu?.querySelector<HTMLButtonElement>('[aria-label="Open in default app"]');
    await act(async () => externalItem?.click());
    expect(openExternal).toHaveBeenCalledWith(path);
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();

    await openPaneMenu(handle!);
    const findItem = document.querySelector<HTMLButtonElement>('[aria-label="Find in file"]');
    await act(async () => findItem?.click());
    expect(container.querySelector(".editor-find-widget input")).toBeInstanceOf(HTMLInputElement);
  });

  it("binds actions to the clicked CSV pane instead of the globally active file", async () => {
    const nodes = ["left.csv", "right.csv"].map<DocumentDataNode>((path) => ({
      id: path,
      path,
      name: path,
      type: "spreadsheet",
      mimeType: "text/csv",
      source: "local",
    }));
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(nodes[0]!.path));
    group = openEditor(group, createEditorInput(nodes[1]!.path));
    let layout = splitEditorPane(createEditorPaneLayout(nodes[0]!.path), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, nodes[1]!.path);
    const openExternal = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          documentNavigation={unavailableDocumentNavigation}
          dataPort={{
            listChildren: async () => nodes,
            readFile: async (path) => ({
              ...nodes.find((node) => node.path === path)!,
              content: "Name,Score\nAda,1",
              version: `v:${path}`,
            }),
          }}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          externalOpen={{ open: openExternal }}
          editorTree={nodes}
          fileIconTheme="default"
          layout={layout}
          markdownEnvironment={workspaceState(nodes[1]!).markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      ));
    });
    await waitForCondition(() => container.querySelectorAll(".csv-table-editor").length === 2);

    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const leftHandle = panes[0]!.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    await openPaneMenu(leftHandle);
    expect(document.querySelector(".desktop-editor-pane-menu-title")).toBeNull();
    expect(document.querySelector(".desktop-editor-pane-menu")?.textContent).not.toContain("left.csv");

    const leftHeaderToggle = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
    await act(async () => leftHeaderToggle?.click());
    expect(panes[0]!.querySelector(".csv-table-editor__table thead")).toBeNull();
    expect(panes[1]!.querySelector(".csv-table-editor__table thead")).not.toBeNull();

    const externalItem = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open in default app"]',
    );
    await act(async () => externalItem?.click());
    expect(openExternal).toHaveBeenCalledWith("left.csv");
  });

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
        markdownEnvironment={workspaceState(node).markdownEnvironment}
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

async function openPaneMenu(handle: HTMLButtonElement) {
  await act(async () => {
    handle.click();
    await Promise.resolve();
  });
  await waitForCondition(() => document.querySelector(".desktop-editor-pane-menu") !== null);
}

async function waitForCondition(condition: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for CSV pane menu state.");
}

function workspaceState(node: DataNode): DataWorkspaceState {
  return {
    documentNavigation: unavailableDocumentNavigation,
    tree: [node],
    activePath: node.path,
    activeNode: node,
    selectedPaths: [node.path],
    selectedNodes: [node],
    currentFolderPath: null,
    selectedFile: node,
    loadingPath: null,
    loadError: null,
    rootLoading: false,
    fileContent: null,
    fileLoading: false,
    fileError: null,
    fileUrl: null,
    fileUrlLoading: false,
    fileUrlError: null,
    markdownEnvironment: {
      linkGraph: {
        revision: 0,
        documentCount: 0,
        indexedDocumentCount: 0,
        resolveWikiLink: () => ({ exists: false, ambiguous: false, path: null, name: "", displayName: "", target: "" }),
        resolveMarkdownLink: () => null,
        getBacklinks: () => [],
      },
      linkCommands: {},
      assetUrlResolver: () => null,
      assetResolverRevision: 0,
    },
  };
}
