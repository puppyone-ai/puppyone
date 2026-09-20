import { describe, expect, it, vi } from "vitest";
import { createLocalAgentActivationService } from "../../../../electron/main/local-agent-activation/activation-service.mjs";
import { createActivationRegistry } from "../../../../electron/main/local-agent-activation/activation-registry.mjs";

function harness({ restored = [], automatic = true } = {}) {
  let installed = false;
  const run = vi.fn(async () => ({ code: 0, stdout: "fixture 1", stderr: "" }));
  const createContext = vi.fn(async ({ signal }) => ({ signal, run }));
  const installer = { install: vi.fn(async (_recipe, { signal, verify, committed }) => {
    signal.throwIfAborted(); await verify("/fixture/codex"); installed = true; committed();
  }) };
  const registry = new Map([["codex", { id: "codex", installationId: "codex", terminalRecipeId: "codex", displayName: "Codex",
    publisher: "OpenAI", guideUrl: "https://developers.openai.com/codex/cli", recipe: automatic ? { version: "1" } : null }]]);
  const journal = { read: vi.fn(async () => restored), write: vi.fn(async () => {}) };
  const resolveInstallation = vi.fn(async () => installed ? { file: "/fixture/codex" } : null);
  const publish = vi.fn(); const refreshInstallations = vi.fn(); const openExternal = vi.fn();
  const service = createLocalAgentActivationService({ registry, installer, journal, resolveInstallation, publish, refreshInstallations, openExternal,
    createContext });
  const plan = () => service.plan(1, { setupId: "codex", surface: "chat" });
  const start = async () => { const prepared = await plan(); const value = await service.start(1, { planId: prepared.planId }); return value.operations[0]; };
  const operation = async () => (await service.read()).operations[0];
  return { service, run, createContext, installer, journal, resolveInstallation, publish, refreshInstallations, openExternal, plan, start, operation, setInstalled: () => { installed = true; } };
}
const waitForCancel = signal => new Promise((_resolve, reject) => {
  signal.throwIfAborted(); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

describe("application-owned local Agent activation", () => {
  it("planning is read-only, rejects renderer commands and binds consent to its owner", async () => {
    const h = harness(); const plan = await h.plan();
    expect(h.resolveInstallation).not.toHaveBeenCalled(); expect(h.installer.install).not.toHaveBeenCalled();
    await expect(h.service.start(2, { planId: plan.planId })).rejects.toThrow();
    await expect(h.service.plan(1, { setupId: "codex", surface: "chat", command: "curl" })).rejects.toThrow();
    await expect(h.service.plan(1, { setupId: "../codex", surface: "chat" })).rejects.toThrow();
    h.service.release(1); await expect(h.service.start(1, { planId: plan.planId })).rejects.toThrow();
  });
  it("installs once, completes without login, and treats duplicate consent as idempotent", async () => {
    const h = harness(); const plan = await h.plan();
    await Promise.all([h.service.start(1, { planId: plan.planId }), h.service.start(1, { planId: plan.planId })]);
    await h.service.settled(); await h.service.start(1, { planId: plan.planId });
    expect(h.installer.install).toHaveBeenCalledOnce(); expect(h.createContext).toHaveBeenCalledOnce();
    expect(h.run.mock.calls).toEqual([[["--version"]]]);
    expect(await h.operation()).toMatchObject({ status: "ready", installed: true,
      steps: ["prepare", "install", "verify"].map(id => ({ id, status: "complete" })) });
    expect(h.refreshInstallations).toHaveBeenCalledOnce();
    expect(h.publish.mock.calls.map(([snapshot]) => snapshot.revision)).toEqual([...h.publish.mock.calls.map(([snapshot]) => snapshot.revision)].sort((a, b) => a - b));
  });
  it.each([true, false])("existing CLI is activated without executing anything (automatic=%s)", async automatic => {
    const h = harness({ automatic }); h.setInstalled(); const operation = await h.start(); await h.service.settled();
    expect(h.installer.install).not.toHaveBeenCalled(); expect(h.createContext).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled(); expect(h.openExternal).not.toHaveBeenCalled();
    expect(await h.operation()).toMatchObject({ status: "ready", installed: true });
    expect((await h.operation()).steps[1].status).toBe("skipped");
    await expect(h.service.act(2, { operationId: operation.operationId, action: "login" })).rejects.toThrow("Invalid activation action");
  });
  it.each(["prepare", "install", "verify"])("cancels during %s without waiting behind work", async phase => {
    const h = harness(); const entered = vi.fn();
    const waiting = signal => { entered(); return waitForCancel(signal); };
    if (phase === "prepare") h.resolveInstallation.mockImplementation((_id, signal) => waiting(signal));
    if (phase === "install") h.installer.install.mockImplementation((_recipe, { signal }) => waiting(signal));
    if (phase === "verify") h.resolveInstallation.mockResolvedValueOnce(null).mockImplementation((_id, signal) => waiting(signal));
    const entry = await h.start(); await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    expect((await h.operation()).status).toBe({ prepare: "preparing", install: "installing", verify: "verifying" }[phase]);
    const value = await h.service.act(1, { operationId: entry.operationId, action: "cancel" });
    expect(["cancelling", "cancelled"]).toContain(value.operations[0].status);
    await h.service.settled(); expect((await h.operation()).status).toBe("cancelled");
    await h.service.act(1, { operationId: entry.operationId, action: "cancel" });
    expect((await h.operation()).installed).toBe(phase === "verify");
  });
  it("keeps cancellation independent from a stalled initial journal write", async () => {
    const h = harness(); let release;
    h.journal.write.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const plan = await h.plan(); const starting = h.service.start(1, { planId: plan.planId });
    await vi.waitFor(() => expect(h.journal.write).toHaveBeenCalled());
    const entry = await h.operation(); await h.service.act(1, { operationId: entry.operationId, action: "cancel" });
    expect((await h.operation()).status).toBe("cancelled"); release(); await starting;
    expect(h.installer.install).not.toHaveBeenCalled();
  });
  it("closing a renderer does not cancel; late post-commit discovery cannot resurrect cancelled work", async () => {
    const h = harness(); let finish;
    h.resolveInstallation.mockResolvedValueOnce(null).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const entry = await h.start(); h.service.release(1);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect((await h.operation()).status).toBe("verifying");
    await h.service.act(2, { operationId: entry.operationId, action: "cancel" });
    finish({ file: "/fixture/codex" }); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "cancelled", installed: true });
    expect(h.publish.mock.calls.every(([snapshot]) => snapshot.operations[0].status !== "ready")).toBe(true);
  });
  it("restores interrupted work without re-running anything, and permits a fresh confirmed retry", async () => {
    const old = harness({ automatic: false }); await old.start(); await old.service.settled();
    const h = harness({ restored: [(await old.operation())] });
    expect((await h.operation()).status).toBe("interrupted"); expect(h.installer.install).not.toHaveBeenCalled();
    expect((await h.operation()).steps.every(step => step.status !== "running")).toBe(true);
    await h.start(); await h.service.settled(); expect((await h.operation()).status).toBe("ready");
  });
  it("guided providers use the same installed=activated rule", async () => {
    const h = harness({ automatic: false }); expect((await h.plan()).mode).toBe("guided");
    const entry = await h.start(); await h.service.settled(); expect((await h.operation()).status).toBe("setup-required");
    expect(h.openExternal).not.toHaveBeenCalled();
    await h.service.act(1, { operationId: entry.operationId, action: "guide" });
    expect(h.openExternal).toHaveBeenCalledWith("https://developers.openai.com/codex/cli");
    h.setInstalled(); await h.service.act(1, { operationId: entry.operationId, action: "check" }); await h.service.settled();
    expect((await h.operation()).status).toBe("ready"); expect(h.installer.install).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled();
  });
  it("failure exposes a typed error, never vendor output or login secrets", async () => {
    const h = harness(); h.installer.install.mockRejectedValue(new Error("token=fixture-secret"));
    await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "failed", errorCode: "installation" });
    expect(JSON.stringify(await h.service.read())).not.toContain("fixture-secret");
  });
  it("discovery failure never authorizes installing over a possibly existing CLI", async () => {
    const h = harness(); h.resolveInstallation.mockRejectedValue(Object.assign(new Error("fixture"), { code: "installation-check" }));
    await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "failed", errorCode: "installation-check" });
    expect(h.installer.install).not.toHaveBeenCalled();
  });
  it.each([{ code: 1, stdout: "fixture", stderr: "" }, { code: 0, stdout: "", stderr: "" }])("does not commit an invalid staged executable", async result => {
    const h = harness(); h.run.mockResolvedValue(result); await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "failed", installed: false, errorCode: "installation" });
  });
  it.each(["arm64", "x64"])("supports reviewed %s recipes without runtime ports or update flags", arch => {
    const registry = createActivationRegistry({ platform: "darwin", arch });
    for (const id of ["codex", "cursor"]) {
      expect(registry.get(id).recipe.setupId).toBe(id); expect(registry.get(id)).not.toHaveProperty("port");
      expect(registry.get(id).recipe).not.toHaveProperty("argsPrefix");
    }
    expect(createActivationRegistry({ platform: "linux", arch }).get("codex").recipe).toBeNull();
  });
});
