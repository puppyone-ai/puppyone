import { unavailableDocumentNavigation } from "../../../../../support/editor/documentFixtures";
/**
 * @vitest-environment happy-dom
 */
import {
  EMPTY_EDITOR_GROUP,
  createEditorInput,
  createEditorPaneLayout,
  openEditor,
  type DataNode,
  type DataWorkspaceState,
} from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopEditorSplitView } from "../../../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { withTestLocalization } from "../../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Markdown pane mode menu", () => {
  it("switches source mode from the three-dot pane menu without floating editor controls", async () => {
    const path = "20260817";
    const node = {
      id: path,
      path,
      name: path,
      type: "file",
      mimeType: "text/markdown; charset=utf-8",
      source: "local",
    } satisfies DataNode;
    const editorGroup = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={{
            listChildren: async () => [node],
            readFile: async () => ({
              ...node,
              content: "# Heading\n\nBody",
              version: "v1",
            }),
          }}
          editorGroup={editorGroup}
          editorInteractionPreferences={{
            showSaveStatus: false,
            markdownBlockDragEnabled: false,
          }}
          editorTree={[node]}
          externalOpen={{ open: vi.fn() }}
          fileIconTheme="default"
          layout={createEditorPaneLayout(path)}
          markdownEnvironment={workspaceState(node).markdownEnvironment}
          workspace={{
            id: "workspace",
            name: "Workspace",
            path: "/workspace",
            status: "recording",
          }}
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
    await waitForCondition(() => container.querySelector(".markdown-codemirror-editor") !== null);

    expect(container.querySelector(".editor-mode-toggle")).toBeNull();
    const handle = container.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle");
    expect(handle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      handle?.click();
      await Promise.resolve();
    });
    await waitForCondition(() => document.querySelector(".desktop-editor-pane-menu") !== null);

    const modeControl = document.querySelector<HTMLElement>(
      '.desktop-editor-pane-menu-segmented-control[aria-label="Editor mode"]',
    );
    expect(document.querySelector<HTMLElement>(
      ".desktop-editor-pane-menu",
    )?.style.width).toBe("155px");
    const primaryActions = document.querySelector(".desktop-editor-pane-menu-primary-actions");
    expect(primaryActions?.firstElementChild).toBe(modeControl);
    expect(document.querySelector(".desktop-editor-pane-menu-secondary-actions")).toBeNull();
    expect(document.querySelector(".desktop-editor-pane-menu-action-divider")).not.toBeNull();
    const liveModeItem = modeControl?.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Live view"]',
    );
    const sourceModeItem = modeControl?.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Source code"]',
    );
    expect(modeControl?.textContent).toBe("");
    expect(liveModeItem?.getAttribute("aria-checked")).toBe("true");
    expect(sourceModeItem).toBeInstanceOf(HTMLButtonElement);
    expect(sourceModeItem?.getAttribute("aria-checked")).toBe("false");

    liveModeItem?.focus();
    await act(async () => liveModeItem?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    })));
    await waitForCondition(() => container.querySelector(
      '.markdown-codemirror-editor[data-preview-state="source"]',
    ) !== null);

    expect(document.querySelector(".desktop-editor-pane-menu")).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Source code");
    expect(document.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Source code"]',
    )?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Live view"]',
    )?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      handle?.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();

    await act(async () => {
      handle?.click();
      await Promise.resolve();
    });
    await waitForCondition(() => document.querySelector(
      '.desktop-editor-pane-menu-segmented-control[aria-label="Editor mode"]',
    ) !== null);
    expect(document.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-label="Source code"]',
    )?.getAttribute("aria-checked")).toBe("true");
  });
});

async function waitForCondition(condition: () => boolean, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for Markdown pane mode state.");
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
        resolveWikiLink: () => ({
          exists: false,
          ambiguous: false,
          path: null,
          name: "",
          displayName: "",
          target: "",
        }),
        resolveMarkdownLink: () => null,
        getBacklinks: () => [],
      },
      linkCommands: {},
      assetUrlResolver: () => null,
      assetResolverRevision: 0,
    },
  };
}
