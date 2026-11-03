import { describe, expect, it, vi } from "vitest";
import { registerFileModeIpcHandlers } from "../../../../electron/main/ipc/file-mode-ipc.mjs";
import { WindowWorkspaceState } from "../../../../electron/main/window-workspace-state.mjs";

const fileTarget = { path: "/notes/plan.md", rootPath: "/notes", name: "plan.md" };

function createHarness({ isFileWindow = true, openFolder = vi.fn(async () => undefined) } = {}) {
  const handlers = new Map();
  const ipcMain = { on: (channel, listener) => handlers.set(channel, listener), handle: (channel, listener) => handlers.set(channel, listener) };
  const window = { setDocumentEdited: vi.fn(), close: vi.fn() };
  const state = new WindowWorkspaceState({ fileTarget });
  registerFileModeIpcHandlers({
    ipcMain,
    openFolder,
    getFileWindow: () => (isFileWindow ? { state, window } : null),
  });
  return { handlers, window, state, openFolder, event: { sender: { id: 1 } } };
}

describe("File Mode IPC", () => {
  it("tracks unsaved edits for the close prompt and the native edited mark", () => {
    const { handlers, window, state, event } = createHarness();

    handlers.get("file-mode:set-edited")(event, true);
    expect(state.fileEdited).toBe(true);
    expect(window.setDocumentEdited).toHaveBeenLastCalledWith(true);

    handlers.get("file-mode:set-edited")(event, false);
    expect(state.fileEdited).toBe(false);
    expect(window.setDocumentEdited).toHaveBeenLastCalledWith(false);
  });

  it("only accepts a real boolean as edited", () => {
    const { handlers, state, event } = createHarness();
    handlers.get("file-mode:set-edited")(event, "yes");
    expect(state.fileEdited).toBe(false);
  });

  it("opens the folder as a project, then closes the file window", async () => {
    const { handlers, window, openFolder, event } = createHarness();
    await handlers.get("file-mode:open-folder")(event);

    expect(openFolder).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/notes", name: "plan.md" }));
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("keeps the file window when the folder cannot open", async () => {
    const { handlers, window, event } = createHarness({
      openFolder: vi.fn(async () => { throw new Error("gone"); }),
    });
    await expect(handlers.get("file-mode:open-folder")(event)).rejects.toThrow("gone");
    expect(window.close).not.toHaveBeenCalled();
  });

  it("ignores requests from windows that are not showing a file", async () => {
    const { handlers, window, openFolder, event } = createHarness({ isFileWindow: false });

    handlers.get("file-mode:set-edited")(event, true);
    expect(window.setDocumentEdited).not.toHaveBeenCalled();
    await expect(handlers.get("file-mode:open-folder")(event)).rejects.toThrow("not showing a file");
    expect(openFolder).not.toHaveBeenCalled();
  });
});
