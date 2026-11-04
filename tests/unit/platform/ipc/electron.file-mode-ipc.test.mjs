import { describe, expect, it, vi } from "vitest";
import { registerFileModeIpcHandlers } from "../../../../electron/main/ipc/file-mode-ipc.mjs";
import { WindowWorkspaceState } from "../../../../electron/main/window-workspace-state.mjs";

const fileTarget = { path: "/notes/plan.md", rootPath: "/notes", name: "plan.md" };

function createHarness({ isFileWindow = true } = {}) {
  const handlers = new Map();
  const ipcMain = { on: (channel, listener) => handlers.set(channel, listener), handle: (channel, listener) => handlers.set(channel, listener) };
  const window = { setDocumentEdited: vi.fn() };
  const state = new WindowWorkspaceState({ fileTarget });
  registerFileModeIpcHandlers({
    ipcMain,
    getFileWindow: () => (isFileWindow ? { state, window } : null),
  });
  return { handlers, window, state, event: { sender: { id: 1 } } };
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

  it("ignores requests from windows that are not showing a file", () => {
    const { handlers, window, event } = createHarness({ isFileWindow: false });

    handlers.get("file-mode:set-edited")(event, true);
    expect(window.setDocumentEdited).not.toHaveBeenCalled();
  });

  it("offers no way from a file window into a project", () => {
    const { handlers } = createHarness();
    expect([...handlers.keys()]).toEqual(["file-mode:set-edited"]);
  });
});
