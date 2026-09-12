import { describe, expect, it, vi } from "vitest";
import { createAgentQuitCoordinator } from "../../../../electron/main/agent/agent-shutdown.mjs";

describe("Desktop Agent app-quit coordination", () => {
  it("prevents quit until active Agent sessions and persistence are drained", async () => {
    let resolveDrain;
    let sessionCount = 1;
    const closeAll = vi.fn(() => new Promise((resolve) => {
      resolveDrain = () => {
        sessionCount = 0;
        resolve();
      };
    }));
    const app = { quit: vi.fn() };
    const disposeApplicationServices = vi.fn();
    const handler = createAgentQuitCoordinator({
      app,
      agentService: { getSessionCount: () => sessionCount, closeAll },
      disposeApplicationServices,
      logger: { error: vi.fn() },
    });
    const firstEvent = { preventDefault: vi.fn() };
    const duplicateEvent = { preventDefault: vi.fn() };

    handler(firstEvent);
    handler(duplicateEvent);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce();
    expect(closeAll).toHaveBeenCalledOnce();
    expect(disposeApplicationServices).toHaveBeenCalledOnce();

    resolveDrain();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.quit).toHaveBeenCalledOnce();

    const finalEvent = { preventDefault: vi.fn() };
    handler(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
    expect(disposeApplicationServices).toHaveBeenCalledOnce();
  });

  it("does not intercept updater-driven quit when no Agent session is active", () => {
    const event = { preventDefault: vi.fn() };
    const closeAll = vi.fn(async () => {});
    const handler = createAgentQuitCoordinator({
      app: { quit: vi.fn() },
      agentService: { getSessionCount: () => 0, hasRuntimeResources: () => false, closeAll },
      disposeApplicationServices: vi.fn(),
    });

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it("waits for an inspected sidecar even when no Agent session was created", async () => {
    let resolveDrain;
    const closeAll = vi.fn(() => new Promise((resolve) => { resolveDrain = resolve; }));
    const app = { quit: vi.fn() };
    const handler = createAgentQuitCoordinator({
      app,
      agentService: {
        getSessionCount: () => 0,
        hasRuntimeResources: () => true,
        closeAll,
      },
      disposeApplicationServices: vi.fn(),
    });
    const event = { preventDefault: vi.fn() };

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    resolveDrain();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
