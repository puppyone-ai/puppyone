import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAgentService } from "../../../../electron/main/agent/agent-service.mjs";
import { AgentRuntimeRegistry } from "../../../../electron/main/agent/runtime/agent-runtime-registry.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/agent/runtimes/secondary-runtime.json", import.meta.url), "utf8"));

describe("provider-neutral AgentRuntimePort contract", () => {
  it("runs a second fake harness through AgentService without runtime-name lifecycle branches", async () => {
    const registry = new AgentRuntimeRegistry([{
      manifest: fixture.manifest,
      discovery: { discover: async () => ({ runtimeId: fixture.descriptor.id, provider: fixture.descriptor.id, status: "ready", code: "READY", version: "1.0.0", executablePath: "/fixture", environment: {}, message: "ready" }) },
      createAdapter: (options) => fakeAdapter(options),
    }]);
    const persistence = { findLatest: vi.fn(async () => null), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const service = createAgentService({ runtimeRegistry: registry, persistence, logger: { warn: vi.fn() } });
    const sender = new Sender(7);
    const inspection = await service.discoverProviders(sender, { runtimeId: "fixture-harness" }, "/workspace");
    expect(inspection.selectedRuntimeId).toBe("fixture-harness");
    expect(inspection.capabilities).toMatchObject({ streamingText: true, queue: false });
    expect(inspection.capabilities).not.toHaveProperty("unknownCapability");
    const snapshot = await service.createSession(sender, { runtimeId: "fixture-harness" }, "/workspace");
    await service.startTurn(sender, { sessionId: snapshot.session.id, prompt: "hello" }, "/workspace");
    const replay = service.replay(sender, { sessionId: snapshot.session.id, afterSequence: 0 });
    expect(replay.events.map((event) => event.type)).toContain("assistant.completed");
    expect(replay.events.every((event) => event.runtimeId === "fixture-harness" && event.provider === "fixture-harness")).toBe(true);
    await service.closeAll();
  });
});

function fakeAdapter({ onEvent }) {
  return {
    inspect: vi.fn(async () => ({
      ...fixture.inspection,
      capabilities: { ...fixture.inspection.capabilities, unknownCapability: true },
      runtime: fixture.descriptor,
      warnings: [],
    })),
    createSession: vi.fn(async () => ({ providerSessionId: "native-fixture", title: "Fixture", model: "fixture/model", mode: "build" })),
    resumeSession: vi.fn(async ({ threadId }) => ({ providerSessionId: threadId, title: "Fixture" })),
    readHistory: vi.fn(async () => []),
    startTurn: vi.fn(async ({ prompt }) => {
      onEvent({ type: "turn.started", providerSessionId: "native-fixture", turnId: "turn-fixture", payload: { prompt } });
      onEvent({ type: "assistant.completed", providerSessionId: "native-fixture", turnId: "turn-fixture", itemId: "message-fixture", payload: { text: "done" } });
      onEvent({ type: "turn.completed", providerSessionId: "native-fixture", turnId: "turn-fixture", payload: { status: "completed" } });
      return { turnId: "turn-fixture" };
    }),
    interruptTurn: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; this.send = vi.fn(); }
  isDestroyed() { return false; }
}
