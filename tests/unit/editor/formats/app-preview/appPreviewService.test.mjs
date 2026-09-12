import { describe, expect, it, vi } from "vitest";
import { createAppPreviewService } from "../../../../../electron/main/app-preview-service.mjs";

describe("App Preview runtime coordinator", () => {
  it("serializes Stop behind an in-flight Start for the same App", async () => {
    let releaseStart;
    const runtime = createRuntime({
      start: vi.fn(() => new Promise((resolve) => { releaseStart = resolve; })),
    });
    const service = createAppPreviewService({ runtime });
    const sender = { id: 42 };
    const request = { rootPath: "/workspace", path: "demo.puppyoneapp" };

    const starting = service.start(sender, request);
    const stopping = service.stop(sender, request);
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf("function"));
    expect(runtime.stop).not.toHaveBeenCalled();

    releaseStart(runningResult());
    await starting;
    await stopping;
    expect(runtime.stop).toHaveBeenCalledWith(sender, request);
  });

  it("waits for pending owner mutations before closing the window runtime", async () => {
    let releaseStart;
    const runtime = createRuntime({
      start: vi.fn(() => new Promise((resolve) => { releaseStart = resolve; })),
    });
    const service = createAppPreviewService({ runtime });
    const request = { rootPath: "/workspace", path: "demo.puppyoneapp" };

    const starting = service.start({ id: 42 }, request);
    const closing = service.closeSessionsForWindow(42);
    await vi.waitFor(() => expect(releaseStart).toBeTypeOf("function"));
    expect(runtime.closeSessionsForWindow).not.toHaveBeenCalled();

    releaseStart(runningResult());
    await starting;
    await closing;
    expect(runtime.closeSessionsForWindow).toHaveBeenCalledWith(42);
  });

  it("keeps different Apps independent", async () => {
    const runtime = createRuntime();
    const service = createAppPreviewService({ runtime });
    await Promise.all([
      service.start({ id: 42 }, { rootPath: "/workspace", path: "one.puppyoneapp" }),
      service.start({ id: 42 }, { rootPath: "/workspace", path: "two.puppyoneapp" }),
    ]);
    expect(runtime.start).toHaveBeenCalledTimes(2);
  });

  it("waits only for the removed root before closing its Preview sessions", async () => {
    let releaseStart;
    const runtime = createRuntime({
      start: vi.fn((_, request) => request.rootPath === "/workspace-b"
        ? new Promise((resolve) => { releaseStart = resolve; })
        : Promise.resolve(runningResult())),
    });
    const service = createAppPreviewService({ runtime });
    const sender = { id: 42 };
    await service.start(sender, { rootPath: "/workspace-a", path: "one.puppyoneapp" });
    const starting = service.start(sender, { rootPath: "/workspace-b", path: "two.puppyoneapp" });
    const closing = service.closeSessionsForWorkspaceRoot(42, "/workspace-b");

    await vi.waitFor(() => expect(releaseStart).toBeTypeOf("function"));
    expect(runtime.closeSessionsForWorkspaceRoot).not.toHaveBeenCalled();
    releaseStart(runningResult());
    await starting;
    await closing;
    expect(runtime.closeSessionsForWorkspaceRoot).toHaveBeenCalledWith(42, "/workspace-b");
  });
});

function createRuntime(overrides = {}) {
  return {
    start: vi.fn(async () => runningResult()),
    restart: vi.fn(async () => runningResult()),
    stop: vi.fn(async () => ({ ...runningResult(), status: "stopped" })),
    getLogs: vi.fn(async () => ""),
    openExternal: vi.fn(async () => undefined),
    closeSessionsForWindow: vi.fn(async () => undefined),
    closeSessionsForWorkspaceRoot: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    ...overrides,
  };
}

function runningResult() {
  return {
    runtimeId: "runtime-1",
    appId: "app-1",
    name: "Demo",
    status: "running",
    path: "demo.puppyoneapp",
    url: "http://127.0.0.1:4173/",
  };
}
