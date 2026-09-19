import { describe, expect, it, vi } from "vitest";
import { createLocalAgentInstallationService } from "../../../../electron/main/local-agent-installation/installation-service.mjs";
import { defaultLocalAgentInstallationRegistry } from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../../../src/features/desktop-terminal/model/terminalLaunchers.ts";
import { assertLocalAgentInstallationSnapshot } from "../../../../shared/local-agent-installation/schema.mjs";

describe("Local Agent installation service", () => {
  it("publishes fast results before slow siblings and replays them to late observers without rescanning", async () => {
    const gates = new Map(defaultLocalAgentInstallationRegistry.map(({ id }) => [id, deferred()]));
    const resolver = vi.fn(definition => gates.get(definition.id).promise);
    const service = createLocalAgentInstallationService({
      createResolutionContext: async () => ({}), resolveInstallation: resolver,
    });
    const progress = vi.fn();
    const finished = vi.fn();
    const first = service.discover({ onProgress: progress });
    void first.then(finished);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(8));
    gates.get("hermes").resolve({ status: "found", candidate: { source: "fixture" } });
    await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    expect(progress.mock.calls[0][0]).toMatchObject({ availableAgentIds: ["hermes"], completedAgentCount: 1, totalAgentCount: 8 });
    const late = vi.fn();
    expect(service.discover({ onProgress: late })).toBe(first);
    expect(late).toHaveBeenCalledWith(progress.mock.calls[0][0]);
    expect(resolver).toHaveBeenCalledTimes(8);
    // A dead renderer must not break the shared scan or progress replay.
    expect(() => service.discover({ onProgress: () => { throw new Error("closed"); } })).not.toThrow();
    for (const [id, gate] of gates) if (id !== "hermes") gate.resolve({ status: "not-found" });
    await first;
    expect(late).toHaveBeenCalledTimes(8);
    expect(finished).toHaveBeenCalledOnce();
  });

  it("does not publish late progress after disposal", async () => {
    const gate = deferred();
    const progress = vi.fn();
    const publishSnapshot = vi.fn();
    const service = createLocalAgentInstallationService({
      createResolutionContext: () => gate.promise, publishSnapshot,
      resolveInstallation: async () => ({ status: "not-found" }),
    });
    const scan = service.discover({ onProgress: progress });
    service.dispose();
    gate.resolve({});
    await scan;
    expect(progress).not.toHaveBeenCalled();
    expect(publishSnapshot).not.toHaveBeenCalled();
  });
  it("keeps the application registry aligned with launcher products", () => {
    expect(defaultLocalAgentInstallationRegistry.map(({ id }) => id)).toEqual([
      "codex",
      "claude",
      "cursor",
      "opencode",
      "pi",
      "workbuddy-china",
      "workbuddy-international",
      "hermes",
    ]);
    expect(DESKTOP_TERMINAL_LAUNCHERS.filter(({ id }) => id !== "shell").every(({ id }) => (
      defaultLocalAgentInstallationRegistry.some((definition) => definition.id === id)
    ))).toBe(true);
  });

  it("returns path-free, per-product outcomes in stable registry order", async () => {
    const resolveInstallation = vi.fn(async (definition) => {
      if (definition.id === "claude") throw new Error("filesystem unavailable");
      if (definition.id === "codex") {
        return { status: "found", candidate: { executablePath: "/private/tools/codex", source: "path-installation" } };
      }
      return { status: "not-found", reasonCode: "not-found" };
    });
    const service = createLocalAgentInstallationService({
      createResolutionContext: async () => Object.freeze({}),
      resolveInstallation,
    });

    const result = await service.discover();
    expect(result.availableAgentIds).toEqual(["codex"]);
    expect(result.results.find(({ agentId }) => agentId === "claude")).toMatchObject({
      status: "failed",
      reasonCode: "resolver-error",
    });
    expect(JSON.stringify(result)).not.toContain("/private/tools");
    await service.discover();
    expect(resolveInstallation).toHaveBeenCalledTimes(8);
  });

  it("owns retained evidence across failures and removes it only after definitive absence", async () => {
    let status = "found";
    const service = createLocalAgentInstallationService({ createResolutionContext: async () => ({}),
      resolveInstallation: async ({ id }) => ({ status: id === "codex" ? status : "not-found" }) });
    expect(await service.discover()).toMatchObject({ availableAgentIds: ["codex"], retainedAgentIds: [] });
    status = "failed";
    for (let index = 0; index < 2; index++) {
      const failed = await service.discover({ refresh: true });
      expect(failed).toMatchObject({ availableAgentIds: [], retainedAgentIds: ["codex"] });
      expect(failed.results[0].status).toBe("failed");
      expect(await service.discover()).toMatchObject({ retainedAgentIds: ["codex"], source: "memory-cache" });
      expect(Object.isFrozen(failed.retainedAgentIds)).toBe(true);
      expect(() => assertLocalAgentInstallationSnapshot({ ...failed, retainedAgentIds: ["claude"] })).toThrow();
      expect(() => assertLocalAgentInstallationSnapshot({ ...failed, retainedAgentIds: ["codex", "codex"] })).toThrow();
    }
    status = "not-found";
    expect(await service.discover({ refresh: true })).toMatchObject({ availableAgentIds: [], retainedAgentIds: [] });
    status = "failed";
    expect(await service.discover({ refresh: true })).toMatchObject({ availableAgentIds: [], retainedAgentIds: [] });
    service.dispose();
  });

  it("reuses the application-session snapshot regardless of age and only scans on explicit refresh", async () => {
    let now = 1_000;
    const resolveInstallation = vi.fn(async () => ({ status: "not-found", reasonCode: "not-found" }));
    const service = createLocalAgentInstallationService({
      now: () => now,
      createResolutionContext: async () => Object.freeze({}),
      resolveInstallation,
    });

    expect((await service.discover()).source).toBe("scan");
    expect(resolveInstallation).toHaveBeenCalledTimes(8);
    now += 86_400_000;
    expect((await service.discover()).source).toBe("memory-cache");
    expect(resolveInstallation).toHaveBeenCalledTimes(8);
    expect((await service.discover({ refresh: true })).source).toBe("scan");
    expect(resolveInstallation).toHaveBeenCalledTimes(16);
    service.dispose();
    const nextLaunch = createLocalAgentInstallationService({ createResolutionContext: async () => ({}), resolveInstallation });
    expect((await nextLaunch.discover()).source).toBe("scan");
    expect(resolveInstallation).toHaveBeenCalledTimes(24);
    nextLaunch.dispose();
  });

  it("ordinary reads during an explicit refresh return the previous snapshot without waiting", async () => {
    const gate = deferred();
    const createResolutionContext = vi.fn().mockResolvedValueOnce({}).mockReturnValueOnce(gate.promise);
    const service = createLocalAgentInstallationService({ createResolutionContext,
      resolveInstallation: async () => ({ status: "found", candidate: { source: "fixture" } }) });
    const initial = await service.discover();
    const pending = service.discover({ refresh: true });
    expect(await service.discover()).toMatchObject({ source: "memory-cache", generation: initial.generation });
    gate.resolve({}); await pending;
    expect(service.getDiagnostics().scanCount).toBe(2);
    service.dispose();
  });

  it("queues one guaranteed follow-up scan when refresh is clicked during an active scan", async () => {
    const firstScanGate = deferred();
    let contextCount = 0;
    const createResolutionContext = vi.fn(async () => {
      contextCount += 1;
      if (contextCount === 1) await firstScanGate.promise;
      return Object.freeze({ scan: contextCount });
    });
    const resolveInstallation = vi.fn(async (definition, context) => (
      definition.id === "claude" || (context.scan === 2 && definition.id === "codex")
        ? { status: "found", candidate: { source: "path-installation" } }
        : { status: "not-found", reasonCode: "not-found" }
    ));
    const service = createLocalAgentInstallationService({ createResolutionContext, resolveInstallation });

    const initial = service.discover();
    await vi.waitFor(() => expect(createResolutionContext).toHaveBeenCalledOnce());
    const refreshed = service.discover({ refresh: true });
    const coalescedRefresh = service.discover({ refresh: true });
    expect(coalescedRefresh).toBe(refreshed);
    expect(createResolutionContext).toHaveBeenCalledOnce();
    firstScanGate.resolve();

    await expect(initial).resolves.toMatchObject({ availableAgentIds: ["claude"], generation: 1 });
    await expect(refreshed).resolves.toMatchObject({ availableAgentIds: ["codex", "claude"], generation: 2 });
    await expect(coalescedRefresh).resolves.toMatchObject({ availableAgentIds: ["codex", "claude"], generation: 2 });
    expect(createResolutionContext).toHaveBeenCalledTimes(2);
    expect(service.getDiagnostics().queuedRefreshCount).toBe(1);
  });

  it("shares one search context, publishes incremental outcomes, and broadcasts final scans", async () => {
    const context = Object.freeze({ executableSearch: Object.freeze({ directories: [] }) });
    const createResolutionContext = vi.fn(async () => context);
    const progress = vi.fn();
    const publishSnapshot = vi.fn();
    const service = createLocalAgentInstallationService({
      createResolutionContext,
      publishSnapshot,
      resolveInstallation: vi.fn(async (definition, receivedContext) => {
        expect(receivedContext).toBe(context);
        return definition.id === "opencode"
          ? { status: "found", candidate: { executablePath: "/secret/opencode", source: "product-fallback" } }
          : { status: "not-found", reasonCode: "not-found" };
      }),
    });

    await service.discover({ onProgress: progress });
    expect(createResolutionContext).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledTimes(8);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      availableAgentIds: ["opencode"],
      completedAgentCount: 8,
      totalAgentCount: 8,
    }));
    expect(JSON.stringify(progress.mock.calls)).not.toContain("/secret/");
    expect(publishSnapshot).toHaveBeenCalledOnce();
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
