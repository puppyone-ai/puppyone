import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  OpenCodeAcpAdapter,
  buildPromptBlocks,
} from "../../../../../electron/main/agent/runtimes/opencode-protocol/opencode-acp-adapter.mjs";

const NATIVE_RUNTIME = Object.freeze({ id: "opencode-native", displayName: "OpenCode", kind: "native-cli" });

describe("OpenCode ACP AgentRuntimePort adapter", () => {
  it("maps probed image snapshots and workspace resources to exact ACP prompt blocks", () => {
    const image = Buffer.from("image-bytes").toString("base64");
    expect(buildPromptBlocks({
      prompt: "Inspect",
      instructions: "",
      workspaceRoot: "/workspace",
      references: [
        { kind: "workspace-entry", path: "/workspace/src/app.ts", name: "app.ts" },
        { kind: "staged-attachment", mime: "image/png", snapshotUrl: `data:image/png;base64,${image}` },
      ],
      profile: { image: true },
    })).toEqual([
      { type: "text", text: "Inspect" },
      { type: "resource_link", uri: "file:///workspace/src/app.ts", name: "app.ts", title: "app.ts" },
      { type: "image", data: image, mimeType: "image/png" },
    ]);
    expect(() => buildPromptBlocks({
      prompt: "Inspect",
      instructions: "",
      workspaceRoot: "/workspace",
      references: [{ kind: "staged-attachment", mime: "image/png", snapshotUrl: "data:image/jpeg;base64,aQ==" }],
      profile: { image: true },
    })).toThrow(/materialize.*staged image/i);
    expect(() => buildPromptBlocks({
      prompt: "Inspect",
      instructions: "",
      workspaceRoot: "/workspace",
      references: [{ kind: "workspace-entry", path: "/outside/secret.txt" }],
    })).toThrow(/invalid workspace reference/i);
  });

  it("uses one native ACP session for model selection, streaming, approvals and follow-up turns", async () => {
    const connections = [];
    const onEvent = vi.fn();
    const adapter = new OpenCodeAcpAdapter({
      readiness: readiness(),
      workspaceRoot: "/workspace",
      runtimeDescriptor: NATIVE_RUNTIME,
      appVersion: "1.2.3",
      onEvent,
      connectionFactory: (options) => {
        const connection = new FakeAcpConnection(options);
        connections.push(connection);
        return connection;
      },
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: "AGENTS.md", text: "Keep tests green.", bytes: 17 })),
    });

    const inspection = await adapter.inspect();
    expect(inspection).toMatchObject({
      account: { requiresRuntimeSetup: false },
      providers: [{ id: "openai", modelCount: 2 }],
      modes: expect.arrayContaining([expect.objectContaining({ id: "build", isDefault: true })]),
      capabilities: {
        streamingText: true,
        manualApprovals: true,
        sessionHistory: true,
        history: { discovery: "unsupported", exactOpen: "supported", hydration: "push-replay" },
      },
    });
    expect(inspection.capabilities.referenceInputs).toMatchObject({
      attachments: {
        image: { accepted: true },
        text: { accepted: true },
        binary: { accepted: true },
      },
    });
    expect(inspection.capabilities.revision).toBe("opencode-native-acp:1:image1:embedded1");
    expect(inspection.models.map((model) => model.model)).toEqual(["openai/gpt-5", "openai/gpt-4.1"]);
    expect(inspection.commands).toEqual([expect.objectContaining({ name: "review" })]);
    expect(connections[0].options.env.OPENCODE_DB).toBe(":memory:");
    expect(connections[0].disposed).toBe(true);

    const session = await adapter.createSession({ model: "openai/gpt-5", effort: "low", mode: "build" });
    expect(session).toMatchObject({ providerSessionId: "session-1", model: "openai/gpt-5", effort: "low", mode: "build" });
    const runtimeConnection = connections[1];
    expect(runtimeConnection.request).toHaveBeenCalledWith("session/set_config_option", {
      configId: "thought",
      sessionId: "session-1",
      type: "select",
      value: "low",
    }, { timeoutMs: 30_000 });
    const { turnId } = await adapter.startTurn({
      prompt: "Fix it",
      model: "openai/gpt-5",
      effort: "low",
      mode: "build",
      contextReferences: [{ path: "/workspace/src/app.ts", name: "app.ts" }],
    });
    await vi.waitFor(() => expect(runtimeConnection.request).toHaveBeenCalledWith(
      "session/prompt",
      expect.objectContaining({
        sessionId: "session-1",
        prompt: [
          expect.objectContaining({ type: "text", text: expect.stringContaining("Keep tests green") }),
          expect.objectContaining({ type: "resource_link", name: "app.ts" }),
        ],
      }),
      { timeoutMs: 0 },
    ));
    const promptRequest = runtimeConnection.request.mock.calls.find(([method]) => method === "session/prompt")[1];

    runtimeConnection.sendUpdate({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-1",
      content: { type: "text", text: "Inspecting" },
    });
    runtimeConnection.sendUpdate({
      sessionUpdate: "agent_message_chunk",
      messageId: "answer-1",
      content: { type: "text", text: "Done" },
    });
    runtimeConnection.sendRequest(10, "session/request_permission", {
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1", kind: "execute", title: "Run tests", rawInput: { command: "npm test" } },
      options: [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Allow for session" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ],
    });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "approval.requested",
      turnId,
      payload: expect.objectContaining({ command: "npm test" }),
    })));
    const approval = onEvent.mock.calls.map(([event]) => event).find((event) => event.type === "approval.requested");
    adapter.resolveApproval({ requestId: approval.payload.requestId, decision: "acceptForSession", turnId });
    await vi.waitFor(() => expect(runtimeConnection.respond).toHaveBeenCalledWith(10, {
      outcome: { outcome: "selected", optionId: "always" },
    }));

    runtimeConnection.finishPrompt({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId })));
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(expect.arrayContaining([
      "reasoning.summary.delta",
      "assistant.delta",
      "assistant.completed",
      "approval.requested",
      "usage.updated",
      "turn.completed",
    ]));

    await adapter.startTurn({ prompt: "Follow up", model: "openai/gpt-5", effort: "low", mode: "build" });
    expect(connections).toHaveLength(2);
    expect(runtimeConnection.request.mock.calls.filter(([method]) => method === "session/new")).toHaveLength(1);
    expect(await adapter.readHistory()).toEqual([]);
    runtimeConnection.finishPrompt({ stopReason: "end_turn" });
    await adapter.dispose();
  });

});

