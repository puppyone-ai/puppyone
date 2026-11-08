import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nearestExistingAncestor, probeFolderAvailability } from "../../../../electron/main/folder-availability.mjs";
import { createFolderRelocation } from "../../../../electron/main/folder-relocation.mjs";
import { registerWorkspaceNavigationIpcHandlers } from "../../../../electron/main/ipc/workspace-navigation-ipc.mjs";

let root;
beforeEach(async () => { root = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-relocation-"))); });
afterEach(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });

const identityOf = async (folder) => {
  const info = await fs.promises.stat(folder);
  return { fsIdentity: `fs:${Number(info.dev)}:${Number(info.ino)}`, puppyoneGitRemote: null };
};

describe("whether a project's folder can be opened now", () => {
  it("tells a folder that is there from one that is gone, a file, or one PuppyOne may not read", async () => {
    const folder = path.join(root, "Plans");
    await fs.promises.mkdir(folder);
    await fs.promises.writeFile(path.join(root, "notes.md"), "");
    expect(await probeFolderAvailability(folder)).toEqual({ state: "available" });
    expect(await probeFolderAvailability(path.join(root, "Gone"))).toEqual({ state: "missing" });
    expect(await probeFolderAvailability(path.join(root, "notes.md"))).toEqual({ state: "not-a-folder" });
    const denied = { promises: { stat: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } } };
    expect(await probeFolderAvailability(folder, { fsModule: denied })).toEqual({ state: "denied" });
  });

  it("says a disk is away rather than the folder gone, so nothing is offered for removal that will come back", async () => {
    expect(await probeFolderAvailability("/Volumes/PuppyOne Test Disk That Is Not Here/Plans", { platform: "darwin" }))
      .toEqual({ state: "disconnected" });
    expect(await probeFolderAvailability("\\\\nas\\projects\\Plans", { platform: "win32", fsModule: {
      promises: { stat: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } } } }))
      .toEqual({ state: "disconnected" });
    // A missing folder on this computer's own disk is just missing.
    expect(await probeFolderAvailability(path.join(root, "Gone"), { platform: "darwin" })).toEqual({ state: "missing" });
  });

  it("starts looking for a moved folder from the closest place above it that is still there", async () => {
    expect(await nearestExistingAncestor(path.join(root, "a", "b", "Plans"))).toBe(root);
    expect(await nearestExistingAncestor("/no-such-root-for-puppyone/Plans", { home: "/home/me" })).toBe("/");
  });
});

