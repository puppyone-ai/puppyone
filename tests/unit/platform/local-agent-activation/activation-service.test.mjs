import { describe, expect, it, vi } from "vitest";
import { createLocalAgentActivationService } from "../../../../electron/main/local-agent-activation/activation-service.mjs";
import { createCodexActivationPort } from "../../../../electron/main/agent/runtimes/codex/codex-activation-port.mjs";

function harness({ restored = [], automatic = true, signedIn = true } = {}) {
  let installed = false;
  const port = { verifyInstallation: vi.fn(async () => {}), authentication: vi.fn(async () => signedIn ? "signed-in" : "signed-out"),
    login: vi.fn(async () => { signedIn = true; }), verifyReady: vi.fn(async () => {}) };
  const installer = { install: vi.fn(async (_recipe, { signal, verify, committed }) => {
    signal.throwIfAborted(); await verify("/fixture/codex"); installed = true; committed();
  }) };
  const registry = new Map([["codex", { id: "codex", installationId: "codex", terminalRecipeId: "codex", displayName: "Codex",
    publisher: "OpenAI", guideUrl: "https://developers.openai.com/codex/cli", recipe: automatic ? { version: "1" } : null, port: automatic ? port : null }]]);
  const journal = { read: vi.fn(async () => restored), write: vi.fn(async () => {}) };
  const resolveInstallation = vi.fn(async () => installed ? { file: "/fixture/codex" } : null);
  const publish = vi.fn(); const refreshInstallations = vi.fn(); const openExternal = vi.fn();
  const service = createLocalAgentActivationService({ registry, installer, journal, resolveInstallation, publish, refreshInstallations, openExternal,
    createContext: async ({ signal }) => ({ signal }) });
  const plan = () => service.plan(1, { setupId: "codex", surface: "chat" });
  const start = async () => { const prepared = await plan(); const value = await service.start(1, { planId: prepared.planId }); return value.operations[0]; };
  const operation = async () => (await service.read()).operations[0];
  return { service, port, installer, journal, resolveInstallation, publish, refreshInstallations, openExternal, plan, start, operation, setInstalled: () => { installed = true; } };
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
  it("installs once, verifies readiness, and treats duplicate consent as idempotent even after completion", async () => {
    const h = harness(); const plan = await h.plan();
    await Promise.all([h.service.start(1, { planId: plan.planId }), h.service.start(1, { planId: plan.planId })]);
    await h.service.settled(); await h.service.start(1, { planId: plan.planId });
    expect(h.installer.install).toHaveBeenCalledOnce(); expect(h.port.verifyReady).toHaveBeenCalledOnce();
    expect(await h.operation()).toMatchObject({ status: "ready", installed: true });
    expect(h.port.login).not.toHaveBeenCalled();
    expect(h.publish.mock.calls.map(([snapshot]) => snapshot.revision)).toEqual([...h.publish.mock.calls.map(([snapshot]) => snapshot.revision)].sort((a, b) => a - b));
  });
  it("never installs over an existing CLI; waits for explicit account login", async () => {
    const h = harness({ signedIn: false }); h.setInstalled(); const operation = await h.start(); await h.service.settled();
    expect(h.installer.install).not.toHaveBeenCalled(); expect(h.port.login).not.toHaveBeenCalled();
    expect((await h.operation()).status).toBe("authentication-required");
    await h.service.act(2, { operationId: operation.operationId, action: "login" }); await h.service.settled();
    expect(h.port.login).toHaveBeenCalledOnce(); expect((await h.operation()).status).toBe("ready");
  });
  it.each(["install", "authentication", "login", "verifyReady"])("cancels during %s without waiting behind work", async phase => {
    const h = harness({ signedIn: phase !== "login" });
    if (phase === "install") h.installer.install.mockImplementation((_recipe, { signal }) => waitForCancel(signal));
    else if (phase !== "login") { h.setInstalled(); h.port[phase].mockImplementation(context => waitForCancel(context.signal)); }
    const entry = await h.start();
    if (phase === "login") {
      await h.service.settled(); h.port.login.mockImplementation(context => waitForCancel(context.signal));
      await h.service.act(1, { operationId: entry.operationId, action: "login" });
    }
    await vi.waitFor(() => expect(phase === "install" ? h.installer.install : h.port[phase]).toHaveBeenCalled());
    const value = await h.service.act(1, { operationId: entry.operationId, action: "cancel" });
    expect(["cancelling", "cancelled"]).toContain(value.operations[0].status);
    await h.service.settled(); expect((await h.operation()).status).toBe("cancelled");
    await h.service.act(1, { operationId: entry.operationId, action: "cancel" });
    if (phase === "install") expect(h.port.verifyReady).not.toHaveBeenCalled();
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
  it("closing a renderer releases plans, not work; cancelling after install retains that fact", async () => {
    const h = harness({ signedIn: false }); const entry = await h.start(); h.service.release(1); await h.service.settled();
    await h.service.act(2, { operationId: entry.operationId, action: "cancel" });
    expect(await h.operation()).toMatchObject({ status: "cancelled", installed: true });
  });
  it("restores interrupted work without re-running anything, and permits a fresh confirmed retry", async () => {
    const old = harness({ signedIn: false }); await old.start(); await old.service.settled();
    const h = harness({ restored: [(await old.operation())] });
    expect((await h.operation()).status).toBe("interrupted"); expect(h.installer.install).not.toHaveBeenCalled();
    expect((await h.operation()).steps.every(step => step.status !== "running")).toBe(true);
    await h.start(); await h.service.settled(); expect((await h.operation()).status).toBe("ready");
  });
  it("guided providers open a fixed guide only on request and never claim authentication readiness", async () => {
    const h = harness({ automatic: false }); expect((await h.plan()).mode).toBe("guided");
    const entry = await h.start(); await h.service.settled(); expect((await h.operation()).status).toBe("setup-required");
    expect(h.openExternal).not.toHaveBeenCalled();
    await h.service.act(1, { operationId: entry.operationId, action: "guide" });
    expect(h.openExternal).toHaveBeenCalledWith("https://developers.openai.com/codex/cli");
    h.setInstalled(); await h.service.act(1, { operationId: entry.operationId, action: "check" }); await h.service.settled();
    expect((await h.operation()).status).toBe("detected"); expect(h.installer.install).not.toHaveBeenCalled();
  });
  it("failure exposes a typed error, never vendor output or login secrets", async () => {
    const h = harness(); h.installer.install.mockRejectedValue(new Error("token=fixture-secret"));
    await h.start(); await h.service.settled();
    expect(await h.operation()).toMatchObject({ status: "failed", errorCode: "installation" });
    expect(JSON.stringify(await h.service.read())).not.toContain("fixture-secret");
  });
  it.each([[0, "Logged in using ChatGPT", "signed-in"], [0, "not authenticated", "signed-out"], [1, "Not logged in", "signed-out"], [1, "unrecognized", "unknown"]])("classifies Codex auth conservatively: %s %s", async (code, stdout, expected) => {
    expect(await createCodexActivationPort().authentication({ run: async () => ({ code, stdout, stderr: "" }) })).toBe(expected);
  });
});