class FakeAcpConnection extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.closed = false;
    this.disposed = false;
    this.prompt = deferred();
    this.request = vi.fn(async (method, params) => {
      if (method === "initialize") {
        return {
          agentInfo: { name: "OpenCode", version: "1.17.18" },
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: true } },
        };
      }
      if (method === "session/new" || method === "session/load") {
        queueMicrotask(() => this.sendUpdate({
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "/review", description: "Review changes", input: { hint: "[path]" } }],
        }));
        return { sessionId: "session-1", configOptions: sessionConfig() };
      }
      if (method === "session/prompt") return this.prompt.promise;
      if (method === "session/set_config_option") return { configOptions: updateConfig(params.configId, params.value) };
      if (method === "session/set_mode") return {};
      throw new Error(`Unexpected ACP request: ${method}`);
    });
    this.notify = vi.fn();
    this.respond = vi.fn();
    this.respondError = vi.fn();
  }

  sendUpdate(update) {
    this.emit("notification", { method: "session/update", params: { sessionId: "session-1", update } });
  }

  sendRequest(id, method, params) {
    this.emit("request", { id, method, params });
  }

  finishPrompt(value) {
    this.prompt.resolve(value);
    this.prompt = deferred();
  }

  dispose(reason, { expected = true } = {}) {
    void reason;
    this.closed = true;
    this.disposed = true;
    this.emit("exit", { expected, code: null, signal: "SIGTERM" });
  }
}

function readiness(overrides = {}) {
  return {
    status: "ready",
    executablePath: "/tools/opencode",
    environment: { PATH: "/usr/bin", HOME: "/home/test" },
    version: "1.17.18",
    source: "user-installed",
    ...overrides,
  };
}

function sessionConfig() {
  return [
    select("model", "model", "openai/gpt-5", [
      { value: "openai/gpt-5", name: "GPT-5" },
      { value: "openai/gpt-4.1", name: "GPT-4.1" },
    ]),
    select("mode", "mode", "build", [{ value: "build", name: "Build" }, { value: "plan", name: "Plan" }]),
    select("thought", "thought_level", "high", [{ value: "low" }, { value: "high" }]),
  ];
}

function updateConfig(configId, value) {
  return sessionConfig().map((entry) => entry.id === configId ? { ...entry, currentValue: value } : entry);
}

function select(id, category, currentValue, options) {
  return { id, category, type: "select", currentValue, options };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