describe("finding where a project's folder went", () => {
  function service({ recents, windowFolders = [], dialogPath = null } = {}) {
    const relocateRecent = vi.fn(async (from, to) => ({ path: to, wasShared: recents.find((item) => item.path === from)?.hostFolderId !== undefined }));
    const retireSharesAtMissingRoot = vi.fn(async () => ({ retired: 0 }));
    const closeSessionsAt = vi.fn(async () => undefined);
    const showOpenDialog = vi.fn(async () => (dialogPath ? { canceled: false, filePaths: [dialogPath] } : { canceled: true, filePaths: [] }));
    let clock = 1_000;
    const relocation = createFolderRelocation({
      listRecentWorkspaces: async () => recents,
      windowFolderPaths: async () => windowFolders,
      resolveIdentity: identityOf,
      showOpenDialog,
      relocateRecent,
      retireSharesAtMissingRoot,
      closeSessionsAt,
      home: root,
      now: () => clock,
    });
    return { relocation, relocateRecent, retireSharesAtMissingRoot, closeSessionsAt, showOpenDialog, advance: (ms) => { clock += ms; } };
  }

  it("recognises the same folder renamed where it was, and uses it once confirmed", async () => {
    const before = path.join(root, "大使计划A");
    await fs.promises.mkdir(before);
    const record = { path: before, name: "大使计划A", ...(await identityOf(before)) };
    const after = path.join(root, "大使计划B");
    await fs.promises.rename(before, after);
    const { relocation, relocateRecent, retireSharesAtMissingRoot, closeSessionsAt } = service({ recents: [record] });

    const [status] = await relocation.status({}, [before]);
    expect(status).toMatchObject({ path: before, state: "missing", suggestion: { path: after, name: "大使计划B", match: "same-folder" } });

    expect(await relocation.relocate(status.suggestion.token)).toEqual({ from: before, path: after, wasShared: false });
    expect(relocateRecent).toHaveBeenCalledExactlyOnceWith(before, after);
    // What a window still held open at the gone place ends first, so the same folder reopens at its new one.
    expect(closeSessionsAt).toHaveBeenCalledExactlyOnceWith(before);
    expect(closeSessionsAt.mock.invocationCallOrder[0]).toBeLessThan(relocateRecent.mock.invocationCallOrder[0]);
    expect(retireSharesAtMissingRoot).toHaveBeenCalledExactlyOnceWith(before);
    // A confirmation is used once.
    await expect(relocation.relocate(status.suggestion.token)).rejects.toThrow("Choose the folder again.");
  });

  it("answers only for projects it knows, so the screen cannot probe any path", async () => {
    const elsewhere = path.join(root, "Somebody else's");
    await fs.promises.mkdir(elsewhere);
    const { relocation } = service({ recents: [] });
    expect(await relocation.status({}, [elsewhere])).toEqual([]);
    await expect(relocation.locate({}, elsewhere, null)).rejects.toThrow("not one PuppyOne knows");
  });

  it("says whether a folder the person points at is the same project, and never applies a stale choice", async () => {
    const gone = path.join(root, "Plans");
    const chosen = path.join(root, "Another folder");
    await fs.promises.mkdir(chosen);
    const record = { path: gone, name: "Plans", fsIdentity: "fs:1:2" };
    const { relocation, showOpenDialog, advance } = service({ recents: [record], dialogPath: chosen });

    const located = await relocation.locate({}, gone, null);
    expect(located).toMatchObject({ status: "selected", path: chosen, match: "different" });
    // The dialog opens where looking makes sense: the closest place still there.
    expect(showOpenDialog.mock.calls[0][1]).toMatchObject({ defaultPath: root, properties: ["openDirectory"] });

    advance(11 * 60_000);
    await expect(relocation.relocate(located.token)).rejects.toThrow("Choose the folder again.");
  });

  it("reports a shared project's share as withdrawn, so it can be shared again from the new place", async () => {
    const before = path.join(root, "Shared");
    await fs.promises.mkdir(before);
    const record = { path: before, name: "Shared", hostFolderId: "f-1", ...(await identityOf(before)) };
    const after = path.join(root, "Shared now");
    await fs.promises.rename(before, after);
    const { relocation } = service({ recents: [record] });
    const [status] = await relocation.status({}, [before]);
    expect(await relocation.relocate(status.suggestion.token)).toMatchObject({ path: after, wasShared: true });
  });
});

describe("asking Main about a project's folder from the screen", () => {
  it("routes each question to the relocation service for the asking window only", async () => {
    const handlers = new Map();
    const folderRelocation = {
      status: vi.fn(async () => [{ path: "/gone", state: "missing" }]),
      locate: vi.fn(async () => ({ status: "cancelled" })),
      relocate: vi.fn(async () => ({ from: "/gone", path: "/here", wasShared: false })),
    };
    const ownerWindow = { id: "window" };
    registerWorkspaceNavigationIpcHandlers({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      workspaceStateStore: {},
      folderRelocation,
      getDialogOwnerWindow: (sender) => (sender.id === 7 ? ownerWindow : null),
    });
    const event = { sender: { id: 7 } };

    expect(await handlers.get("workspace:folder-status")(event, { paths: ["/gone"] })).toEqual([{ path: "/gone", state: "missing" }]);
    expect(folderRelocation.status).toHaveBeenCalledWith(event.sender, ["/gone"]);
    await handlers.get("workspace:locate-folder")(event, { path: "/gone" });
    expect(folderRelocation.locate).toHaveBeenCalledWith(event.sender, "/gone", ownerWindow);
    await handlers.get("workspace:relocate-folder")(event, { token: "t-1" });
    expect(folderRelocation.relocate).toHaveBeenCalledWith("t-1");
  });
});
