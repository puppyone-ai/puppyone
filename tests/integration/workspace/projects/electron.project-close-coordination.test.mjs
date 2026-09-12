import { describe, expect, it, vi } from "vitest";
import { createProjectSessionHost } from "../../../../electron/main/bootstrap/create-project-session-host.mjs";
import { createApplicationCloseCoordinator } from "../../../../electron/main/workspace/project-sessions/application-close-coordinator.mjs";
import { createWindowWorkspaceOperationQueue } from "../../../../electron/main/workspace/project-sessions/window-workspace-operation-queue.mjs";
import { WindowWorkspaceState } from "../../../../electron/main/window-workspace-state.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const folder = (id) => ({ path: `/projects/${id}`, workspace: { id, path: `/projects/${id}` } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("project close composition", () => {
  it("closes every resource port for only the selected project, retaining failed cleanup", async () => {
    const agentService = { closeSessionsForWorkspaceRoot: vi.fn() };
    const terminalService = { closeSessionsForWorkspaceRoot: vi.fn().mockRejectedValue(new Error("PTY alive")) };
    const closeProjectServices = vi.fn();
    const host = createProjectSessionHost({ agentService, terminalService, closeProjectServices });
    const a = host.open(42, folder("a"));
    const b = host.open(42, folder("b"));
    await expect(host.close(42, a)).resolves.toEqual({ closed: false, failures: ["terminal"] });
    expect(host.require(42, b)).toBe(b);
    expect(agentService.closeSessionsForWorkspaceRoot).toHaveBeenCalledWith(42, "/projects/a");
    expect(closeProjectServices.mock.calls.every(([owner, root]) => owner === 42 && root === "/projects/a")).toBe(true);
    terminalService.closeSessionsForWorkspaceRoot.mockResolvedValue(undefined);
    await expect(host.close(42, a)).resolves.toEqual({ closed: true });
  });

  it("restores each composition identity and forgets explicitly closed roots", () => {
    const state = new WindowWorkspaceState();
    const a = [folder("a"), folder("b")];
    state.activateFolders(a); state.replaceFolders(a);
    const aId = state.workspaceId;
    const c = [folder("c")];
    state.activateFolders(c); state.replaceFolders(c);
    expect(state.workspaceId).not.toBe(aId);
    state.releaseFolders();
    const restored = state.compositionForPath("/projects/b");
    expect(restored).toEqual(a);
    state.activateFolders(restored); state.replaceFolders(restored);
    expect(state.workspaceId).toBe(aId);
    state.forgetFolder("/projects/b");
    expect(state.compositionForPath("/projects/b")).toBeNull();
  });

  it("serializes navigation and fences queued work after window close", async () => {
    const pending = deferred();
    let closing = false;
    const queue = createWindowWorkspaceOperationQueue({ assertOpen: () => { if (closing) throw new Error("closing"); } });
    const first = queue.run(1, async (assertOpen) => { await pending.promise; assertOpen(); });
    const second = queue.run(1, vi.fn());
    const results = Promise.allSettled([first, second]);
    await tick();
    closing = true; pending.resolve();
    expect((await results).map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
  });
});

describe("application shutdown after document/window gates", () => {
  it("lets windows flush first and awaits the final resource drain only once", async () => {
    const pending = deferred();
    let windows = [{}];
    const app = { quit: vi.fn() };
    const closeResources = vi.fn(() => pending.promise);
    const close = createApplicationCloseCoordinator({ app, getWindows: () => windows, closeResources });
    const event = { preventDefault: vi.fn() };
    close(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    windows = []; close(event); close(event);
    await tick();
    expect(closeResources).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
    pending.resolve(); await tick();
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it("keeps failed shutdown retryable without an automatic quit loop", async () => {
    const app = { quit: vi.fn() };
    const closeResources = vi.fn().mockRejectedValueOnce(new Error("still alive")).mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const close = createApplicationCloseCoordinator({ app, getWindows: () => [], closeResources, onFailure, logger: { error: vi.fn() } });
    close({ preventDefault() {} }); await tick();
    expect(app.quit).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    close({ preventDefault() {} }); await tick();
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});
