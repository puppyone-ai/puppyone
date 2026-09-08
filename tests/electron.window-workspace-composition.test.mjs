import { describe, expect, it, vi } from "vitest";
import { createWindowWorkspaceCompositionService } from "../electron/main/window-workspace-composition.mjs";
import { WindowWorkspaceState } from "../electron/main/window-workspace-state.mjs";

describe("window Workspace composition service", () => {
  it("persists before atomically publishing one attached Folder", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a");
    const events = [];
    const indexedPaths = new Map([["/a", window]]);
    const service = createService({
      state,
      indexedPaths,
      persistWorkspaceComposition: vi.fn(async () => events.push("persisted")),
      onIndex: () => events.push("published"),
    });

    const result = await service.attach(window, "/b");

    expect(events).toEqual(["persisted", "published"]);
    expect(result).toMatchObject({ status: "attached-current", path: "/b" });
    expect(result.workspaceId).toBe(state.workspaceId);
    expect(result.workspaces.map((workspace) => workspace.id)).toEqual(["a", "b"]);
    expect(state.folderPaths).toEqual(["/a", "/b"]);
    expect(indexedPaths.get("/b")).toBe(window);
  });

  it("returns the authoritative composition when the Folder is already attached", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a");
    const persistWorkspaceComposition = vi.fn();
    const service = createService({
      state,
      indexedPaths: new Map([["/a", window]]),
      persistWorkspaceComposition,
    });

    const result = await service.attach(window, "/a");

    expect(result.status).toBe("already-attached");
    expect(result.workspaces.map((workspace) => workspace.id)).toEqual(["a"]);
    expect(persistWorkspaceComposition).not.toHaveBeenCalled();
  });

  it("reveals the owning window without mutating either composition", async () => {
    const window = { id: "window-a" };
    const otherWindow = { id: "window-b" };
    const state = stateWith("a");
    const revealWindow = vi.fn();
    const service = createService({
      state,
      indexedPaths: new Map([["/a", window], ["/b", otherWindow]]),
      revealWindow,
    });

    const result = await service.attach(window, "/b");

    expect(result.status).toBe("focused-existing");
    expect(revealWindow).toHaveBeenCalledWith(otherWindow, "/b");
    expect(state.folderPaths).toEqual(["/a"]);
  });

  it("leaves the old snapshot authoritative when persistence fails", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a");
    const indexedPaths = new Map([["/a", window]]);
    const service = createService({
      state,
      indexedPaths,
      persistWorkspaceComposition: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    await expect(service.attach(window, "/b")).rejects.toThrow(/disk full/i);
    expect(state.folderPaths).toEqual(["/a"]);
    expect(indexedPaths.has("/b")).toBe(false);
  });

  it("stops project resources before persisting and publishing a detached Folder", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a", "b");
    const indexedPaths = new Map([["/a", window], ["/b", window]]);
    const events = [];
    const service = createService({
      state,
      indexedPaths,
      persistWorkspaceComposition: vi.fn(async () => events.push("persisted")),
      onUnindex: () => events.push("published"),
      cleanupDetachedWorkspace: vi.fn(async () => events.push("cleaned")),
    });

    const result = await service.detach(window, "/b");

    expect(events).toEqual(["cleaned", "persisted", "published"]);
    expect(result).toMatchObject({ status: "detached-current", path: "/b" });
    expect(result.workspaceId).toBe(state.workspaceId);
    expect(result.workspaces.map((item) => item.id)).toEqual(["a"]);
    expect(state.folderPaths).toEqual(["/a"]);
    expect(indexedPaths.has("/b")).toBe(false);
  });

  it("does not publish a detach when persistence fails", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a", "b");
    const indexedPaths = new Map([["/a", window], ["/b", window]]);
    const cleanupDetachedWorkspace = vi.fn();
    const service = createService({
      state,
      indexedPaths,
      cleanupDetachedWorkspace,
      persistWorkspaceComposition: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    await expect(service.detach(window, "/b")).rejects.toThrow(/disk full/i);
    expect(state.folderPaths).toEqual(["/a", "/b"]);
    expect(indexedPaths.get("/b")).toBe(window);
    expect(cleanupDetachedWorkspace).toHaveBeenCalledOnce();
  });

  it("closes the last Project and leaves an empty composition", async () => {
    const window = { id: "window-a" };
    const state = stateWith("a");
    const service = createService({ state, indexedPaths: new Map([["/a", window]]) });

    await expect(service.detach(window, "/a")).resolves.toMatchObject({ status: "detached-current", workspaces: [] });
    expect(state.folderPaths).toEqual([]);
  });
});

function createService({
  state,
  indexedPaths,
  persistWorkspaceComposition = vi.fn(async () => undefined),
  revealWindow = vi.fn(),
  onIndex = () => undefined,
  onUnindex = () => undefined,
  cleanupDetachedWorkspace = vi.fn(async () => undefined),
}) {
  return createWindowWorkspaceCompositionService({
    canonicalizeWorkspacePath: async (folderPath) => folderPath,
    getWindowState: () => state,
    getWorkspaceWindow: (folderPath) => indexedPaths.get(folderPath) ?? null,
    indexWorkspacePath: (folderPath, window) => {
      indexedPaths.set(folderPath, window);
      onIndex();
    },
    unindexWorkspacePath: (folderPath, window) => {
      if (indexedPaths.get(folderPath) === window) indexedPaths.delete(folderPath);
      onUnindex();
    },
    cleanupDetachedWorkspace,
    persistWorkspaceComposition,
    revealWindow,
    workspaceFromPath: async (folderPath) => workspace(folderPath.slice(1)),
  });
}

function stateWith(...ids) {
  const state = new WindowWorkspaceState({ initialWorkspaceId: "workbench:test-window" });
  state.replaceFolders(ids.map((id) => ({ path: `/${id}`, workspace: workspace(id) })));
  return state;
}

function workspace(id) {
  return { id, name: id.toUpperCase(), path: `/${id}`, workspaceInstanceId: `instance-${id}` };
}
