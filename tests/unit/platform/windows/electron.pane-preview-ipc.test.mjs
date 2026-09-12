import { describe, expect, it, vi } from "vitest";
import {
  PANE_PREVIEW_CAPTURE_CHANNEL,
  normalizeCaptureRect,
  registerPanePreviewIpcHandlers,
} from "../../../../electron/main/ipc/pane-preview-ipc.mjs";

describe("pane preview IPC", () => {
  it("captures a bounded sender rectangle and returns a small bitmap", async () => {
    const resized = {
      isEmpty: vi.fn(() => false),
      toDataURL: vi.fn(() => "data:image/png;base64,c25hcHNob3Q="),
    };
    const snapshot = {
      isEmpty: vi.fn(() => false),
      resize: vi.fn(() => resized),
    };
    const sender = {
      capturePage: vi.fn(async () => snapshot),
    };
    const ownerWindow = createWindow();
    const handler = register(ownerWindow);

    await expect(handler({ sender }, {
      x: -10,
      y: 10,
      width: 500,
      height: 300,
    })).resolves.toEqual({
      dataUrl: "data:image/png;base64,c25hcHNob3Q=",
      width: 144,
      height: 83,
    });
    expect(sender.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 10, width: 400, height: 230 },
      { stayHidden: true, stayAwake: false },
    );
    expect(snapshot.resize).toHaveBeenCalledWith({ width: 144, height: 83, quality: "good" });
  });

  it("rejects invalid or unavailable capture surfaces", async () => {
    expect(normalizeCaptureRect({ x: 0, y: 0, width: 0, height: 20 }, [400, 240])).toBeNull();
    expect(normalizeCaptureRect({ x: 0, y: 0, width: 20, height: 20 }, null)).toBeNull();

    const handler = register(createWindow({ destroyed: true }));
    await expect(handler({ sender: { capturePage: vi.fn() } }, {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    })).resolves.toBeNull();
  });
});

function register(ownerWindow) {
  let handler;
  registerPanePreviewIpcHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        expect(channel).toBe(PANE_PREVIEW_CAPTURE_CHANNEL);
        handler = listener;
      },
    },
    BrowserWindow: {
      fromWebContents: () => ownerWindow,
    },
  });
  if (!handler) throw new Error("Pane preview IPC handler was not registered.");
  return handler;
}

function createWindow({ destroyed = false } = {}) {
  return {
    getContentSize: vi.fn(() => [400, 240]),
    isDestroyed: vi.fn(() => destroyed),
  };
}
