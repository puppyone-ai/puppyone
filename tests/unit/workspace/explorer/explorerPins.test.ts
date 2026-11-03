// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
  type DataNode,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  EXPLORER_PINS_STORAGE_PREFIX,
  explorerPinsStore,
  getExplorerPinsProjectKey,
} from "../../../../src/features/data-workspace/explorerPins";

const root = createWorkspaceRootUri("pins-test");
const file = (path: string): DataNode => {
  const uri = createWorkspaceResourceUri(root, path);
  return { id: uri, name: path.split("/").at(-1) ?? path, path: uri, type: "markdown", resourceUri: uri };
};
let projectSequence = 0;
const nextProject = () => `/tmp/pins-project-${projectSequence += 1}`;

afterEach(() => window.localStorage.clear());

describe("explorer pins", () => {
  it("pins and unpins files in the order they were pinned", () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, file("b.md"));
    explorerPinsStore.toggle(project, file("a/c.md"));
    expect(explorerPinsStore.get(project).files.map(({ name }) => name)).toEqual(["b.md", "c.md"]);

    explorerPinsStore.toggle(project, file("b.md"));
    expect(explorerPinsStore.get(project).files.map(({ name }) => name)).toEqual(["c.md"]);
    expect(explorerPinsStore.isPinned(project, file("a/c.md").path)).toBe(true);
  });

  it("never pins a folder", () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, { ...file("folder"), type: "folder" });
    expect(explorerPinsStore.get(project).files).toEqual([]);
  });

  it("keeps a pin through a rename and through a move of its folder", () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, file("notes/今日.md"));
    explorerPinsStore.rebase(project, file("notes/今日.md").path, file("notes/今日-v2.md").path);
    expect(explorerPinsStore.get(project).files[0]).toMatchObject({
      name: "今日-v2.md",
      path: file("notes/今日-v2.md").path,
      id: file("notes/今日-v2.md").path,
    });

    explorerPinsStore.rebase(project, file("notes").path, file("archive/notes").path);
    expect(explorerPinsStore.get(project).files[0].path).toBe(file("archive/notes/今日-v2.md").path);
  });

  it("drops pins for a deleted file or anything under a deleted folder", () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, file("keep.md"));
    explorerPinsStore.toggle(project, file("old/a.md"));
    explorerPinsStore.toggle(project, file("old/deep/b.md"));
    explorerPinsStore.removeUnder(project, file("old").path);
    expect(explorerPinsStore.get(project).files.map(({ name }) => name)).toEqual(["keep.md"]);
  });

  it("only folds the tree while something is pinned", () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, file("a.md"));
    explorerPinsStore.setFilesCollapsed(project, true);
    expect(explorerPinsStore.get(project).filesCollapsed).toBe(true);

    explorerPinsStore.unpin(project, file("a.md").path);
    expect(explorerPinsStore.get(project).filesCollapsed).toBe(false);
  });

  it("restores pins and the fold from storage for the same project only", async () => {
    const project = nextProject();
    explorerPinsStore.toggle(project, file("a.md"));
    explorerPinsStore.setFilesCollapsed(project, true);
    expect(window.localStorage.getItem(`${EXPLORER_PINS_STORAGE_PREFIX}:${project}`)).not.toBeNull();

    vi.resetModules();
    const reloaded = await import("../../../../src/features/data-workspace/explorerPins");
    expect(reloaded.explorerPinsStore.get(project)).toMatchObject({
      files: [{ name: "a.md", path: file("a.md").path }],
      filesCollapsed: true,
    });
    expect(reloaded.explorerPinsStore.get(nextProject()).files).toEqual([]);
  });

  it("ignores stored entries that are not pinned files", async () => {
    const project = nextProject();
    window.localStorage.setItem(`${EXPLORER_PINS_STORAGE_PREFIX}:${project}`, JSON.stringify({
      files: [{ id: "x", name: "x", path: "x", type: "folder" }, { path: 3 }, file("ok.md")],
      filesCollapsed: "yes",
    }));
    vi.resetModules();
    const reloaded = await import("../../../../src/features/data-workspace/explorerPins");
    expect(reloaded.explorerPinsStore.get(project)).toMatchObject({
      files: [{ name: "ok.md" }],
      filesCollapsed: false,
    });
  });

  it("keys a multi-folder project by all of its folders, whichever has focus", () => {
    const folder = (path: string) => ({ uri: path, workspace: { path } }) as unknown as WorkspaceFolder;
    const folders = [folder("/a"), folder("/b")];
    expect(getExplorerPinsProjectKey({ path: "/a" } as Workspace, folders))
      .toBe(getExplorerPinsProjectKey({ path: "/b" } as Workspace, folders));
    expect(getExplorerPinsProjectKey({ path: "/solo" } as Workspace, [])).toBe("/solo");
    expect(getExplorerPinsProjectKey(null, [])).toBeNull();
  });
});
