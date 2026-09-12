/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort } from "../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../packages/shared-ui/src/data/DataWorkspace";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DataWorkspace explorer moves", () => {
  it("moves a nested file to its parent folder through the workspace port", async () => {
    let moved = false;
    const sourcePath = "parent/child/drag-me.txt";
    const targetPath = "parent/drag-me.txt";
    const moveNode = vi.fn(async (from: string, to: string) => {
      expect(from).toBe(sourcePath);
      expect(to).toBe(targetPath);
      moved = true;
    });
    const dataPort: DataPort = {
      listChildren: vi.fn(async (folderPath) => listFixtureChildren(folderPath, moved)),
      moveNode,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          dataPort={dataPort}
          capabilities={{ move: true }}
          defaultActivePath={sourcePath}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
    });

    const sourceRow = container.querySelector<HTMLElement>(`[data-explorer-path="${sourcePath}"]`);
    const parentRow = container.querySelector<HTMLElement>('[data-explorer-path="parent"]');
    if (!sourceRow || !parentRow) throw new Error("Nested move fixture did not render.");
    mockRowBounds(parentRow);
    const transfer = fakeDataTransfer();

    await act(async () => {
      sourceRow.dispatchEvent(dragEvent("dragstart", transfer));
      parentRow.dispatchEvent(dragEvent("dragover", transfer));
      parentRow.dispatchEvent(dragEvent("drop", transfer));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(moveNode).toHaveBeenCalledOnce();
    expect(container.querySelector(`[data-explorer-path="${sourcePath}"]`)).toBeNull();
    expect(container.querySelector(`[data-explorer-path="${targetPath}"]`)).not.toBeNull();
  });

  it("shows move failures while the explorer still contains files", async () => {
    const sourcePath = "parent/child/drag-me.txt";
    const dataPort: DataPort = {
      listChildren: vi.fn(async (folderPath) => listFixtureChildren(folderPath, false)),
      moveNode: vi.fn(async () => {
        throw new Error("An item with that name already exists.");
      }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(
        <DataWorkspace
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          dataPort={dataPort}
          capabilities={{ move: true }}
          defaultActivePath={sourcePath}
          showHeader={false}
          showPreviewHeader={false}
          enableMarkdownLinkContentIndexing={false}
        />,
      ));
      await Promise.resolve();
    });

    const sourceRow = container.querySelector<HTMLElement>(`[data-explorer-path="${sourcePath}"]`);
    const parentRow = container.querySelector<HTMLElement>('[data-explorer-path="parent"]');
    if (!sourceRow || !parentRow) throw new Error("Nested move fixture did not render.");
    mockRowBounds(parentRow);
    const transfer = fakeDataTransfer();

    await act(async () => {
      sourceRow.dispatchEvent(dragEvent("dragstart", transfer));
      parentRow.dispatchEvent(dragEvent("dragover", transfer));
      parentRow.dispatchEvent(dragEvent("drop", transfer));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".explorer-tree-error-banner")?.textContent)
      .toContain("An item with that name already exists.");
  });
});

function listFixtureChildren(folderPath: string | null, moved: boolean): DataNode[] {
  const source: DataNode = {
    id: moved ? "parent/drag-me.txt" : "parent/child/drag-me.txt",
    name: "drag-me.txt",
    path: moved ? "parent/drag-me.txt" : "parent/child/drag-me.txt",
    type: "text",
  };
  const child: DataNode = {
    id: "parent/child",
    name: "child",
    path: "parent/child",
    type: "folder",
    children: moved ? [] : [source],
  };
  const parent: DataNode = {
    id: "parent",
    name: "parent",
    path: "parent",
    type: "folder",
    children: moved ? [child, source] : [child],
  };

  if (folderPath === null) return [parent];
  if (folderPath === parent.path) return parent.children ?? [];
  if (folderPath === child.path) return child.children ?? [];
  return [];
}

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const types: string[] = [];
  return {
    effectAllowed: "none",
    dropEffect: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types,
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
      types.splice(0, types.length, ...values.keys());
    },
    clearData: (type?: string) => type ? values.delete(type) : values.clear(),
    setDragImage: () => undefined,
  } as DataTransfer;
}

function dragEvent(type: string, dataTransfer: DataTransfer): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 12,
    clientY: 5,
  });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

function mockRowBounds(row: HTMLElement) {
  Object.defineProperty(row, "getBoundingClientRect", {
    value: () => ({
      top: 0,
      bottom: 30,
      left: 0,
      right: 240,
      width: 240,
      height: 30,
      x: 0,
      y: 0,
      toJSON() {},
    }),
  });
}
