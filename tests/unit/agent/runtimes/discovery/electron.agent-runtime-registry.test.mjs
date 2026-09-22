import { describe, expect, it, vi } from "vitest";
import { AgentRuntimeRegistry } from "../../../../../electron/main/agent/runtime/agent-runtime-registry.mjs";
import { defineAgentRuntimeManifest } from "../../../../../electron/main/agent/runtime/agent-runtime-manifest.mjs";
import { createRuntimeResolutionCoordinator } from "../../../../../electron/main/agent/application/runtime-resolution/runtime-resolution-coordinator.mjs";
import { createCachedRuntimeDiscovery } from "../../../../../electron/main/agent/connections/runtime-discovery-cache.mjs";

describe("Agent runtime registry", () => {
  it.each([false, true])("inspects only the selected runtime even when another probe is stuck (refresh=%s)", async (refresh) => {
    const adapter = {
      inspect: vi.fn(async () => ({ account: { account: null, requiresOpenaiAuth: false },
        providers: [], models: [], modes: [], commands: [], capabilities: {}, warnings: [] })),
      createSession: vi.fn(), resumeSession: vi.fn(), readHistory: vi.fn(),
      startTurn: vi.fn(), interruptTurn: vi.fn(), dispose: vi.fn(),
    };
    const healthy = definition("healthy", 2, "ready", adapter);
    const stuck = definition("stuck", 1, "ready", {});
    stuck.discovery.discover.mockImplementation(() => new Promise(() => {}));
    const registry = new AgentRuntimeRegistry([healthy, stuck]);
    const resolver = createRuntimeResolutionCoordinator({ runtimeRegistry: registry });
    try {
      const catalog = await resolver.queryCatalog({ runtimeId: "healthy", refresh }, "/workspace");
      expect(catalog).toMatchObject({ selectedRuntimeId: "healthy", readiness: { status: "ready" } });
      expect(catalog.runtimes.map((entry) => entry.descriptor.id)).toEqual(["healthy"]);
      expect(adapter.inspect).toHaveBeenCalledOnce();
      expect(stuck.discovery.discover).not.toHaveBeenCalled();
    } finally { await registry.dispose(); }
  });

  it("still discovers all runtimes for the unbound launcher without inspecting one", async () => {
    const first = definition("first", 2, "ready", {});
    const second = definition("second", 1, "not-installed", {});
    const registry = new AgentRuntimeRegistry([first, second]);
    const resolver = createRuntimeResolutionCoordinator({ runtimeRegistry: registry });
    try {
      const catalog = await resolver.queryCatalog();
      expect(catalog.runtimes.map((entry) => entry.descriptor.id)).toEqual(["first", "second"]);
      expect(first.discovery.discover).toHaveBeenCalledOnce();
      expect(second.discovery.discover).toHaveBeenCalledOnce();
      expect(first.createAdapter).not.toHaveBeenCalled();
      expect(second.createAdapter).not.toHaveBeenCalled();
    } finally { await registry.dispose(); }
  });

  it("rechecks invalidated model inspection while reusing cached executable discovery", async () => {
    const adapter = {
      inspect: vi.fn(async () => ({ account: { account: null, requiresOpenaiAuth: false },
        providers: [], models: [], modes: [], commands: [], capabilities: {}, warnings: [] })),
      createSession: vi.fn(), resumeSession: vi.fn(), readHistory: vi.fn(),
      startTurn: vi.fn(), interruptTurn: vi.fn(), dispose: vi.fn(),
    };
    const runtime = definition("healthy", 1, "ready", adapter);
    const probe = runtime.discovery.discover;
    runtime.discovery = createCachedRuntimeDiscovery(probe);
    const registry = new AgentRuntimeRegistry([runtime]);
    const resolver = createRuntimeResolutionCoordinator({ runtimeRegistry: registry });
    try {
      await resolver.queryCatalog({ runtimeId: "healthy" }, "/workspace");
      await resolver.queryCatalog({ runtimeId: "healthy" }, "/workspace");
      expect(adapter.inspect).toHaveBeenCalledOnce();
      resolver.clear();
      await resolver.queryCatalog({ runtimeId: "healthy" }, "/workspace");
      expect(adapter.inspect).toHaveBeenCalledTimes(2);
      expect(probe).toHaveBeenCalledOnce();
    } finally { await registry.dispose(); }
  });

  it("resolves a selected healthy runtime without probing a stuck unrelated runtime", async () => {
    const healthy = definition("healthy", 2, "ready", {});
    const stuck = definition("stuck", 1, "ready", {});
    stuck.discovery.discover.mockImplementation(() => new Promise(() => {}));
    const registry = new AgentRuntimeRegistry([healthy, stuck]);
    const resolver = createRuntimeResolutionCoordinator({ runtimeRegistry: registry });
    await expect(resolver.resolveForOperation({ runtimeId: "healthy", workspaceRoot: "/workspace", operation: "create" }))
      .resolves.toMatchObject({ descriptor: { id: "healthy" } });
    expect(healthy.discovery.discover).toHaveBeenCalledOnce();
    expect(stuck.discovery.discover).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("bounds catalog latency and quarantines a noncooperative probe across refresh storms", async () => {
    vi.useFakeTimers();
    const stuck = definition("stuck", 1, "ready", {});
    const native = Promise.withResolvers();
    stuck.discovery.discover.mockReturnValueOnce(native.promise);
    const registry = new AgentRuntimeRegistry([definition("healthy", 2, "ready", {}), stuck], { discoveryTimeoutMs: 100 });
    try {
      const catalog = registry.discover();
      const concurrent = registry.discover({ refresh: true });
      await vi.advanceTimersByTimeAsync(100);
      const rows = await catalog;
      expect(rows[0].readiness.status).toBe("ready");
      expect(rows[1].readiness).toMatchObject({ status: "error", code: "RUNTIME_DISCOVERY_FAILED", message: expect.stringMatching(/timed out/) });
      expect(await concurrent).toEqual(rows);
      expect(stuck.discovery.discover.mock.calls[0][0].signal.aborted).toBe(true);
      const refreshed = await Promise.all(Array.from({ length: 20 }, () => registry.discover({ runtimeId: "stuck", refresh: true })));
      expect(refreshed.every(result => result[0].readiness.status === "error")).toBe(true);
      expect(stuck.discovery.discover).toHaveBeenCalledOnce();
      expect(registry.hasActiveResources()).toBe(true);
      native.resolve({ runtimeId: "stuck", status: "ready", code: "READY" });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows[1].readiness.status).toBe("error");
      expect(registry.hasActiveResources()).toBe(false);
      expect((await registry.discover({ runtimeId: "stuck", refresh: true }))[0].readiness.status).toBe("ready");
      expect(stuck.discovery.discover).toHaveBeenCalledTimes(2);
    } finally { await registry.dispose(); vi.useRealTimers(); }
  });

  it("aborts cooperative probes on deadline and permits a fresh attempt after settlement", async () => {
    vi.useFakeTimers();
    const backend = definition("backend", 1, "ready", {});
    backend.discovery.discover.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const registry = new AgentRuntimeRegistry([backend], { discoveryTimeoutMs: 100 });
    try {
      const attempt = registry.discover();
      await vi.advanceTimersByTimeAsync(100);
      expect((await attempt)[0].readiness.status).toBe("error");
      expect(registry.hasActiveResources()).toBe(false);
      expect((await registry.discover({ refresh: true }))[0].readiness.status).toBe("ready");
    } finally { await registry.dispose(); vi.useRealTimers(); }
  });

  it("does not let a late native result seed the discovery cache after its Host deadline", async () => {
    vi.useFakeTimers();
    const native = Promise.withResolvers();
    const backend = definition("backend", 1, "ready", {});
    const load = vi.fn().mockReturnValueOnce(native.promise)
      .mockResolvedValueOnce({ runtimeId: "backend", status: "ready", code: "READY", message: "fresh evidence" });
    backend.discovery = createCachedRuntimeDiscovery(load);
    const registry = new AgentRuntimeRegistry([backend], { discoveryTimeoutMs: 100 });
    try {
      const attempt = registry.discover();
      await vi.advanceTimersByTimeAsync(100);
      expect((await attempt)[0].readiness.status).toBe("error");
      native.resolve({ runtimeId: "backend", status: "ready", code: "READY", message: "expired evidence" });
      await vi.advanceTimersByTimeAsync(0);
      expect((await registry.discover())[0].readiness.message).toBe("fresh evidence");
      expect(load).toHaveBeenCalledTimes(2);
    } finally { await registry.dispose(); vi.useRealTimers(); }
  });

  it("settles discovery observers at Host shutdown and ignores late failures", async () => {
    const native = Promise.withResolvers();
    const backend = definition("backend", 1, "ready", {});
    backend.discovery.discover.mockReturnValue(native.promise);
    const registry = new AgentRuntimeRegistry([backend]);
    const attempt = registry.discover();
    await Promise.resolve();
    await registry.dispose();
    expect((await attempt)[0].readiness).toMatchObject({ status: "error", message: expect.stringMatching(/closed/) });
    expect(backend.discovery.discover.mock.calls[0][0].signal.aborted).toBe(true);
    native.reject(new Error("late native failure"));
    expect((await registry.discover())[0].readiness.status).toBe("error");
    expect(backend.discovery.discover).toHaveBeenCalledOnce();
  });

  it("rejects discovery evidence attributed to another runtime", async () => {
    const backend = definition("backend", 1, "ready", {});
    backend.discovery.discover.mockResolvedValue({ runtimeId: "other", status: "ready", code: "READY" });
    const registry = new AgentRuntimeRegistry([backend]);
    expect((await registry.discover())[0].readiness).toMatchObject({ status: "error", message: expect.stringMatching(/identity/) });
    await registry.dispose();
  });

  it("accepts the existing provider-only discovery identity", async () => {
    const backend = definition("backend", 1, "ready", {});
    backend.discovery.discover.mockResolvedValue({ provider: "backend", status: "ready", code: "READY" });
    const registry = new AgentRuntimeRegistry([backend]);
    expect((await registry.discover())[0].readiness.status).toBe("ready");
    await registry.dispose();
  });

  it("selects the configured default without readiness fallback and keeps lifecycle dispatch neutral", async () => {
    const adapter = {
      inspect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      readHistory: vi.fn(),
      startTurn: vi.fn(),
      interruptTurn: vi.fn(),
      dispose: vi.fn(),
    };
    const registry = new AgentRuntimeRegistry([
      definition("direct", 10, "ready", adapter),
      definition("harness", 100, "ready", adapter),
      definition("offline", 200, "not-installed", adapter),
    ], { defaultRuntimeId: "harness" });
    const catalog = await registry.discover();
    expect(registry.select(catalog).descriptor.id).toBe("harness");
    expect(registry.select(catalog, "offline")?.descriptor.id).toBe("offline");
    expect(registry.select(catalog, "missing")).toBeNull();
    expect(registry.createAdapter("direct", { workspaceRoot: "/workspace" })).toBe(adapter);
    expect(registry.descriptors().map((entry) => entry.id)).toEqual(["offline", "harness", "direct"]);
    expect(registry.manifests().map((entry) => entry.id)).toEqual(["offline", "harness", "direct"]);
    expect(registry.hasActiveResources()).toBe(true);
    await registry.dispose();
    expect(registry.hasActiveResources()).toBe(false);
  });

  it("requires one manifest source of truth instead of a separately maintained descriptor", () => {
    expect(() => new AgentRuntimeRegistry([{
      descriptor: { id: "legacy", displayName: "Legacy" },
      discovery: { discover: vi.fn() },
      createAdapter: vi.fn(),
    }])).toThrow(/requires a manifest/i);

    expect(() => new AgentRuntimeRegistry([{
      manifest: manifest("duplicate-source", 1),
      descriptor: { id: "duplicate-source", displayName: "Stale label" },
      discovery: { discover: vi.fn() },
      createAdapter: vi.fn(),
    }])).toThrow(/derived from manifests/i);
  });

  it("fails a malformed readiness code/status pair closed at the runtime boundary", async () => {
    const adapter = {
      inspect() {}, createSession() {}, resumeSession() {}, readHistory() {},
      startTurn() {}, interruptTurn() {}, dispose() {},
    };
    const malformed = {
      ...definition("malformed", 1, "ready", adapter),
      discovery: {
        discover: vi.fn(async () => ({
          runtimeId: "malformed",
          status: "installed-not-authenticated",
          code: "AUTHENTICATION_PROBE_FAILED",
        })),
      },
    };
    const registry = new AgentRuntimeRegistry([malformed]);

    await expect(registry.discover()).resolves.toEqual([
      expect.objectContaining({
        readiness: expect.objectContaining({
          status: "error",
          code: "RUNTIME_DISCOVERY_FAILED",
          message: expect.stringMatching(/incompatible with status/i),
        }),
      }),
    ]);
  });

  it("attempts cleanup for every backend even when one cleanup fails", async () => {
    const firstDispose = vi.fn(async () => { throw new Error("first failed"); });
    const secondDispose = vi.fn(async () => undefined);
    const adapter = {
      inspect() {}, createSession() {}, resumeSession() {}, readHistory() {},
      startTurn() {}, interruptTurn() {}, dispose() {},
    };
    const first = { ...definition("first", 2, "ready", adapter), dispose: firstDispose };
    const second = { ...definition("second", 1, "ready", adapter), dispose: secondDispose };
    const registry = new AgentRuntimeRegistry([first, second]);

    await expect(registry.dispose()).rejects.toThrow(/failed to dispose cleanly/i);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });
});

function definition(id, priority, status, adapter) {
  const code = status === "ready" ? "READY" : status === "not-installed" ? "RUNTIME_NOT_INSTALLED" : "RUNTIME_DISCOVERY_FAILED";
  return {
    manifest: manifest(id, priority),
    discovery: { discover: vi.fn(async () => ({ runtimeId: id, status, code, executablePath: status === "ready" ? `/${id}` : null })) },
    createAdapter: vi.fn(() => adapter),
  };
}

function manifest(id, priority) {
  return defineAgentRuntimeManifest({
    id,
    priority,
    displayName: id,
    execution: { kind: "local-process", distribution: "user-installed", controller: "bundled-adapter" },
    protocol: { kind: "rpc", transport: "stdio-json-rpc" },
    integration: { kind: "specialized-native", adapter: "specialized" },
    trust: { level: "first-party", publisher: "Fixture" },
    ownership: {
      harness: "runtime",
      credentials: ["runtime"],
      models: "runtime",
      billing: ["runtime"],
      session: "runtime",
    },
  });
}
