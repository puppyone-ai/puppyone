import { describe, expect, it, vi } from "vitest";
import { registerCloudPublishIpcHandlers } from "../../../../electron/main/ipc/cloud-publish-ipc.mjs";

describe("Cloud publish progress IPC", () => {
  it("sends main-owned progress only to the renderer that started the publish", async () => {
    const handlers = new Map();
    const startOrResume = vi.fn(async (request, { onProgress }) => {
      onProgress({
        rootPath: request.rootPath,
        operationId: "operation-1",
        stage: "uploading",
        state: null,
        updatedAt: "2026-07-17T00:00:00.000Z",
      });
      return { ok: true, state: null };
    });
    registerCloudPublishIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      authorizeWorkspaceRoot: async () => "/authorized/repo",
      cloudPublishCoordinator: {
        getState: vi.fn(),
        startOrResume,
        cleanup: vi.fn(),
      },
    });
    const sender = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    const result = await handlers.get("cloud-initialization:start")(
      { sender },
      { rootPath: "/untrusted/repo" },
    );

    expect(result).toEqual({ ok: true, state: null });
    expect(startOrResume.mock.calls[0][0]).toMatchObject({ rootPath: "/authorized/repo" });
    expect(sender.send).toHaveBeenCalledWith("cloud-initialization:progress", {
      rootPath: "/authorized/repo",
      operationId: "operation-1",
      stage: "uploading",
      state: null,
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("does not expose authorization exceptions across the IPC boundary", async () => {
    const handlers = new Map();
    registerCloudPublishIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      authorizeWorkspaceRoot: async () => {
        throw new Error("Electron internal /Users/private pwg_must_not_cross");
      },
      cloudPublishCoordinator: {
        getState: vi.fn(),
        startOrResume: vi.fn(),
        cleanup: vi.fn(),
      },
    });

    const result = await handlers.get("cloud-initialization:get-state")(
      { sender: {} },
      { rootPath: "/untrusted/repo" },
    );

    expect(result).toEqual({
      ok: false,
      state: null,
      error: {
        code: "UNKNOWN",
        retryable: false,
        message: "Unable to authorize the local workspace for Cloud publishing.",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/Electron internal|\/Users\/private|pwg_/);
  });
});
