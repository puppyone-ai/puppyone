import { AgentRuntimeRegistry } from "../../../../electron/main/agent/runtime/agent-runtime-registry.mjs";
import { createCodexRuntimeDefinition } from "../../../../electron/main/agent/runtimes/codex/codex-runtime-definition.mjs";
import { CODEX_CAPABILITIES } from "../../../../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";

/** Test-only provider: no CLI, credentials, network, model or billable calls. */
export function createFixtureAgentRuntime({ allowResume = false } = {}) {
  let creates = 0;
  return new AgentRuntimeRegistry([createCodexRuntimeDefinition({
    appVersion: "fixture",
    discovery: { discover: async () => ({ provider: "codex", status: "ready", code: "READY",
      version: "0.144.1", minimumVersion: "0.144.1", executablePath: "/fixture/codex", environment: {}, message: "ready", selectable: true }) },
    adapterFactory: (options) => {
      let nativeId = null;
      return ({
      inspect: async () => ({ account: { account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" }, requiresOpenaiAuth: false },
        models: [{ id: "fixture", model: "fixture", displayName: "Fixture", isDefault: true }],
        capabilities: { manualApprovals: true, referenceInputs: CODEX_CAPABILITIES.referenceInputs }, warnings: [] }),
      createSession: async () => {
        nativeId = `fixture-${process.pid}-${++creates}`;
        return { providerSessionId: nativeId, title: `Fixture session ${creates}`, model: "fixture",
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      },
      resumeSession: async ({ threadId }) => {
        if (!allowResume) throw new Error("Display recovery must not resume the native fixture session.");
        nativeId = threadId;
        return { providerSessionId: threadId, model: "fixture", title: "Recovered fixture" };
      },
      startTurn: async () => {
        if (allowResume) options.onSessionPersisted?.({ providerSessionId: nativeId, sourceScopeId: "default" });
        options.onEvent({ type: "turn.started", providerSessionId: nativeId, turnId: "fixture-turn", payload: { status: "running" } });
        return { turnId: "fixture-turn" };
      },
      referenceMentionDelivery: () => "path",
      steerTurn: async () => {}, interruptTurn: async () => {}, resolveApproval: async () => {},
      disposeNative: async () => {}, dispose: async () => {},
      getSessionHistoryPort: () => ({ sourceScopeId: "default",
        hydrate: async () => ({ providerSessionId: nativeId, events: [], coverage: "complete", reason: null }), discover: async () => ({ supported: true, sessions: [], nextCursor: null }) }),
    }); },
  })]);
}
