/** @vitest-environment happy-dom */
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { requireEditorView } from "../../../support/editor/editorView";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { DataWorkspace, EMPTY_EDITOR_GROUP, activateEditorPane, assignEditorToActivePane, assignEditorToPane, createEditorInput, createEditorPaneLayout, getEditorPanes, moveEditorPane, openEditor, splitEditorPane, type DataNode, type DataPort, type DataWorkspaceState, type EditorPaneLayoutState } from "@puppyone/shared-ui";
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { DocumentSurfaceHost } from "../../../../src/shared-ui/editor/host/DocumentSurfaceHost";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { areEditorPaneDocumentRuntimePropsEqual } from "../../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { withTestLocalization } from "../../../support/react/localization";
import { clickPaneHandle, createThreePaneWorkspace, emptyWorkspaceState, focusEditorView, installPointerCaptureStub, mountRoot, readCount, runtimeEnvironment, runtimeProps, setUpEditorSplitPanes, waitForCondition } from "../../../support/workbench/editorSplitPaneHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpEditorSplitPanes();

describe("DesktopEditorSplitView: editor runtimes across panes", () => {
  it("keeps mixed source transitions isolated inside a real three-pane split", async () => {
    const csv = "report.csv";
    const image = "diagram.png";
    const markdown = "notes.md";
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(csv));
    group = openEditor(group, createEditorInput(image));
    group = openEditor(group, createEditorInput(markdown));
    let initialLayout = splitEditorPane(createEditorPaneLayout(csv), "editor-pane-1", "horizontal");
    initialLayout = assignEditorToActivePane(initialLayout, image);
    initialLayout = splitEditorPane(initialLayout, initialLayout.activePaneId, "vertical");
    initialLayout = assignEditorToActivePane(initialLayout, markdown);
    const tree: DataNode[] = [
      { id: csv, path: csv, name: csv, type: "spreadsheet", mimeType: "text/csv", source: "local" },
      { id: image, path: image, name: image, type: "image", mimeType: "image/png", source: "local" },
      { id: markdown, path: markdown, name: markdown, type: "markdown", mimeType: "text/markdown", source: "local" },
    ];
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (path: string): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: path === csv ? "spreadsheet" as const : "markdown" as const,
      mimeType: path === csv ? "text/csv" : "text/markdown",
      content: `content:${path}`,
      version: `version:${path}:${readFile.mock.calls.length}`,
    }));
    const getFileUrl = vi.fn<NonNullable<DataPort["getFileUrl"]>>(async (path: string) => `blob:${path}`);
    const dataPort = { listChildren: async () => tree, readFile, getFileUrl };
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);
    let updateLayout!: React.Dispatch<React.SetStateAction<EditorPaneLayoutState>>;

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      updateLayout = setLayout;
      return withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => (
      readCount(readFile, csv) === 1
      && readCount(readFile, markdown) === 1
      && getFileUrl.mock.calls.some(([path]) => path === image)
    ));
    expect(container.querySelectorAll(".desktop-editor-pane")).toHaveLength(3);

    await act(async () => updateLayout((layout) => assignEditorToPane(layout, "editor-pane-1", image)));
    await waitForCondition(() => (
      container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-1"] img') !== null
      || getFileUrl.mock.calls.filter(([path]) => path === image).length >= 1
    ));
    await act(async () => updateLayout((layout) => assignEditorToPane(layout, "editor-pane-1", csv)));
    await waitForCondition(() => readCount(readFile, csv) === 2);

    expect(readCount(readFile, markdown)).toBe(1);
    expect(readCount(readFile, image)).toBe(0);
    expect(container.querySelectorAll(".desktop-editor-pane")).toHaveLength(3);
  });

  it("reorders two sibling panes without clearing or remounting their editor runtimes", async () => {
    const paths = ["left.txt", "right.txt"] as const;
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]));
    group = openEditor(group, createEditorInput(paths[1]));
    let initialLayout = splitEditorPane(
      createEditorPaneLayout(paths[0]),
      "editor-pane-1",
      "horizontal",
    );
    initialLayout = assignEditorToActivePane(initialLayout, paths[1]);
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "text",
      source: "local",
    }));
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (path: string): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: "text" as const,
      content: `stable content for ${path}`,
      version: `version:${path}`,
    }));
    const state = { ...emptyWorkspaceState(), tree };
    const dataPort = { listChildren: async () => tree, readFile };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);
    installDesktopBridge({
      capturePanePreview: vi.fn(async () => null),
    });

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      return withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={(sourcePaneId, targetPaneId, direction, placement) => {
            setLayout((current) => moveEditorPane(
              current,
              sourcePaneId,
              targetPaneId,
              direction,
              placement,
            ));
          }}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 2);
    const originalViews = new Map(
      Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map((pane) => [
        pane.dataset.editorPaneId!,
        requireEditorView(pane.querySelector<HTMLElement>(".cm-editor")!),
      ]),
    );
    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const leftPane = panes[0]!;
    const rightPane = panes[1]!;
    leftPane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    rightPane.getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    rightPane.querySelector<HTMLElement>(".desktop-editor-pane-content")!
      .getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    const rightHandle = rightPane.querySelector<HTMLButtonElement>(
      ".desktop-editor-pane-handle",
    )!;
    installPointerCaptureStub(rightHandle);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(leftPane);

    await act(async () => {
      rightHandle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, clientX: 600, clientY: 5, pointerId: 71,
      }));
      rightHandle.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX: 10, clientY: 300, pointerId: 71,
      }));
      rightHandle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, button: 0, clientX: 10, clientY: 300, pointerId: 71,
      }));
      await Promise.resolve();
    });

    expect(Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map(
      (pane) => pane.dataset.editorPaneId,
    )).toEqual(["editor-pane-2", "editor-pane-1"]);
    expect(readFile).toHaveBeenCalledTimes(2);
    for (const [paneId, originalView] of originalViews) {
      const pane = container.querySelector<HTMLElement>(`[data-editor-pane-id="${paneId}"]`)!;
      expect(requireEditorView(pane.querySelector<HTMLElement>(".cm-editor")!))
        .toBe(originalView);
    }
  });

  it("reparents panes across nested split axes without remounting any editor runtime", async () => {
    const { group, layout: initialLayout } = createThreePaneWorkspace("txt");
    const paths = ["a.txt", "b.txt", "c.txt"] as const;
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "text",
      source: "local",
    }));
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (path: string): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: "text" as const,
      content: `stable content for ${path}`,
      version: `version:${path}`,
    }));
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);
    let updateLayout!: React.Dispatch<React.SetStateAction<EditorPaneLayoutState>>;

    const dataPort = { listChildren: async () => tree, readFile };
    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      updateLayout = setLayout;
      return withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 3);
    const initialReadCount = readFile.mock.calls.length;
    const paneElements = new Map(
      Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map((pane) => [
        pane.dataset.editorPaneId!,
        pane,
      ]),
    );
    const editorViews = new Map(
      Array.from(paneElements, ([paneId, pane]) => [
        paneId,
        requireEditorView(pane.querySelector<HTMLElement>(".cm-editor")!),
      ]),
    );

    act(() => {
      editorViews.get("editor-pane-1")!.dispatch({ selection: { anchor: 1 } });
      editorViews.get("editor-pane-2")!.dispatch({ selection: { anchor: 2 } });
      editorViews.get("editor-pane-3")!.dispatch({ selection: { anchor: 3 } });
    });
    await act(async () => updateLayout((current) => moveEditorPane(
      current,
      "editor-pane-1",
      "editor-pane-3",
      "vertical",
      "second",
    )));

    expect(readFile).toHaveBeenCalledTimes(initialReadCount);
    for (const [paneId, paneElement] of paneElements) {
      const currentPane = container.querySelector<HTMLElement>(
        `[data-editor-pane-id="${paneId}"]`,
      )!;
      expect(currentPane).toBe(paneElement);
      expect(requireEditorView(currentPane.querySelector<HTMLElement>(".cm-editor")!))
        .toBe(editorViews.get(paneId));
    }
    expect(Array.from(editorViews.values()).map(
      (view) => view.state.selection.main.anchor,
    )).toEqual([1, 2, 3]);
  });

  it("keeps horizontal Markdown pane scroll and runtimes stable across repeated focus routing", async () => {
    const paths = ["left.md", "right.md"] as const;
    const markdown = Array.from({ length: 80 }, (_, index) => [
      `## Section ${index + 1}`,
      "",
      `Paragraph ${index + 1} contains **projected source** for focus continuity coverage.`,
      "",
    ]).flat().join("\n");
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]));
    group = openEditor(group, createEditorInput(paths[1]));
    let initialLayout = splitEditorPane(
      createEditorPaneLayout(paths[0]),
      "editor-pane-1",
      "horizontal",
    );
    initialLayout = assignEditorToActivePane(initialLayout, paths[1]);
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    }));
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (path: string): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: `${markdown}\n\n${path}`,
      version: `version:${path}`,
    }));
    const dataPort = {
      listChildren: async () => tree,
      readFile,
      documentPersistence: {
        kind: "local-fs" as const,
        storageIdentity: "test:horizontal-markdown-focus",
        persist: async (request: { baseVersion?: string | null; path: string }) => ({
          ok: true as const,
          version: request.baseVersion ?? `version:${request.path}`,
        }),
      },
    };
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      return withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={(paneId) => setLayout((current) => activateEditorPane(current, paneId))}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 2);
    const panes = Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
    const views = panes.map((pane) => (
      requireEditorView(pane.querySelector<HTMLElement>(".cm-editor")!)
    ));
    const leftSnapshot = vi.spyOn(views[0]!, "scrollSnapshot");
    const rightSnapshot = vi.spyOn(views[1]!, "scrollSnapshot");

    act(() => {
      views[0]!.dispatch({ selection: { anchor: 120 } });
      views[1]!.dispatch({ selection: { anchor: 240 } });
    });
    // happy-dom does not start with a native BrowserWindow focus owner. Prime
    // both CodeMirror observers once, then measure only deterministic MDI
    // transitions. The Chromium regression below exercises the cold boundary.
    await focusEditorView(views[1]!);
    await focusEditorView(views[0]!);
    leftSnapshot.mockClear();
    rightSnapshot.mockClear();
    act(() => {
      views[0]!.scrollDOM.scrollTop = 640;
      views[1]!.scrollDOM.scrollTop = 960;
    });
    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 40)));
    surfaceRender.mockClear();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const beforeRightFocus = [leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length];
      await focusEditorView(views[1]!);
      expect([
        leftSnapshot.mock.calls.length - beforeRightFocus[0]!,
        rightSnapshot.mock.calls.length - beforeRightFocus[1]!,
      ], `right focus boundary ${cycle + 1}`).toEqual([1, 1]);
      expect(container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-2"]')?.dataset.active)
        .toBe("true");
      expect(views[0]!.scrollDOM.scrollTop).toBe(640);

      const beforeLeftFocus = [leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length];
      await focusEditorView(views[0]!);
      expect([
        leftSnapshot.mock.calls.length - beforeLeftFocus[0]!,
        rightSnapshot.mock.calls.length - beforeLeftFocus[1]!,
      ], `left focus boundary ${cycle + 1}`).toEqual([1, 1]);
      expect(container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
        .toBe("true");
      expect(views[1]!.scrollDOM.scrollTop).toBe(960);
    }

    expect([leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length])
      .toEqual([12, 12]);
    expect(surfaceRender).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(views.map((view) => view.state.selection.main.anchor)).toEqual([120, 240]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")))
      .toEqual(panes);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => requireEditorView(element),
    )).toEqual(views);
  });

  it("keeps three CodeMirror focus and selection states isolated across pane activation", async () => {
    const { group, layout } = createThreePaneWorkspace("txt");
    const state = {
      ...emptyWorkspaceState(),
      tree: ["a.txt", "b.txt", "c.txt"].map((path) => ({
        id: path,
        name: path,
        path,
        type: "text" as const,
        source: "local" as const,
      })),
    };
    const dataPort = {
      listChildren: async () => state.tree,
      readFile: async (path: string) => ({
        path,
        name: path,
        type: "text" as const,
        content: `${path} has independent editor state`,
        version: `version:${path}`,
      }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);

    function Harness() {
      const [currentLayout, setCurrentLayout] = React.useState(layout);
      return withTestLocalization(
        <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          layout={currentLayout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={(paneId) => setCurrentLayout((current) => activateEditorPane(current, paneId))}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 3);
    const editorElements = Array.from(container.querySelectorAll<HTMLElement>(".cm-editor"));
    const views = editorElements.map((element) => requireEditorView(element));

    act(() => {
      views[0]!.dispatch({ selection: { anchor: 1 } });
      views[1]!.dispatch({ selection: { anchor: 2 } });
      views[2]!.dispatch({ selection: { anchor: 3 } });
      views[0]!.focus();
    });
    expect(container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
      .toBe("true");
    expect(views[0]!.contentDOM.contains(document.activeElement)).toBe(true);

    act(() => views[1]!.focus());
    expect(container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-2"]')?.dataset.active)
      .toBe("true");
    expect(views[1]!.contentDOM.contains(document.activeElement)).toBe(true);
    expect(views.map((view) => view.state.selection.main.anchor)).toEqual([1, 2, 3]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => requireEditorView(element),
    )).toEqual(views);

    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    const activeHandle = container.querySelector<HTMLElement>(
      '[data-editor-pane-id="editor-pane-2"] .desktop-editor-pane-handle',
    )!;
    installPointerCaptureStub(activeHandle);
    clickPaneHandle(activeHandle, 31);
    expect(surfaceRender).not.toHaveBeenCalled();

    act(() => views[0]!.focus());
    expect(container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
      .toBe("true");
    expect(surfaceRender).not.toHaveBeenCalled();
  });

  it("keeps an inactive Markdown table pane byte-for-byte mounted while sibling panes route workspace focus", async () => {
    const { group, layout: initialLayout } = createThreePaneWorkspace("md");
    const sources = new Map([
      ["a.md", [
        "| Name | Value |",
        "| --- | --- |",
        "| stable | table |",
        "",
        "Paragraph below the table keeps **the same DOM identity**.",
      ].join("\n")],
      ["b.md", "# B\n\nSibling B owns its own projection."],
      ["c.md", "# C\n\nSibling C owns its own projection."],
    ]);
    const tree: DataNode[] = Array.from(sources.keys(), (path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    }));
    const readFile = vi.fn<NonNullable<DataPort["readFile"]>>(async (path: string): Promise<Awaited<ReturnType<NonNullable<DataPort["readFile"]>>>> => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: sources.get(path) ?? "",
      version: `version:${path}`,
    }));
    const dataPort = { listChildren: async () => tree, readFile };
    const editorById = new Map(group.editors.map((editor) => [editor.id, editor]));
    const paneResource = new Map(getEditorPanes(initialLayout).map((pane) => [
      pane.id,
      pane.editorId ? editorById.get(pane.editorId)?.resource ?? null : null,
    ]));
    const readyEnvironments: DataWorkspaceState["markdownEnvironment"][] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      const [activePath, setActivePath] = React.useState<string | null>("a.md");
      return withTestLocalization(
        <DataWorkspace
          activePath={activePath}
          dataPort={dataPort}
          enableMarkdownLinkContentIndexing={false}
          loadActiveFileSource={false}
          showHeader={false}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          mainSlot={(state) => {
            if (state.tree.length === tree.length) readyEnvironments.push(state.markdownEnvironment);
            return (
              <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
                aiEditRequest={null}
                dataPort={dataPort}
                editorGroup={group}
                editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
                editorTree={state.tree}
                layout={layout}
                markdownEnvironment={state.markdownEnvironment}
                workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
                onClosePane={vi.fn()}
                onFocusPane={(paneId) => {
                  setLayout((current) => activateEditorPane(current, paneId));
                  setActivePath(paneResource.get(paneId) ?? null);
                }}
                onMovePane={vi.fn()}
                onOpenAtPaneEdge={vi.fn()}
                onResizeSplit={vi.fn()}
                onSplitPane={vi.fn()}
              />
            );
          }}
          onActivePathChange={async (path) => setActivePath(path)}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => (
      container.querySelectorAll(".cm-editor").length === 3
      && container.querySelector<HTMLElement>('[data-editor-pane-id="editor-pane-1"] .cm-md-table-widget') !== null
    ));
    const panes = Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
    const views = panes.map((pane) => requireEditorView(
      pane.querySelector<HTMLElement>(".cm-editor")!,
    ));
    await focusEditorView(views[0]!);
    await focusEditorView(views[1]!);

    const firstPane = container.querySelector<HTMLElement>(
      '[data-editor-pane-id="editor-pane-1"]',
    )!;
    const table = firstPane.querySelector(".cm-md-table-widget");
    const paragraph = Array.from(firstPane.querySelectorAll<HTMLElement>(".cm-line"))
      .find((line) => line.textContent?.includes("Paragraph below the table"));
    expect(table).not.toBeNull();
    expect(paragraph).not.toBeUndefined();
    const firstPaneHtml = views[0]!.contentDOM.innerHTML;
    const firstPaneDispatch = vi.spyOn(views[0]!, "dispatch");
    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    surfaceRender.mockClear();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      await focusEditorView(views[2]!);
      await focusEditorView(views[1]!);
      expect(firstPane.querySelector(".cm-md-table-widget")).toBe(table);
      expect(Array.from(firstPane.querySelectorAll<HTMLElement>(".cm-line"))
        .find((line) => line.textContent?.includes("Paragraph below the table")))
        .toBe(paragraph);
    }

    expect(views[0]!.contentDOM.innerHTML).toBe(firstPaneHtml);
    expect(firstPaneDispatch).not.toHaveBeenCalled();
    expect(surfaceRender).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(new Set(readyEnvironments).size).toBe(1);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => requireEditorView(element),
    )).toEqual(views);
  });

  it("routes semantic Markdown revisions only to runtimes that consume them", () => {
    const image = {
      id: "diagram.png",
      name: "diagram.png",
      path: "diagram.png",
      type: "image",
      mimeType: "image/png",
      source: "local",
    } satisfies DataNode;
    const markdown = {
      id: "note.md",
      name: "note.md",
      path: "note.md",
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    } satisfies DataNode;

    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(image, runtimeEnvironment(1)),
      runtimeProps({ ...image }, runtimeEnvironment(2)),
    )).toBe(true);
    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(markdown, runtimeEnvironment(1)),
      runtimeProps({ ...markdown }, runtimeEnvironment(2)),
    )).toBe(false);
    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(markdown, runtimeEnvironment(7)),
      runtimeProps({ ...markdown }, runtimeEnvironment(7)),
    )).toBe(true);
  });
});
