import { describe, expect, it, vi } from "vitest";
import { cloudOpeningStage, registerCloudIpcHandlers } from "../../../../electron/main/ipc/cloud-ipc.mjs";

function register(cloudAuthService, diagnostics = null) {
  const handlers = new Map();
  registerCloudIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    cloudAuthService,
    diagnostics,
  });
  return handlers;
}

const expectedSession = { userId: "user-1", generation: "generation-1" };

describe("Cloud IPC structured error transport", () => {
  it.each([
    ["/projects/project-1/repository-context", true],
    ["/projects/project-1/initialization/abandon", false],
    ["/projects/project-1/workbench", false],
    ["/content/project-1/write", false],
  ])("applies a deadline only to the read-only context query: %s", async (path, bounded) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const requestSessionApi = vi.fn().mockResolvedValue({});
    try {
      const handlers = register({ requestSessionApi });
      await handlers.get("cloud:session-api-request")(null, {
        expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path, method: "POST",
      });
      expect(requestSessionApi).toHaveBeenCalledTimes(1);
      expect(Boolean(requestSessionApi.mock.calls[0][2].signal)).toBe(bounded);
      if (bounded) expect(timeout).toHaveBeenCalledWith(15_000);
      else expect(timeout).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });
  it("bounds the authenticated run SSE subscription without exposing credentials", async () => {
    const requestSessionApi = vi.fn().mockResolvedValue([]);
    const handlers = register({ requestSessionApi });
    const path = "/agents/runs/11111111-1111-4111-8111-111111111111/events?after=8";
    const result = await handlers.get("cloud:session-api-request")(null, {
      expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path,
    });
    expect(result).toMatchObject({ ok: true, data: [] });
    expect(requestSessionApi.mock.calls[0][2]).toMatchObject({ method: "GET", responseType: "agent-events" });
    expect(requestSessionApi.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
    expect(requestSessionApi.mock.calls[0][3]).toEqual(expectedSession);
  });
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

  it("carries the server's retry decision and request id to the Renderer", async () => {
    const error = Object.assign(new Error("Request failed (503)"), {
      status: 503, code: "workbench_connection_timeout", retryable: true, requestId: "req-1",
    });
    const handlers = register({ requestSessionApi: vi.fn().mockRejectedValue(error) });
    const result = await handlers.get("cloud:session-api-request")(null, {
      expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path: "/projects/p/workbench?wait_seconds=20",
    });
    expect(result.error).toEqual({
      message: "Request failed (503)", status: 503, code: "workbench_connection_timeout", retryable: true, requestId: "req-1",
    });
  });
});

describe("Cloud Computer opening diagnostics", () => {
  it.each([
    ["GET", "/projects/p/workbench", "status"],
    ["GET", "/projects/p/workbench?wait_seconds=20", "status"],
    ["POST", "/projects/p/workbench", "open"],
    ["GET", "/projects/p/workbench/files?generation=g&path=", "files"],
    ["POST", "/projects/p/workbench/files?generation=g&path=a", null],
    ["PUT", "/projects/p/workbench/file?generation=g&path=a", null],
    ["POST", "/projects/p/workbench/sync", null],
    ["POST", "/projects/p/repository-context", null],
  ])("%s %s is the %s stage of opening", (method, path, stage) => {
    expect(cloudOpeningStage(method, path)).toBe(stage);
  });

  it("writes one local line per failed opening request, naming no project or path", async () => {
    const warn = vi.fn();
    const error = Object.assign(new Error("Request failed (503): private detail"), {
      status: 503, code: "workbench_connection_unavailable", retryable: true, requestId: "req-9",
    });
    const handlers = register({ requestSessionApi: vi.fn().mockRejectedValue(error) }, { warn });
    await handlers.get("cloud:session-api-request")(null, {
      expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path: "/projects/secret-project/workbench", method: "POST",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [label, fields] = warn.mock.calls[0];
    expect(label).toBe("[cloud-opening] request failed");
    expect(fields).toMatchObject({
      stage: "open", method: "POST", status: 503, code: "workbench_connection_unavailable",
      retryable: true, request_id: "req-9",
    });
    expect(fields.duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(fields)).not.toMatch(/secret-project|private detail|workbench\//);
  });

  it("stays quiet for other requests, successes and cancellations", async () => {
    const warn = vi.fn();
    const cancelled = Object.assign(new Error("cancelled"), { code: "CLOUD_REQUEST_CANCELLED" });
    const requestSessionApi = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("no"), { status: 500 }))
      .mockResolvedValueOnce({ workspace: null })
      .mockRejectedValueOnce(cancelled);
    const handlers = register({ requestSessionApi }, { warn });
    const send = (path) => handlers.get("cloud:session-api-request")(null, {
      expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path,
    });
    await send("/projects/p/repository-context");
    await send("/projects/p/workbench");
    await send("/projects/p/workbench");
    expect(warn).not.toHaveBeenCalled();
  });

  it("never lets a failing log change the request's outcome", async () => {
    const error = Object.assign(new Error("Request failed (409)"), { status: 409, code: "workbench_not_running" });
    const handlers = register({ requestSessionApi: vi.fn().mockRejectedValue(error) },
      { warn: () => { throw new Error("disk full"); } });
    const result = await handlers.get("cloud:session-api-request")(null, {
      expectedSession, apiBaseUrl: "https://api.puppyone.ai/api/v1", path: "/projects/p/workbench",
    });
    expect(result).toMatchObject({ ok: false, error: { status: 409, code: "workbench_not_running" } });
  });
});
