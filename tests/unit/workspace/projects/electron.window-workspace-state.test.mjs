import { describe, expect, it } from "vitest";
import { WindowWorkspaceState } from "../../../../electron/main/window-workspace-state.mjs";

describe("WindowWorkspaceState", () => {
  it("models one visible folder as a general ordered composition", () => {
    const state = new WindowWorkspaceState({
      initialWorkspaceId: "workbench:persisted",
      initialWorkspacePaths: ["/initial", "/second"],
    });
    expect(state.workspaceId).toBe("workbench:persisted");
    expect(state.initialRestorePath).toBe("/initial");
    expect(state.initialRestorePaths).toEqual(["/initial", "/second"]);
    expect(state.folderPaths).toEqual([]);

    const change = state.replaceFolders([
      { path: "/a", workspace: { id: "a", name: "A" } },
      { path: "/b", workspace: { id: "b", name: "B" } },
    ]);

    expect(change).toEqual({
      addedPaths: ["/a", "/b"],
      removedPaths: [],
      retainedPaths: [],
    });
    expect(state.folderPaths).toEqual(["/a", "/b"]);
    expect(state.primaryWorkspace).toMatchObject({ id: "a" });
    expect(state.initialRestorePath).toBe("/a");
    expect(state.initialRestorePaths).toEqual(["/a", "/b"]);

    state.replaceFolders([
      { path: "/b", workspace: { id: "b", name: "B" } },
    ]);
    expect(state.workspaceId).toBe("workbench:persisted");
    expect(state.beginNewWorkspace("workbench:replacement")).toBe("workbench:replacement");
    expect(state.workspaceId).toBe("workbench:replacement");
  });

  it("reports scoped Folder changes and releases an immutable snapshot", () => {
    const state = new WindowWorkspaceState();
    state.replaceFolders([
      { path: "/a", workspace: { id: "a", name: "A" } },
      { path: "/b", workspace: { id: "b", name: "B" } },
    ]);

    expect(state.replaceFolders([
      { path: "/b", workspace: { id: "b", name: "B" } },
      { path: "/c", workspace: { id: "c", name: "C" } },
    ])).toEqual({
      addedPaths: ["/c"],
      removedPaths: ["/a"],
      retainedPaths: ["/b"],
    });

    const released = state.releaseFolders();
    expect(released.map(({ path }) => path)).toEqual(["/b", "/c"]);
    expect(Object.isFrozen(released)).toBe(true);
    expect(state.folderPaths).toEqual([]);
    expect(state.primaryWorkspace).toBeNull();
  });

  it("rejects duplicate paths and duplicate Folder identity", () => {
    const state = new WindowWorkspaceState();
    expect(() => state.replaceFolders([
      { path: "/a", workspace: { id: "same", name: "A" } },
      { path: "/a", workspace: { id: "other", name: "B" } },
    ])).toThrow(/duplicate.*path/i);
    expect(() => state.replaceFolders([
      { path: "/a", workspace: { id: "same", name: "A" } },
      { path: "/b", workspace: { id: "same", name: "B" } },
    ])).toThrow(/duplicate.*identity/i);
    expect(() => state.replaceFolders([
      { path: "/repo", workspace: { id: "root", name: "Root" } },
      { path: "/repo/packages/ui", workspace: { id: "nested", name: "Nested" } },
    ])).toThrow(/overlapping Workspace Folder/i);
  });
});
