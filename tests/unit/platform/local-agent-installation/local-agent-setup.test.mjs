import { describe, expect, it, vi } from "vitest";
import { createLocalAgentSetupService } from "../../../../electron/main/local-agent-installation/setup/setup-service.mjs";
import { createCompanionPresenceService } from "../../../../electron/main/local-agent-installation/setup/companion-presence-service.mjs";
import { setupRegistry, companionIdentities } from "../../../../electron/main/local-agent-installation/setup/setup-registry.mjs";
import { createLocalAgentInstallationService } from "../../../../electron/main/local-agent-installation/installation-service.mjs";
import { adviseSetup } from "../../../../electron/main/local-agent-installation/setup/setup-advisor.mjs";
import { normalizeSetupPreferences } from "../../../../src/features/local-agents/model/localAgentSetupPreferences";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../../../../src/features/desktop-terminal/model/terminalLaunchers";
import { AGENT_CHAT_CREATION_RECIPES } from "../../../../src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes";

const preferences = { enabled: true, dismissedSetupIds: [], snoozedUntil: {} };
const request = { clientId: "test:1", surface: "chat", eligibleInstallationIds: setupRegistry.map(({ id }) => id), hiddenAgentIds: [], preferences, refreshPresence: false };
const companions = companionIdentities.map(({ id }) => ({ companionId: id, status: "present" }));
const snapshot = (status = "not-found", generation = 1) => ({ generation, results: setupRegistry.map(({ id }) => ({ agentId: id, status })) });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness() {
  let current = snapshot();
  let clock = 1_000;
  const installationService = { discover: vi.fn(async () => current), getSnapshot: () => current, isScanning: vi.fn(() => false) };
  const presenceService = { discover: vi.fn(async () => companions), dispose: vi.fn() };
  const openExternal = vi.fn(async () => {});
  const service = createLocalAgentSetupService({ installationService, presenceService, platform: "darwin", openExternal, now: () => clock });
  return { service, installationService, presenceService, openExternal, setSnapshot(value) { current = value; }, setTime(value) { clock = value; } };
}

