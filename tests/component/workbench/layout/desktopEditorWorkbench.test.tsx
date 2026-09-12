/** @vitest-environment happy-dom */
import React, { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceRootUri,
  type DataNode,
  type DocumentDataNode,
  type ResourceUri,
  type Workspace,
} from "@puppyone/shared-ui";
import {
  useDesktopEditorWorkbench,
  type DesktopEditorWorkbenchController,
} from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("useDesktopEditorWorkbench", () => {
  it("uses Root-aware Editor IDs while preserving the visible active path", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
      workspaceInstanceId: "instance-a",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          workspace={workspace}
          workspaceFolderUri={createWorkspaceRootUri("instance-a")}
          onChange={(controller) => snapshots.push(controller)}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("src/App.tsx"));
      await Promise.resolve();
    });

    const controller = snapshots.at(-1)!;
    expect(controller.activePath).toBe("src/App.tsx");
    expect(controller.activeEditorId).toContain("puppyone-local://workspace/instance-a/");
    expect(controller.state.editors[0]).toMatchObject({
      resource: "src/App.tsx",
      id: controller.activeEditorId,
    });
  });

  it("migrates path-only Workbench and Pane records into one Root URI", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
      workspaceInstanceId: "instance-a",
    };
    const storageKey = "puppyone.desktop.editor-workbench.v3:workspace-id:/workspace";
    window.localStorage.setItem(storageKey, JSON.stringify({
      group: {
        editors: [{ id: "docs/a.md", resource: "docs/a.md", label: "a.md" }],
        activeEditorId: "docs/a.md",
        mostRecentlyUsed: ["docs/a.md"],
      },
      layout: {
        activePaneId: "editor-pane-1",
        root: { kind: "pane", id: "editor-pane-1", editorId: "docs/a.md" },
      },
    }));
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          workspace={workspace}
          workspaceFolderUri={createWorkspaceRootUri("instance-a")}
          onChange={(controller) => snapshots.push(controller)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const controller = snapshots.at(-1)!;
    expect(controller.activePath).toBe("docs/a.md");
    expect(controller.activeEditorId).toContain("puppyone-local://workspace/instance-a/");
    expect(controller.paneLayout.root).toMatchObject({ editorId: controller.activeEditorId });
  });

  it("restores a workspace session without overwriting it during hydration", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const storageKey = "puppyone.desktop.editor-group.v1:workspace-id:/workspace";
    window.localStorage.setItem(storageKey, JSON.stringify({
      editors: [
        { id: "a.md", resource: "a.md", label: "a.md" },
        { id: "b.md", resource: "b.md", label: "b.md" },
      ],
      activeEditorId: "b.md",
      mostRecentlyUsed: ["b.md", "a.md"],
    }));
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.state.editors.map(({ id }) => id)).toEqual(["a.md", "b.md"]);
    expect(snapshots.at(-1)?.activePath).toBe("b.md");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "null").activeEditorId).toBe("b.md");
  });

  it("persists pane assignments with the v3 workbench record", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.openDocumentAtPaneEdge(
        documentNode("b.md"),
        controller.activePaneId,
        "horizontal",
        "second",
      );
      await Promise.resolve();
    });
    act(() => window.dispatchEvent(new Event("pagehide")));

    const storageKey = "puppyone.desktop.editor-workbench.v3:workspace-id:/workspace";
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    expect(stored.group.editors.map(({ id }: { id: string }) => id)).toEqual(["a.md", "b.md"]);
    expect(stored.layout).toMatchObject({
      activePaneId: "editor-pane-2",
      root: {
        kind: "split",
        direction: "horizontal",
        first: { editorId: "a.md" },
        second: { editorId: "b.md" },
      },
    });
  });

  it("collapses duplicate visible resources from the retired self-split layout", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const storageKey = "puppyone.desktop.editor-workbench.v2:workspace-id:/workspace";
    window.localStorage.setItem(storageKey, JSON.stringify({
      group: {
        editors: [{ id: "a.md", resource: "a.md", label: "a.md" }],
        activeEditorId: "a.md",
        mostRecentlyUsed: ["a.md"],
      },
      layout: {
        activePaneId: "editor-pane-2",
        root: {
          kind: "split",
          id: "editor-split-1",
          direction: "horizontal",
          ratio: 0.5,
          first: { kind: "pane", id: "editor-pane-1", editorId: "a.md" },
          second: { kind: "pane", id: "editor-pane-2", editorId: "a.md" },
        },
      },
    }));
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)!.paneLayout).toMatchObject({
      activePaneId: "editor-pane-2",
      root: { kind: "pane", id: "editor-pane-2", editorId: "a.md" },
    });
  });

  it("focuses an already visible file instead of splitting it into a duplicate pane", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.openDocumentAtPaneEdge(
        documentNode("a.md"),
        controller.activePaneId,
        "horizontal",
        "second",
      );
      await Promise.resolve();
    });

    expect(snapshots.at(-1)!.paneLayout.root).toMatchObject({
      kind: "pane",
      editorId: "a.md",
    });
  });

  it("focuses an already visible pane when Explorer opens its file again", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.openDocumentAtPaneEdge(documentNode("b.md"), controller.activePaneId, "horizontal", "second");
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });

    const controller = snapshots.at(-1)!;
    expect(controller.activePaneId).toBe("editor-pane-1");
    expect(controller.paneLayout.root).toMatchObject({
      kind: "split",
      first: { editorId: "a.md" },
      second: { editorId: "b.md" },
    });
  });

  it("creates an empty pane on the requested side without duplicating the current file", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.splitPane(controller.activePaneId, "horizontal", "first");
      await Promise.resolve();
    });

    const controller = snapshots.at(-1)!;
    expect(controller.activePath).toBeNull();
    expect(controller.state.editors.map(({ id }) => id)).toEqual(["a.md"]);
    expect(controller.paneLayout.root).toMatchObject({
      kind: "split",
      direction: "horizontal",
      first: { kind: "pane", editorId: null },
      second: { kind: "pane", editorId: "a.md" },
    });
  });

  it("normalizes a stale persisted pane reference into an explicit empty pane", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const storageKey = "puppyone.desktop.editor-workbench.v3:workspace-id:/workspace";
    window.localStorage.setItem(storageKey, JSON.stringify({
      group: {
        editors: [{ id: "a.md", resource: "a.md", label: "a.md" }],
        activeEditorId: "a.md",
        mostRecentlyUsed: ["a.md"],
      },
      layout: {
        activePaneId: "editor-pane-2",
        root: {
          kind: "split",
          id: "editor-split-1",
          direction: "horizontal",
          ratio: 0.5,
          first: { kind: "pane", id: "editor-pane-1", editorId: "a.md" },
          second: { kind: "pane", id: "editor-pane-2", editorId: "missing.md" },
        },
      },
    }));
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(snapshots.at(-1)!.paneLayout).toMatchObject({
      activePaneId: "editor-pane-2",
      root: {
        first: { editorId: "a.md" },
        second: { editorId: null },
      },
    });
    expect(snapshots.at(-1)!.activePath).toBeNull();
  });

  it("reorders sibling panes without clearing their file assignments", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument(documentNode("a.md"));
      await Promise.resolve();
    });
    await act(async () => {
      const controller = snapshots.at(-1)!;
      controller.openDocumentAtPaneEdge(documentNode("b.md"), controller.activePaneId, "horizontal", "second");
      await Promise.resolve();
    });
    const originalRootId = snapshots.at(-1)!.paneLayout.root.id;

    await act(async () => {
      snapshots.at(-1)!.movePane(
        "editor-pane-2",
        "editor-pane-1",
        "horizontal",
        "first",
      );
      await Promise.resolve();
    });

    const controller = snapshots.at(-1)!;
    expect(controller.state.editors.map(({ id }) => id)).toEqual(["a.md", "b.md"]);
    expect(controller.paneLayout).toMatchObject({
      activePaneId: "editor-pane-2",
      root: {
        id: originalRootId,
        first: { id: "editor-pane-2", editorId: "b.md" },
        second: { id: "editor-pane-1", editorId: "a.md" },
      },
    });
    expect(controller.activePath).toBe("b.md");
  });

  it("rejects a folder descriptor at the public workbench boundary", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Probe workspace={workspace} onChange={(controller) => snapshots.push(controller)} />);
      await Promise.resolve();
    });
    await act(async () => {
      snapshots.at(-1)!.openDocument({
        id: "docs",
        name: "docs",
        path: "docs",
        type: "folder",
      } as unknown as DocumentDataNode);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)!.state.editors).toEqual([]);
    expect(snapshots.at(-1)!.activePath).toBeNull();
  });

  it("validates restored inputs and removes directories before exposing the workbench", async () => {
    const workspace: Workspace = {
      id: "workspace-id",
      name: "Workspace",
      path: "/workspace",
      status: "recording",
    };
    const storageKey = "puppyone.desktop.editor-workbench.v2:workspace-id:/workspace";
    window.localStorage.setItem(storageKey, JSON.stringify({
      group: {
        editors: [
          { id: "docs", resource: "docs", label: "docs" },
          { id: "a.md", resource: "a.md", label: "a.md" },
        ],
        activeEditorId: "docs",
        mostRecentlyUsed: ["docs", "a.md"],
      },
      layout: {
        activePaneId: "editor-pane-1",
        root: { kind: "pane", id: "editor-pane-1", editorId: "docs" },
      },
    }));
    const snapshots: DesktopEditorWorkbenchController[] = [];
    const resolveNode = async (path: string): Promise<DataNode> => path === "docs"
      ? { id: path, name: path, path, type: "folder" }
      : documentNode(path);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          workspace={workspace}
          resolveNode={resolveNode}
          onChange={(controller) => snapshots.push(controller)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(snapshots.some(({ state }) => state.editors.some(({ id }) => id === "docs"))).toBe(false);
    expect(snapshots.at(-1)!.state.editors.map(({ id }) => id)).toEqual(["a.md"]);
    expect(snapshots.at(-1)!.activePath).toBe("a.md");
  });
});

function Probe({
  workspace,
  onChange,
  resolveNode,
  workspaceFolderUri = null,
}: {
  workspace: Workspace;
  onChange: (controller: DesktopEditorWorkbenchController) => void;
  resolveNode?: (path: string) => Promise<DataNode | null>;
  workspaceFolderUri?: ResourceUri | null;
}) {
  const controller = useDesktopEditorWorkbench(
    workspace,
    resolveNode ?? resolveDocumentNode,
    workspaceFolderUri,
  );
  useEffect(() => {
    onChange(controller);
  }, [controller, onChange]);
  return null;
}

function documentNode(path: string): DocumentDataNode {
  return {
    id: path,
    name: path.split("/").at(-1) ?? path,
    path,
    type: "markdown",
  };
}

async function resolveDocumentNode(path: string): Promise<DocumentDataNode> {
  return documentNode(path);
}
