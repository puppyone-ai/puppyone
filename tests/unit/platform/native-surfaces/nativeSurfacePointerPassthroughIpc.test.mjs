import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_SURFACE_POINTER_PASSTHROUGH_CHANNEL,
  NATIVE_SURFACE_POINTER_ROUTING_REGIONS_CHANNEL,
  registerNativeSurfacePointerPassthroughIpcHandlers,
} from "../../../../electron/main/ipc/native-surface-pointer-passthrough-ipc.mjs";

describe("native surface pointer passthrough IPC", () => {
  it("derives the owner from Electron's sender and ignores malformed state", () => {
    const listeners = new Map();
    const coordinator = {
      setOwnerActive: vi.fn(),
      setOwnerRoutingRegions: vi.fn(),
    };
    registerNativeSurfacePointerPassthroughIpcHandlers({
      ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
      coordinator,
    });
    const listener = listeners.get(NATIVE_SURFACE_POINTER_PASSTHROUGH_CHANNEL);

    listener({ sender: { id: 42 } }, { ownerWebContentsId: 999, active: true });
    listener({ sender: { id: 42 } }, { active: "true" });
    listener({ sender: { id: 0 } }, { active: false });

    expect(coordinator.setOwnerActive).toHaveBeenCalledOnce();
    expect(coordinator.setOwnerActive).toHaveBeenCalledWith(42, true);
  });

  it("accepts only bounded owner-scoped integer routing rectangles", () => {
    const listeners = new Map();
    const coordinator = {
      setOwnerActive: vi.fn(),
      setOwnerRoutingRegions: vi.fn(),
    };
    registerNativeSurfacePointerPassthroughIpcHandlers({
      ipcMain: { on: (channel, listener) => listeners.set(channel, listener) },
      coordinator,
    });
    const listener = listeners.get(NATIVE_SURFACE_POINTER_ROUTING_REGIONS_CHANNEL);

    listener({ sender: { id: 42 } }, {
      ownerWebContentsId: 999,
      regions: [{ x: 320, y: 38, width: 8, height: 700 }],
    });
    listener({ sender: { id: 42 } }, {
      regions: [{ x: 320.5, y: 38, width: 8, height: 700 }],
    });
    listener({ sender: { id: 42 } }, {
      regions: [{ x: 320, y: 38, width: 0, height: 700 }],
    });
    listener({ sender: { id: 42 } }, {
      regions: [{ x: -1, y: 38, width: 8, height: 700 }],
    });

    expect(coordinator.setOwnerRoutingRegions).toHaveBeenCalledOnce();
    expect(coordinator.setOwnerRoutingRegions).toHaveBeenCalledWith(42, [
      { x: 320, y: 38, width: 8, height: 700 },
    ]);
  });
});
