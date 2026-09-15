import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../../../packages/shared-ui/src/core/types";
import {
  WorkbenchWorkspaceContext,
  createWorkbenchWorkspace,
  createSingleFolderWorkbenchWorkspace,
  createWorkspaceFolder,
} from "../../../../packages/shared-ui/src/core/workbenchWorkspace";
import {
  createResourceUri,
  createWorkspaceResourceUri,
} from "../../../../packages/shared-ui/src/core/resourceUri";

describe("WorkbenchWorkspaceContext", () => {
  it("creates one stable Workbench identity independent of Folder order", async () => {
    const first = workspace("first", "/projects/first", "instance-first");
    const second = workspace("second", "/projects/second", "instance-second");

    const composition = createWorkbenchWorkspace([first, second], { id: "workbench:window-1" });
    const context = new WorkbenchWorkspaceContext(composition);

    expect(composition.id).toBe("workbench:window-1");
    expect(composition.folders.map((folder) => folder.workspace.id)).toEqual([first.id, second.id]);
    expect(composition.folders.map((folder) => folder.index)).toEqual([0, 1]);

    await context.detachFolder(first.workspaceInstanceId!);
    expect(context.getWorkspace().id).toBe("workbench:window-1");
    expect(context.getWorkspace().folders.map((folder) => folder.id)).toEqual([
      second.workspaceInstanceId,
    ]);
  });
  it("runs the single-folder product through the zero/one/many-folder model", async () => {
    const legacy = workspace("workspace-a", "/projects/a", "instance-a");
    const initial = createSingleFolderWorkbenchWorkspace(legacy);
    const context = new WorkbenchWorkspaceContext(initial);

    expect(context.getWorkspace().folders).toHaveLength(1);
    expect(context.getWorkspace().folders[0]?.workspace).toEqual(legacy);
    expect(Object.isFrozen(context.getWorkspace())).toBe(true);

    await context.attachFolder(createWorkspaceFolder(
      workspace("workspace-b", "/projects/b", "instance-b"),
    ));

    expect(context.getWorkspace().folders.map(({ id, index }) => [id, index])).toEqual([
      ["instance-a", 0],
      ["instance-b", 1],
    ]);
    expect(context.getWorkspaceFolder(
      createWorkspaceResourceUri(context.getWorkspace().folders[1]!.uri, "src/App.tsx"),
    )?.id).toBe("instance-b");
  });

  it("publishes one immutable revision after asynchronous removal barriers settle", async () => {
    const first = createWorkspaceFolder(workspace("a", "/a", "instance-a"));
    const second = createWorkspaceFolder(workspace("b", "/b", "instance-b"));
    const context = new WorkbenchWorkspaceContext({
      id: "window-workspace",
      folders: [first, second],
      transient: true,
      revision: 4,
    });
    const didChange = vi.fn();
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    context.onWillChangeWorkspaceFolders((event) => event.join(barrier));
    context.onDidChangeWorkspaceFolders(didChange);

    const removing = context.detachFolder("instance-a");
    await Promise.resolve();
    expect(context.getWorkspace().revision).toBe(4);
    expect(context.getWorkspace().folders).toHaveLength(2);
    expect(didChange).not.toHaveBeenCalled();

    releaseBarrier();
    await removing;

    expect(context.getWorkspace().revision).toBe(5);
    expect(context.getWorkspace().folders.map(({ id }) => id)).toEqual(["instance-b"]);
    expect(didChange).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "window-workspace",
      revision: 5,
      removed: [expect.objectContaining({ id: "instance-a" })],
    }));
  });

  it("serializes concurrent mutations and rejects duplicate folder identity", async () => {
    const context = new WorkbenchWorkspaceContext({
      id: "window-workspace",
      folders: [],
      transient: true,
      revision: 0,
    });
    const first = createWorkspaceFolder(workspace("a", "/a", "instance-a"));
    const duplicate = createWorkspaceFolder(workspace("a-copy", "/a-copy", "instance-a"));

    const attached = context.attachFolder(first);
    const rejected = context.attachFolder(duplicate);
    await attached;
    await expect(rejected).rejects.toThrow(/already attached|duplicate/i);
    expect(context.getWorkspace().folders.map(({ id }) => id)).toEqual(["instance-a"]);
  });

  it("resolves overlapping provider roots to the most specific Folder", () => {
    const root = createWorkspaceFolder(workspace("root", "/repo", "root"), {
      uri: createResourceUri({ scheme: "test", authority: "local", path: "repo" }),
    });
    const nested = createWorkspaceFolder(workspace("nested", "/repo/packages/ui", "nested"), {
      uri: createResourceUri({
        scheme: "test",
        authority: "local",
        path: "repo/packages/ui",
      }),
    });
    const context = new WorkbenchWorkspaceContext({
      id: "overlapping",
      folders: [root, nested],
      transient: true,
      revision: 0,
    });
    const resource = createResourceUri({
      scheme: "test",
      authority: "local",
      path: "repo/packages/ui/src/App.tsx",
    });

    expect(context.getWorkspaceFolder(resource)?.id).toBe("nested");
  });
});

function workspace(id: string, path: string, workspaceInstanceId: string): Workspace {
  return {
    id,
    name: id,
    path,
    status: "recording",
    workspaceInstanceId,
  };
}
