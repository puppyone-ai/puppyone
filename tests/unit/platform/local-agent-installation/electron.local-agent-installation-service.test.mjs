import { describe, expect, it, vi } from "vitest";
import { createLocalAgentInstallationService } from "../../../../electron/main/local-agent-installation/installation-service.mjs";
import { defaultLocalAgentInstallationRegistry } from "../../../../electron/main/local-agent-installation/installation-registry.mjs";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../../../src/features/desktop-terminal/model/terminalLaunchers.ts";

describe("Local Agent installation service", () => {
  it("keeps the application registry aligned with launcher products", () => {
    expect(defaultLocalAgentInstallationRegistry.map(({ id }) => id)).toEqual([
      "codex",
      "claude",
      "cursor",
      "opencode",
      "pi",
      "hermes",
    ]);
    expect(DESKTOP_TERMINAL_LAUNCHERS.filter(({ id }) => id !== "shell").map(({ id }) => id))
      .toEqual(defaultLocalAgentInstallationRegistry.map(({ id }) => id));
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
    expect(resolveInstallation).toHaveBeenCalledTimes(12);
  });

  it("uses the short cache only for ordinary reads and always scans on explicit refresh", async () => {
    let now = 1_000;
    const resolveInstallation = vi.fn(async () => ({ status: "not-found", reasonCode: "not-found" }));
    const service = createLocalAgentInstallationService({
      now: () => now,
      createResolutionContext: async () => Object.freeze({}),
      resolveInstallation,
    });

    expect((await service.discover()).source).toBe("scan");
    expect(resolveInstallation).toHaveBeenCalledTimes(6);
    now += 1_000;
    expect((await service.discover()).source).toBe("memory-cache");
    expect(resolveInstallation).toHaveBeenCalledTimes(6);
    expect((await service.discover({ refresh: true })).source).toBe("scan");
    expect(resolveInstallation).toHaveBeenCalledTimes(12);
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
    expect(progress).toHaveBeenCalledTimes(6);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      availableAgentIds: ["opencode"],
      completedAgentCount: 6,
      totalAgentCount: 6,
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
