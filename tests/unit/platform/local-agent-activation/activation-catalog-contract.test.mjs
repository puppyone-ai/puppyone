import { describe, expect, it, vi } from "vitest";
import { defaultLocalAgentCatalog as catalog, createLocalAgentCatalog } from "../../../../electron/main/local-agent-catalog/catalog.mjs";
import { createActivationRegistry } from "../../../../electron/main/local-agent-activation/activation-registry.mjs";
import { createLocalAgentActivationService } from "../../../../electron/main/local-agent-activation/activation-service.mjs";

const registry = createActivationRegistry({ platform: "darwin", arch: "arm64" });
const deferred = () => Promise.withResolvers();
function harness(id, { installed = false, routes = registry } = {}) {
  let present = installed;
  const resolveInstallation = vi.fn(async () => present ? { file: "/fixture/agent" } : null);
  const run = vi.fn(async () => ({ code: 0, stdout: "fixture", stderr: "" }));
  const createContext = vi.fn(async () => ({ run }));
  const installer = { install: vi.fn(async (_recipe, { signal, verify, committed }) => {
    await verify("/fixture/agent", signal); signal.throwIfAborted(); present = true; committed();
  }) };
  const journal = { read: vi.fn(async () => []), write: vi.fn(async () => {}) };
  const openExternal = vi.fn(); const refreshInstallations = vi.fn();
  const service = createLocalAgentActivationService({ registry: routes, resolveInstallation, createContext, installer,
    journal, openExternal, refreshInstallations });
  const start = async (surface = "chat") => {
    const plan = await service.plan(1, { setupId: id, surface });
    await service.start(1, { planId: plan.planId });
    return (await service.read()).operations[0];
  };
  const operation = async () => (await service.read()).operations[0];
  return { service, start, operation, resolveInstallation, createContext, run, installer, journal, openExternal,
    refreshInstallations, setInstalled: () => { present = true; } };
}
const abortable = signal => new Promise((_resolve, reject) => {
  signal.throwIfAborted(); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

describe("every registered Agent obeys the same activation contract", () => {
  it.each([...registry.keys()])("%s: existing installation never installs, probes, or authenticates", async id => {
    const h = harness(id, { installed: true }); await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "ready", installed: true });
    expect(h.installer.install).not.toHaveBeenCalled(); expect(h.createContext).not.toHaveBeenCalled();
    expect(h.openExternal).not.toHaveBeenCalled(); expect(h.refreshInstallations).toHaveBeenCalledOnce();
  });
  it.each([...registry.keys()])("%s: missing installation follows only its declared capability", async id => {
    const h = harness(id); const entry = await h.start(); await h.service.settled();
    if (registry.get(id).recipe) {
      expect(await h.operation()).toMatchObject({ status: "ready", installed: true });
      expect(h.installer.install).toHaveBeenCalledOnce(); expect(h.run).toHaveBeenCalledExactlyOnceWith(["--version"]);
    } else {
      expect((await h.operation()).status).toBe("setup-required");
      expect(h.openExternal).not.toHaveBeenCalled();
      await h.service.act(1, { operationId: entry.operationId, action: "guide" });
      expect(h.openExternal).toHaveBeenCalledExactlyOnceWith(registry.get(id).guideUrl);
      h.setInstalled(); await h.service.act(1, { operationId: entry.operationId, action: "check" });
      await h.service.settled(); expect((await h.operation()).status).toBe("ready");
      expect(h.installer.install).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled();
    }
  });
  it.each([...registry.keys()])("%s: failed discovery does not authorize installation", async id => {
    const h = harness(id); h.resolveInstallation.mockRejectedValue({ code: "installation-check" });
    await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "failed", errorCode: "installation-check" });
    expect(h.installer.install).not.toHaveBeenCalled(); expect(h.openExternal).not.toHaveBeenCalled();
  });
  it.each([...registry.keys()])("%s: independent cancellation fences a late discovered entry", async id => {
    const h = harness(id); const gate = deferred(); h.resolveInstallation.mockReturnValueOnce(gate.promise);
    const entry = await h.start();
    await h.service.act(2, { operationId: entry.operationId, action: "cancel" });
    expect((await h.operation()).status).toBe("cancelling");
    gate.resolve({ file: "/fixture/agent" }); await h.service.settled();
    expect((await h.operation()).status).toBe("cancelled"); expect(h.installer.install).not.toHaveBeenCalled();
  });
  it.each(["codex", "cursor"].flatMap(id => ["install", "verify"].map(phase => ({ id, phase }))))("$id: cancels $phase with the shared engine", async ({ id, phase }) => {
    const h = harness(id); const entered = deferred();
    if (phase === "install") h.installer.install.mockImplementation(async (_recipe, { signal }) => {
      entered.resolve(); await abortable(signal);
    });
    else h.resolveInstallation.mockResolvedValueOnce(null).mockImplementation(async (_id, signal) => {
      entered.resolve(); return abortable(signal);
    });
    const entry = await h.start(); await entered.promise;
    await h.service.act(2, { operationId: entry.operationId, action: "cancel" }); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "cancelled", installed: phase === "verify" });
  });
  it("uses a new declared recipe without adding a brand branch to the activation engine", async () => {
    const agent = catalog.find(value => value.installation.id === "claude");
    const sample = registry.get("codex").recipe;
    const custom = createLocalAgentCatalog([{ ...agent, provision: { kind: "managed-artifact",
      recipeFor: () => ({ ...sample, setupId: "claude" }) } }]);
    const h = harness("claude", { routes: createActivationRegistry({ platform: "darwin", arch: "arm64", catalog: custom }) });
    await h.start(); await h.service.settled(); expect((await h.operation()).status).toBe("ready");
    expect(h.installer.install.mock.calls[0][0].setupId).toBe("claude");
  });
  it("enforces surface capability for both terminal-only and chat-only definitions", async () => {
    const custom = createLocalAgentCatalog([{ ...catalog[0], runtimeId: null }]);
    const h = harness("codex", { installed: true, routes: createActivationRegistry({ platform: "darwin", arch: "arm64", catalog: custom }) });
    await expect(h.start("chat")).rejects.toThrow("unsupported");
    await h.start("terminal"); await h.service.settled(); expect((await h.operation()).status).toBe("ready");
    await expect(harness("workbuddy-china").start("terminal")).rejects.toThrow("unsupported");
  });
  it("a rejected initial journal write cannot overwrite an acknowledged cancellation", async () => {
    const h = harness("cursor"); const gate = deferred(); const entered = deferred();
    h.journal.write.mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const starting = h.start(); await entered.promise;
    const entry = await h.operation(); await h.service.act(2, { operationId: entry.operationId, action: "cancel" });
    gate.reject(new Error("disk failure")); await starting;
    expect((await h.operation()).status).toBe("cancelled"); expect(h.installer.install).not.toHaveBeenCalled();
  });
  it("a synchronously failing refresh cannot reject a completed task", async () => {
    const h = harness("cursor", { installed: true }); h.refreshInstallations.mockImplementation(() => { throw new Error("offline"); });
    await h.start(); await expect(h.service.settled()).resolves.toBeUndefined();
    expect((await h.operation()).status).toBe("ready");
  });
  it("passes the installer's lease cancellation signal into staged executable verification", async () => {
    const h = harness("cursor"); const lease = new AbortController(); const entered = deferred();
    h.createContext.mockImplementation(async ({ signal }) => ({ run: async () => { entered.resolve(); return abortable(signal); } }));
    h.installer.install.mockImplementation(async (_recipe, { verify }) => verify("/fixture/agent", lease.signal));
    await h.start(); await entered.promise; lease.abort({ code: "installation-busy" }); await h.service.settled();
    expect(h.createContext.mock.calls[0][0].signal).toBe(lease.signal);
    expect(await h.operation()).toMatchObject({ status: "failed", installed: false, errorCode: "installation-busy" });
  });
});
