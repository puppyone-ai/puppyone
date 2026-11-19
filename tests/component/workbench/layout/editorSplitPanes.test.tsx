/** @vitest-environment happy-dom */
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { EMPTY_EDITOR_GROUP, createEditorInput, createEditorPaneLayout, openEditor, splitEditorPane, type DataNode, type DataPort } from "@puppyone/shared-ui";
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { EditorPaneDocumentRuntime } from "../../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { withTestLocalization } from "../../../support/react/localization";
import { emptyWorkspaceState, mountRoot, renderSplitView, runtimeEnvironment, runtimeProps, setUpEditorSplitPanes, waitForCondition } from "../../../support/workbench/editorSplitPaneHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpEditorSplitPanes();

describe("DesktopEditorSplitView: what a pane shows", () => {
  it("shows an explicit empty state when a split pane has no document", () => {
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const layout = splitEditorPane(
      createEditorPaneLayout("a.md"),
      "editor-pane-1",
      "horizontal",
      { editorId: null },
    );
    const container = renderSplitView(group, layout);
    const emptyPane = container.querySelector<HTMLElement>('[data-empty="true"]');

    expect(emptyPane).not.toBeNull();
    expect(emptyPane?.dataset.contentState).toBe("empty");
    expect(emptyPane?.querySelector(".desktop-editor-pane-empty")?.textContent)
      .toBe("Select a file to preview");
    expect(emptyPane?.querySelector(".document-surface-host")).toBeNull();
  });

  it("keeps the opening mark, not the empty prompt, until a project's first document arrives", () => {
    const group = EMPTY_EDITOR_GROUP;
    const container = renderSplitView(group, createEditorPaneLayout(null), { entering: true });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane");

    expect(pane?.dataset.contentState).toBe("opening");
    expect(pane?.dataset.empty).toBeUndefined();
    expect(pane?.textContent).not.toContain("Select a file to preview");
    expect(pane?.querySelector(".desktop-project-opening")?.getAttribute("aria-label")).toBe("Loading file…");
  });

  it("uses the official loading animation without visible loading copy", async () => {
    const markdown = {
      id: "loading.md",
      name: "loading.md",
      path: "loading.md",
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    } satisfies DataNode;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);
    const dataPort: DataPort = {
      listChildren: async () => [],
      readFile: vi.fn<NonNullable<DataPort["readFile"]>>(() => new Promise(() => undefined)),
    };

    await act(async () => root?.render(withTestLocalization(
      <EditorPaneDocumentRuntime
        {...runtimeProps(markdown, runtimeEnvironment(0))}
        dataPort={dataPort}
      />,
    )));

    expect(container.querySelector('[data-puppy-loader]')).not.toBeNull();
    expect(container.textContent).not.toContain("Loading file");
    expect(container.querySelector(".document-surface-pending")?.getAttribute("aria-busy"))
      .toBe("true");
  });

  it("retains the document input through Strict Mode and Files/Settings navigation", async () => {
    const path = "return-from-settings.md";
    const node = {
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    } satisfies DataNode;
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const layout = createEditorPaneLayout(path);
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: "# Restored document",
      version: `version:${readFile.mock.calls.length}`,
    }));
    const dataPort: DataPort = { listChildren: async () => [node], readFile };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);

    const renderRoute = async (route: "files" | "settings") => act(async () => root?.render(
      withTestLocalization(
        <React.StrictMode>
          {route === "settings" ? <div>Settings</div> : (
            <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
              aiEditRequest={null}
              dataPort={dataPort}
              editorGroup={group}
              editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
              editorTree={[node]}
              layout={layout}
              markdownEnvironment={emptyWorkspaceState().markdownEnvironment}
              workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
              onClosePane={vi.fn()}
              onFocusPane={vi.fn()}
              onMovePane={vi.fn()}
              onOpenAtPaneEdge={vi.fn()}
              onResizeSplit={vi.fn()}
              onSplitPane={vi.fn()}
            />
          )}
        </React.StrictMode>,
      ),
    ));

    await renderRoute("files");
    await waitForCondition(() => (
      container.querySelector(".cm-editor") !== null
      && container.querySelector("[data-puppy-loader]") === null
    ));
    const readsAfterFirstMount = readFile.mock.calls.length;
    expect(readsAfterFirstMount).toBe(1);
    await renderRoute("settings");
    expect(container.textContent).toContain("Settings");
    await renderRoute("files");
    await waitForCondition(() => (
      readFile.mock.calls.length === readsAfterFirstMount + 1
      && container.querySelector(".cm-editor") !== null
      && container.querySelector("[data-puppy-loader]") === null
    ));
  });

  it("shows an unavailable state instead of blanking a pane restored as a directory", () => {
    const folder = {
      id: "docs",
      name: "docs",
      path: "docs",
      type: "folder",
      children: [],
    } satisfies DataNode;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);

    act(() => root?.render(withTestLocalization(
      <EditorPaneDocumentRuntime {...runtimeProps(folder, runtimeEnvironment(0))} />,
    )));

    expect(container.querySelector(".document-preview")).toBeNull();
    expect(container.textContent).not.toContain("Binary file");
    expect(container.textContent).not.toContain("folder file");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Cannot open in editor");
  });
});
