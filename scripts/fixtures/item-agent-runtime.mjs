import { AgentRuntimeRegistry } from "../../electron/main/agent/runtime/agent-runtime-registry.mjs";
import { createCodexRuntimeDefinition } from "../../electron/main/agent/runtimes/codex/codex-runtime-definition.mjs";

/** Test-only provider: no CLI, credentials, network, model or billable calls. */
export function createFixtureAgentRuntime() {
  let creates = 0;
  return new AgentRuntimeRegistry([createCodexRuntimeDefinition({
    appVersion: "fixture",
    discovery: { discover: async () => ({ provider: "codex", status: "ready", code: "READY",
      version: "0.144.1", minimumVersion: "0.144.1", executablePath: "/fixture/codex", environment: {}, message: "ready", selectable: true }) },
    adapterFactory: (options) => ({
      inspect: async () => ({ account: { account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" }, requiresOpenaiAuth: false },
        models: [{ id: "fixture", model: "fixture", displayName: "Fixture", isDefault: true }], capabilities: { manualApprovals: true }, warnings: [] }),
      createSession: async () => ({ providerSessionId: `fixture-${process.pid}-${++creates}`, title: `Fixture session ${creates}`, model: "fixture",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      resumeSession: async () => { throw new Error("Display recovery must not resume the native fixture session."); },
      startTurn: async () => {
        options.onEvent({ type: "turn.started", providerSessionId: `fixture-${process.pid}-${creates}`, turnId: "fixture-turn", payload: { status: "running" } });
        return { turnId: "fixture-turn" };
      },
      referenceMentionDelivery: () => "path",
      steerTurn: async () => {}, interruptTurn: async () => {}, resolveApproval: async () => {},
      disposeNative: async () => {}, dispose: async () => {},
      getSessionHistoryPort: () => ({ sourceScopeId: "default", discover: async () => ({ supported: true, sessions: [], nextCursor: null }) }),
    }),
  })]);
}
