import { describe, expect, it, vi } from "vitest";
import { readinessWithAccountState } from "../../../../../electron/main/agent/application/agent-input-policy.mjs";
import { createAgentRuntimeCatalog } from "../../../../../electron/main/agent/application/agent-runtime-catalog.mjs";
import { AgentRuntimeRegistry } from "../../../../../electron/main/agent/runtime/agent-runtime-registry.mjs";

describe("Agent readiness reason routing", () => {
  it.each([
    [{ requiresOpenaiAuth: true }, "AUTHENTICATION_REQUIRED"],
    [{ requiresOpenaiAuth: true, setupReason: "authentication-expired" }, "AUTHENTICATION_EXPIRED"],
    [{ requiresOpenaiAuth: false, requiresRuntimeSetup: true }, "RUNTIME_SETUP_REQUIRED"],
  ])("maps structured account setup to %s", (account, code) => {
    expect(readinessWithAccountState(readyReadiness(), { account: null, ...account }, "Fixture Agent"))
      .toMatchObject({ status: "installed-not-authenticated", code, selectable: false });
  });

  it("accepts an explicit runtime handshake as authoritative when a status probe fails", async () => {
    const inspect = vi.fn(async () => inspection());
    const catalog = catalogFor(cursorProbeFailure(), inspect);

    const result = await catalog.discover({ runtimeId: "cursor" }, "/workspace");

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(result.readiness).toMatchObject({ status: "ready", code: "READY", selectable: true });
    expect(result.readiness.message).toMatch(/verified through its native protocol/i);
  });

  it("preserves the exact probe code when the authoritative fallback also fails", async () => {
    const inspect = vi.fn(async () => { throw new Error("ACP handshake exited unexpectedly"); });
    const catalog = catalogFor(cursorProbeFailure(), inspect);

    const result = await catalog.discover({ runtimeId: "cursor" }, "/workspace");

    expect(result.readiness).toMatchObject({
      status: "error",
      code: "AUTHENTICATION_PROBE_FAILED",
      selectable: false,
      message: "Cursor status failed.",
    });
    expect(result.readiness.diagnostic).toMatch(/exit code 139.*fallback failed.*ACP handshake exited unexpectedly/i);
  });

  it("single-flights concurrent protocol verification for one runtime and workspace", async () => {
    const deferred = promiseWithResolvers();
    const inspect = vi.fn(() => deferred.promise);
    const catalog = catalogFor(cursorProbeFailure(), inspect);

    const first = catalog.discover({ runtimeId: "cursor" }, "/workspace");
    const second = catalog.discover({ runtimeId: "cursor" }, "/workspace");
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    deferred.resolve(inspection());

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ readiness: expect.objectContaining({ status: "ready" }) }),
      expect.objectContaining({ readiness: expect.objectContaining({ status: "ready" }) }),
    ]);
    expect(inspect).toHaveBeenCalledTimes(1);
  });
});

function catalogFor(readiness, inspect) {
  const runtimeRegistry = new AgentRuntimeRegistry([{
    manifest: {
      id: "cursor",
      displayName: "Cursor Agent",
      priority: 1,
      execution: { kind: "local-process", distribution: "user-installed", controller: "bundled-adapter" },
      protocol: { kind: "acp", transport: "stdio-json-rpc" },
      integration: { kind: "native-protocol", adapter: "generic-acp" },
      trust: { level: "first-party", publisher: "Cursor" },
      ownership: {
        harness: "runtime",
        credentials: ["runtime"],
        models: "runtime",
        billing: ["runtime"],
        session: "runtime",
      },
    },
    discovery: { discover: vi.fn(async () => readiness) },
    createAdapter: () => ({
      inspect,
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      readHistory: vi.fn(),
      startTurn: vi.fn(),
      interruptTurn: vi.fn(),
      dispose: vi.fn(async () => {}),
    }),
  }]);
  return createAgentRuntimeCatalog({
    runtimeRegistry,
    processSupervisor: { runStart: async (_operation, start) => start() },
  });
}

function readyReadiness() {
  return {
    runtimeId: "fixture",
    provider: "fixture",
    status: "ready",
    code: "READY",
    version: "1.0.0",
    minimumVersion: null,
    message: "Fixture Agent is ready.",
    selectable: true,
  };
}

function cursorProbeFailure() {
  return {
    runtimeId: "cursor",
    provider: "cursor",
    status: "error",
    code: "AUTHENTICATION_PROBE_FAILED",
    version: "2026.08.1",
    minimumVersion: null,
    executablePath: "/tools/cursor-agent",
    environment: {},
    inspectionFallback: "runtime-handshake",
    message: "Cursor status failed.",
    diagnostic: "Cursor status probe ended with exit code 139.",
  };
}

function inspection() {
  return {
    account: {
      account: { type: "cursor", email: null, planType: null },
      requiresOpenaiAuth: false,
    },
    providers: [],
    models: [{
      id: "cursor/auto",
      model: "cursor/auto",
      displayName: "Auto",
      description: "Cursor automatic model",
      isDefault: true,
    }],
    modes: [],
    commands: [],
    capabilities: {},
    warnings: [],
  };
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
