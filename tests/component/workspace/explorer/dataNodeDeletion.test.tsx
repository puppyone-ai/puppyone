/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataNode, DataPort, Workspace } from "@puppyone/shared-ui";
import { useDataNodeActions } from "../../../../src/features/data-workspace/useDataNodeActions";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

const workspace: Workspace = { id: "w1", name: "w1", path: "/w1", status: "recording" } as Workspace;
const image: DataNode = { id: "a.png", name: "a.png", path: "a.png", type: "image" };
const second: DataNode = { id: "b.png", name: "b.png", path: "b.png", type: "image" };

function harness({ deleteNode, onResourceDeleted = vi.fn() }: {
  deleteNode: NonNullable<DataPort["deleteNode"]>;
  onResourceDeleted?: (path: string) => void | Promise<void>;
}) {
  const latest = { current: null as unknown as ReturnType<typeof useDataNodeActions> };
  const onWorkspaceContentChanged = vi.fn();
  const onLocalWorkspaceContentChanged = vi.fn();
  function Harness() {
    latest.current = useDataNodeActions({
      dataPort: { deleteNode } as unknown as DataPort,
      onEnterDataView: vi.fn(),
      onLocalWorkspaceContentChanged,
      onWorkspaceContentChanged,
      onResourceDeleted,
      onActivateNode: vi.fn(),
      setActiveExplorerNode: vi.fn(),
      workspace,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root!, <Harness />));
  return { latest, onWorkspaceContentChanged, onLocalWorkspaceContentChanged };
}

async function run(promise: Promise<void> | void) {
  await act(async () => { await promise; });
}

describe("data node deletion", () => {
  it("deletes from a shortcut without opening a menu first", async () => {
    const deleteNode = vi.fn(async () => {});
    const { latest, onWorkspaceContentChanged } = harness({ deleteNode });
    await run(latest.current.requestDeleteNodes([image], new DOMRect(0, 0, 40, 20)));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(deleteNode).toHaveBeenCalledWith("a.png");
    expect(onWorkspaceContentChanged).toHaveBeenCalledTimes(1);
    expect(latest.current.nodeActionMenu).toBeNull();
  });

  it("writes nothing when the confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const deleteNode = vi.fn(async () => {});
    const { latest } = harness({ deleteNode });
    await run(latest.current.requestDeleteNodes([image], new DOMRect()));
    expect(deleteNode).not.toHaveBeenCalled();
    expect(latest.current.isDeletingNodes).toBe(false);
  });

  it("keeps only the paths that actually failed in the retry set", async () => {
    const deleteNode = vi.fn(async (path: string) => {
      if (path === "b.png") throw new Error("permission denied");
    });
    const { latest } = harness({ deleteNode });
    await run(latest.current.requestDeleteNodes([image, second], new DOMRect()));
    const draft = latest.current.nodeActionMenu!;
    expect(draft.error?.code).toBe("delete-partial");
    expect(draft.nodes.map((node) => node.path)).toEqual(["b.png"]);
  });

  it("does not re-delete a file whose post-processing failed", async () => {
    const deleteNode = vi.fn(async () => {});
    const onResourceDeleted = vi.fn(() => { throw new Error("refresh failed"); });
    const { latest } = harness({ deleteNode, onResourceDeleted });
    await run(latest.current.requestDeleteNodes([image], new DOMRect()));
    expect(deleteNode).toHaveBeenCalledTimes(1);
    expect(latest.current.nodeActionMenu?.error?.code).toBe("operation-failed");
    expect(latest.current.nodeActionMenu?.nodes).toEqual([]);
    // Retrying the visible error must not touch the already deleted path.
    await run(latest.current.deleteNodeFromMenu());
    expect(deleteNode).toHaveBeenCalledTimes(1);
  });

  it("runs one deletion at a time", async () => {
    let release: (() => void) | null = null;
    const deleteNode = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { latest } = harness({ deleteNode });
    act(() => { void latest.current.requestDeleteNodes([image], new DOMRect()); });
    // The document-operation wrapper introduces one microtask before the port.
    await act(async () => {});
    act(() => { void latest.current.requestDeleteNodes([second], new DOMRect()); });
    expect(deleteNode).toHaveBeenCalledTimes(1);
    expect(latest.current.isDeletingNodes).toBe(true);
    await act(async () => { release?.(); });
    expect(deleteNode).toHaveBeenCalledWith("a.png");
  });

  it("refuses a protected workspace root", async () => {
    const deleteNode = vi.fn(async () => {});
    const { latest } = harness({ deleteNode });
    const rootNode: DataNode = { id: "root", name: "root", path: "root", type: "folder", workspaceFolderRoot: true };
    await run(latest.current.requestDeleteNodes([rootNode], new DOMRect()));
    expect(deleteNode).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("keeps the right-click path on the same confirmation and write", async () => {
    const deleteNode = vi.fn(async () => {});
    const { latest } = harness({ deleteNode });
    act(() => latest.current.openNodeActionMenu(image, new DOMRect(0, 0, 40, 20), [image]));
    await run(latest.current.deleteNodeFromMenu());
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(deleteNode).toHaveBeenCalledWith("a.png");
    expect(latest.current.nodeActionMenu).toBeNull();
  });
});
