import { describe, expect, it, vi } from "vitest";
import { registerCloudIpcHandlers } from "../../../../electron/main/ipc/cloud-ipc.mjs";

function register(cloudAuthService) {
  const handlers = new Map();
  registerCloudIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    cloudAuthService,
  });
  return handlers;
}

const expectedSession = { userId: "user-1", generation: "generation-1" };

describe("Cloud IPC structured error transport", () => {
  it("requires a renderer account lease instead of silently adopting Main's account", async () => {
    const requestSessionApi = vi.fn();
    const handlers = register({ requestSessionApi });
    const result = await handlers.get("cloud:session-api-request")(null, {
      apiBaseUrl: "https://api.puppyone.ai/api/v1", path: "/content/project/write", method: "POST",
    });
    expect(result.ok).toBe(false);
    expect(requestSessionApi).not.toHaveBeenCalled();
  });

  it("returns session API data in a versioned success envelope", async () => {
    const requestSessionApi = vi.fn().mockResolvedValue({ project: { id: "project-1" } });
    const handlers = register({ requestSessionApi });

    const result = await handlers.get("cloud:session-api-request")(null, {
      expectedSession,
      apiBaseUrl: "https://api.puppyone.ai/api/v1",
      path: "/projects/project-1/repository-context",
      method: "POST",
      body: "{}",
    });

    expect(result).toEqual({
      transport: "puppyone-cloud-ipc-v1",
      ok: true,
      data: { project: { id: "project-1" } },
    });
    expect(requestSessionApi.mock.calls[0][3]).toEqual(expectedSession);
  });

  it("preserves status and code without parsing Electron rejection text", async () => {
    const error = Object.assign(new Error("The Project already accepted its first push"), {
      status: 409,
      code: "initialization_not_abandonable",
    });
    const handlers = register({ requestSessionApi: vi.fn().mockRejectedValue(error) });

    const result = await handlers.get("cloud:session-api-request")(null, {
      expectedSession,
      apiBaseUrl: "https://api.puppyone.ai/api/v1",
      path: "/projects/project-1/repository-context",
      method: "POST",
      body: "{}",
    });

    expect(result).toEqual({
      transport: "puppyone-cloud-ipc-v1",
      ok: false,
      error: {
        status: 409,
        code: "initialization_not_abandonable",
        message: "The Project already accepted its first push",
      },
    });
  });
});
