import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_SURFACE_OCCLUSION_CHANNEL,
  registerNativeSurfaceOcclusionIpcHandlers,
} from "../../../../electron/main/ipc/native-surface-occlusion-ipc.mjs";

describe("native surface occlusion IPC", () => {
  it("derives the owner from Electron's sender and ignores malformed state", () => {
    const listeners = new Map();
    const coordinator = { setOwnerOccluded: vi.fn() };
    registerNativeSurfaceOcclusionIpcHandlers({
      ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
      coordinator,
    });
    const listener = listeners.get(NATIVE_SURFACE_OCCLUSION_CHANNEL);

    listener({ sender: { id: 42 } }, { ownerWebContentsId: 999, occluded: true });
    listener({ sender: { id: 42 } }, { occluded: "true" });
    listener({ sender: { id: 0 } }, { occluded: false });

    expect(coordinator.setOwnerOccluded).toHaveBeenCalledOnce();
    expect(coordinator.setOwnerOccluded).toHaveBeenCalledWith(42, true);
  });
});