describe("setup advisor and trusted guide broker", () => {
  it("keeps trusted target recipes aligned and rejects Chat-only routes on Terminal even when requested", async () => {
    expect(setupRegistry.map(({ runtimeId }) => runtimeId).sort())
      .toEqual(AGENT_CHAT_CREATION_RECIPES.filter(({ availability }) => availability !== "bundled").map(({ id }) => id).sort());
    expect(setupRegistry.flatMap(({ terminalRecipeId }) => terminalRecipeId ? [terminalRecipeId] : []).sort())
      .toEqual(DESKTOP_TERMINAL_LAUNCHERS.filter(({ id }) => id !== "shell").map(({ id }) => id).sort());
    const h = harness();
    const inspected = await h.service.inspect(1, { ...request, surface: "terminal" });
    expect(inspected.entries.some(({ setupId }) => setupId.startsWith("workbuddy-"))).toBe(false);
    await expect(h.service.act(1, { clientId: request.clientId, revision: inspected.revision, setupId: "workbuddy-china", actionId: "open-guide", mode: "manual" })).rejects.toThrow("Unavailable");
    expect(h.openExternal).not.toHaveBeenCalled();
  });
  it("recommends companion-backed missing CLIs only; catalog is independent from readiness", async () => {
    const h = harness();
    const result = await h.service.inspect(1, request);
    expect(result.entries.filter(({ recommended }) => recommended).map(({ setupId }) => setupId)).toEqual(["codex", "cursor"]);
    expect(result.entries).toHaveLength(8);
    expect(result.entries.find(({ setupId }) => setupId === "workbuddy-china").strategy).toBe("app-bundled-runtime");
    expect(JSON.stringify(result)).not.toMatch(/Applications|guideUrl|bundleId|PATH|https:/u);
    expect(setupRegistry.some(({ id }) => id === "puppyone-agent")).toBe(false);
  });

  it.each(["found", "failed"])("does not suggest installation for %s observations", async (status) => {
    const h = harness(); h.setSnapshot(snapshot(status));
    expect((await h.service.inspect(1, request)).entries.some(({ recommended }) => recommended)).toBe(false);
  });

  it("fails closed for a shared environment failure but isolates another product's failure", async () => {
    const h = harness();
    const observed = snapshot();
    observed.results.find(({ agentId }) => agentId === "hermes").status = "failed";
    h.setSnapshot(observed);
    expect((await h.service.inspect(1, request)).entries.filter(({ recommended }) => recommended)).toHaveLength(2);
    observed.results[0].reasonCode = "environment-unavailable";
    expect((await h.service.inspect(1, request)).entries.some(({ recommended }) => recommended)).toBe(false);
  });

  it.each(["not-found", "unknown", "unsupported"])("does not infer presence from %s", (status) => {
    const entries = adviseSetup({ registry: setupRegistry, platform: "darwin", request, installations: snapshot(),
      companions: [{ companionId: "codex", status }], now: 1, sessionSuppressed: new Set() });
    expect(entries.some(({ recommended }) => recommended)).toBe(false);
  });

  it("respects global, hidden, permanent and session snooze policy without blocking manual guides", async () => {
    const h = harness();
    const suppressed = { ...request, hiddenAgentIds: ["codex"], preferences: { ...preferences, snoozedUntil: { cursor: 2_000 } } };
    expect((await h.service.inspect(1, suppressed)).entries.some(({ recommended }) => recommended)).toBe(false);
    h.setTime(3_000);
    const later = await h.service.inspect(1, { ...request, preferences: { ...preferences, dismissedSetupIds: ["codex"] } });
    expect(later.entries.some(({ recommended }) => recommended)).toBe(false);
    const off = await h.service.inspect(1, { ...request, preferences: { ...preferences, enabled: false } });
    expect(h.presenceService.discover).toHaveBeenCalledTimes(2);
    expect(await h.service.act(1, { clientId: request.clientId, revision: off.revision, setupId: "pi", actionId: "open-guide", mode: "recommendation" })).toEqual({ status: "stale" });
    expect(await h.service.act(1, { clientId: request.clientId, revision: off.revision, setupId: "pi", actionId: "open-guide", mode: "manual" })).toEqual({ status: "guide-opened" });
    expect(h.openExternal).toHaveBeenCalledWith(setupRegistry.find(({ id }) => id === "pi").guideUrl);
  });

  it("rejects arbitrary actions, URLs, setup IDs, platforms and client ownership", async () => {
    const h = harness();
    const inspected = await h.service.inspect(1, request);
    const action = { clientId: request.clientId, revision: inspected.revision, setupId: "codex", actionId: "open-guide", mode: "manual" };
    await expect(h.service.act(1, { ...action, url: "https://example.invalid" })).rejects.toThrow();
    await expect(h.service.act(1, { ...action, setupId: "shell" })).rejects.toThrow();
    await expect(h.service.act(1, { ...action, actionId: "execute" })).rejects.toThrow();
    expect(await h.service.act(2, action)).toEqual({ status: "stale" });
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(adviseSetup({ registry: setupRegistry, platform: "unsupported", request, installations: snapshot(), companions, now: 0, sessionSuppressed: new Set() })).toEqual([]);
  });

  it("fences refreshing, found, newer-generation, expired and released receipts", async () => {
    const h = harness();
    const inspected = await h.service.inspect(1, request);
    const action = { clientId: request.clientId, revision: inspected.revision, setupId: "codex", actionId: "open-guide", mode: "manual" };
    h.installationService.isScanning.mockReturnValue(true);
    expect(await h.service.act(1, action)).toEqual({ status: "stale" });
    h.installationService.isScanning.mockReturnValue(false);
    h.setSnapshot(snapshot("found", 2));
    expect(await h.service.act(1, action)).toEqual({ status: "detected" });
    h.setSnapshot(snapshot("not-found", 2));
    expect(await h.service.act(1, action)).toEqual({ status: "stale" });
    h.setSnapshot(snapshot()); h.setTime(31_000);
    expect(await h.service.act(1, action)).toEqual({ status: "stale" });
    h.setTime(1_000); h.service.release(1);
    expect(await h.service.act(1, action)).toEqual({ status: "stale" });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it("does not reopen a released view after slow evidence and suppresses duplicate guide clicks", async () => {
    const h = harness(); const gate = deferred();
    h.presenceService.discover.mockReturnValueOnce(gate.promise);
    const pending = h.service.inspect(1, request);
    h.service.release(1, request.clientId); gate.resolve(companions);
    await expect(pending).rejects.toThrow("superseded");
    const inspected = await h.service.inspect(1, request);
    const open = deferred(); h.openExternal.mockReturnValueOnce(open.promise);
    const action = { clientId: request.clientId, revision: inspected.revision, setupId: "codex", actionId: "open-guide", mode: "manual" };
    const first = h.service.act(1, action);
    expect(await h.service.act(1, action)).toEqual({ status: "stale" });
    open.resolve(); expect(await first).toEqual({ status: "guide-opened" });
    expect(h.openExternal).toHaveBeenCalledOnce();
  });

  it("rejects a recommendation from an older companion scan while preserving explicit manual help", async () => {
    const h = harness();
    h.presenceService.getRevision = () => 1;
    h.presenceService.isCurrentRevision = vi.fn(() => true);
    const inspected = await h.service.inspect(1, request);
    h.presenceService.isCurrentRevision.mockReturnValue(false);
    const action = { clientId: request.clientId, revision: inspected.revision, setupId: "codex", actionId: "open-guide" };
    expect(await h.service.act(1, { ...action, mode: "recommendation" })).toEqual({ status: "stale" });
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(await h.service.act(1, { ...action, mode: "manual" })).toEqual({ status: "guide-opened" });
  });

  it("does not delay CLI progress or completion for slow companion discovery", async () => {
    const gate = deferred(); const progress = vi.fn();
    const installationService = createLocalAgentInstallationService({ createResolutionContext: async () => ({}), resolveInstallation: async () => ({ status: "found" }) });
    const service = createLocalAgentSetupService({ installationService,
      presenceService: { discover: () => gate.promise, dispose() {} }, platform: "darwin", openExternal: vi.fn() });
    const pending = service.inspect(1, request); const finished = vi.fn(); void pending.then(finished);
    const installed = await installationService.discover({ onProgress: progress });
    expect(installed.availableAgentIds).toHaveLength(8); expect(progress).toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    gate.resolve(companions); await pending;
    installationService.dispose(); service.dispose();
  });

  it("reuses failed terminal snapshots instead of creating an inspection-refresh feedback loop", async () => {
    const h = harness(); h.setSnapshot(snapshot("failed"));
    await h.service.inspect(1, request); await h.service.inspect(1, request);
    expect(h.installationService.discover).not.toHaveBeenCalled();
  });

  it("refreshes expired installation evidence once even when setup is reopened without a focus event", async () => {
    const h = harness(); h.setTime(40_000);
    h.setSnapshot({ ...snapshot(), completedAt: new Date(1_000).toISOString() });
    h.installationService.discover.mockImplementation(async () => {
      const value = { ...snapshot("not-found", 2), completedAt: new Date(40_000).toISOString() };
      h.setSnapshot(value); return value;
    });
    await h.service.inspect(1, request); await h.service.inspect(1, request);
    expect(h.installationService.discover).toHaveBeenCalledExactlyOnceWith({ refresh: true });
  });

  it("normalizes persisted preferences without preserving unknown IDs or installation evidence", () => {
    expect(normalizeSetupPreferences({ enabled: false, dismissedSetupIds: ["codex", "codex", "evil"], snoozedUntil: { codex: 42, cursor: -1, evil: 40 }, path: "/not-preserved" }))
      .toEqual({ enabled: false, dismissedSetupIds: ["codex"], snoozedUntil: { codex: 42 } });
    expect(normalizeSetupPreferences(null)).toEqual(preferences);
  });
});

describe("companion presence lifecycle", () => {
  it("invalidates the previous presence revision as soon as another window refreshes", async () => {
    const gate = deferred();
    const port = { inspect: vi.fn().mockResolvedValueOnce(companions).mockReturnValueOnce(gate.promise) };
    const service = createCompanionPresenceService({ port });
    const value = await service.discover(); const revision = service.getRevision(value);
    expect(service.isCurrentRevision(revision)).toBe(true);
    const refresh = service.discover({ refresh: true });
    expect(service.isCurrentRevision(revision)).toBe(false);
    gate.resolve([{ companionId: "codex", status: "not-found" }]); await refresh;
    expect(service.isCurrentRevision(revision)).toBe(false);
    service.dispose();
  });
  it("coalesces windows, queues one refresh, caches healthy results and expires after 30 seconds", async () => {
    const gate = deferred(); let clock = 0;
    const port = { inspect: vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(companions) };
    const service = createCompanionPresenceService({ port, now: () => clock });
    const initial = service.discover(); expect(service.discover()).toBe(initial);
    const refresh = service.discover({ refresh: true }); expect(service.discover({ refresh: true })).toBe(refresh);
    gate.resolve(companions); await refresh;
    expect(port.inspect).toHaveBeenCalledTimes(2);
    await service.discover(); expect(port.inspect).toHaveBeenCalledTimes(2);
    clock = 30_000; await service.discover(); expect(port.inspect).toHaveBeenCalledTimes(3);
    service.dispose(); expect(await service.discover()).toEqual([]);
  });

  it("does not negative-cache unknown or failing observations", async () => {
    const port = { inspect: vi.fn().mockRejectedValueOnce(new Error("private path"))
      .mockResolvedValueOnce([{ companionId: "codex", status: "unknown" }]).mockResolvedValue(companions) };
    const service = createCompanionPresenceService({ port });
    expect(JSON.stringify(await service.discover())).not.toContain("private path");
    await service.discover(); await service.discover(); expect(port.inspect).toHaveBeenCalledTimes(3);
    service.dispose();
  });
});
