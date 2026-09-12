import { describe, expect, it, vi } from "vitest";
import { createCachedRuntimeDiscovery } from "../../../../../electron/main/agent/connections/runtime-discovery-cache.mjs";

describe("Runtime discovery cache", () => {
  it("deduplicates concurrent discovery and keeps successful evidence for the positive TTL", async () => {
    let now = 0;
    const load = vi.fn(async () => readiness("READY", "ready"));
    const discovery = createCachedRuntimeDiscovery(load, {
      now: () => now,
      positiveTtlMs: 100,
      transientTtlMs: 10,
    });

    const [first, second] = await Promise.all([discovery.discover(), discovery.discover()]);
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);

    now = 99;
    await discovery.discover();
    expect(load).toHaveBeenCalledTimes(1);
    now = 100;
    await discovery.discover();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("expires transient negative evidence sooner than successful inventory", async () => {
    let now = 0;
    const load = vi.fn(async () => readiness("AUTHENTICATION_PROBE_TIMED_OUT", "error"));
    const discovery = createCachedRuntimeDiscovery(load, {
      now: () => now,
      positiveTtlMs: 100,
      transientTtlMs: 10,
    });

    await discovery.discover();
    now = 9;
    await discovery.discover();
    expect(load).toHaveBeenCalledTimes(1);
    now = 10;
    await discovery.discover();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("starts a new generation on Refresh and never lets the older flight overwrite it", async () => {
    const deferred = promiseWithResolvers();
    const load = vi.fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce(readiness("READY", "ready", "new"));
    const discovery = createCachedRuntimeDiscovery(load);

    const oldFlight = discovery.discover();
    const refreshed = await discovery.discover({ refresh: true });
    deferred.resolve(readiness("RUNTIME_DISCOVERY_FAILED", "error", "old"));
    await oldFlight;

    expect(refreshed.message).toBe("new");
    expect((await discovery.discover()).message).toBe("new");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

function readiness(code, status, message = code) {
  return { code, status, message };
}

function promiseWithResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
