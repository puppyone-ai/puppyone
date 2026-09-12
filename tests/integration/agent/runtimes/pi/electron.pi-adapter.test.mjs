import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { PiRpcAdapter } from "../../../../../electron/main/agent/runtimes/pi/pi-rpc-adapter.mjs";

describe("Pi native RuntimePort adapter", () => {
  it("does not invent a failed turn when native prompt delivery is unknown", async () => {
    const clients = [], events = [];
    const onExit = vi.fn();
    const adapter = createAdapter({ clients, events, onExit });
    await adapter.createSession();
    const request = clients[0].request.bind(clients[0]);
    clients[0].request = vi.fn((type, payload) => type === "prompt"
      ? Promise.reject(Object.assign(new Error("Pipe lost"), { deliveryOutcome: "unknown" }))
      : request(type, payload));
    await expect(adapter.startTurn({ prompt: "Hello" })).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    expect(events.some((event) => ["turn.failed", "turn.interrupted", "turn.completed"].includes(event.type))).toBe(false);
    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ expected: false }));
    await adapter.dispose();
  });

  it("owns inspection processes until OS exit, including shutdown during inspection", async () => {
    const clients = [];
    const adapter = createAdapter({ clients });
    const inspection = adapter.inspect();
    const exited = Promise.withResolvers();
    clients[0].waitForExit = vi.fn(() => exited.promise);
    await vi.waitFor(() => expect(clients[0].closed).toBe(true));
    let disposed = false;
    const closing = adapter.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(adapter.hasActiveProcess()).toBe(true);
    exited.resolve();
    await Promise.all([inspection, closing]);
    expect(adapter.hasActiveProcess()).toBe(false);
  });

  it("reports persistence only from the exact native session artifact and includes its source", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-persistence-test-"));
    const clients = [], events = [];
    const report = vi.fn();
    const adapter = createAdapter({ clients, events, onSessionPersisted: report });
    try {
      await adapter.createSession();
      const file = path.join(directory, "session.jsonl");
      await fs.writeFile(file, "native fixture\n");
      clients[0].state.sessionFile = file;
      await adapter.startTurn({ prompt: "Hello" });
      clients[0].emit("event", { type: "agent_settled" });
      await vi.waitFor(() => expect(report).toHaveBeenCalledWith({
        providerSessionId: "pi-session", sourceScopeId: adapter.getSessionHistoryPort().sourceScopeId,
      }));
    } finally {
      await adapter.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("discovers Pi-owned providers, models, reasoning levels, and commands", async () => {
    const clients = [];
    const adapter = createAdapter({ clients });
    const inspection = await adapter.inspect();
    expect(clients[0].options.args).toEqual(["--no-session"]);
    expect(inspection.runtime).toMatchObject({ id: "pi", protocol: { kind: "rpc", transport: "stdio-jsonl" } });
    expect(inspection.providers).toEqual([
      expect.objectContaining({ id: "openai-codex", modelCount: 1, defaultModel: "openai-codex/gpt-5.6-sol" }),
    ]);
    expect(inspection.models).toEqual([
      expect.objectContaining({
        model: "openai-codex/gpt-5.6-sol",
        isDefault: true,
        variants: ["off", "low", "medium", "high", "xhigh"],
        defaultVariant: "high",
      }),
    ]);
    expect(inspection.commands).toEqual([expect.objectContaining({ name: "review", source: "extension" })]);
    expect(inspection.capabilities).toMatchObject({
      streamingText: true,
      modelSelection: true,
      structuredQuestions: true,
      protocol: { name: "pi-rpc", version: 1, agentVersion: "0.84.3" },
      referenceInputs: {
        attachments: { image: { accepted: true }, binary: { accepted: true } },
      },
    });
    expect(adapter.referenceMentionDelivery({ mime: "image/png" })).toBe("resource");
    expect(adapter.referenceMentionDelivery({ mime: "application/pdf" })).toBe("path");
    expect(clients[0].closed).toBe(true);
  });

  it("maps one native Pi session and its authoritative settled boundary into shared events", async () => {
    const clients = [];
    const events = [];
    const disposed = vi.fn();
    const adapter = createAdapter({ clients, events, onDispose: disposed });
    await expect(adapter.createSession({ model: "openai-codex/gpt-5.6-sol", effort: "high" })).resolves.toMatchObject({
      providerSessionId: "pi-session",
      model: "openai-codex/gpt-5.6-sol",
      effort: "high",
    });
    const client = clients[0];
    const turn = await adapter.startTurn({ prompt: "Inspect it" });
    client.emit("event", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Done" },
    });
    client.emit("event", {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "pwd" },
    });
    client.emit("event", {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "/workspace" }] },
      isError: false,
    });
    client.emit("event", {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    });
    expect(events.some((event) => event.type === "turn.completed")).toBe(false);
    client.emit("event", { type: "agent_settled" });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "turn.started", turnId: turn.turnId }),
      expect.objectContaining({ type: "assistant.delta", payload: { delta: "Done" } }),
      expect.objectContaining({ type: "tool.started", itemId: "tool-1" }),
      expect.objectContaining({ type: "tool.completed", itemId: "tool-1" }),
      expect.objectContaining({ type: "assistant.completed", payload: { text: "Done" } }),
      expect.objectContaining({ type: "turn.completed", payload: { status: "completed" } }),
    ]));
    expect(client.calls.find((call) => call.type === "prompt")?.payload).toEqual({ message: "Inspect it" });
    await adapter.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("routes Pi extension dialogs through the shared structured-question contract", async () => {
    const clients = [];
    const events = [];
    const adapter = createAdapter({ clients, events });
    await adapter.createSession();
    const turn = await adapter.startTurn({ prompt: "Ask me" });
    const client = clients[0];
    client.emit("event", {
      type: "extension_ui_request",
      id: "dialog-1",
      method: "select",
      title: "Pick a branch",
      options: ["main", "release"],
    });
    const question = events.find((event) => event.type === "question.requested");
    expect(question).toMatchObject({
      turnId: turn.turnId,
      payload: { questions: [{ question: "Pick a branch", options: [{ label: "main" }, { label: "release" }] }] },
    });
    await adapter.resolveQuestion({ requestId: question.payload.requestId, answers: [["release"]] });
    expect(client.extensionResponses).toContainEqual({
      type: "extension_ui_response",
      id: "dialog-1",
      value: "release",
    });
  });
});

function createAdapter({ clients, events = [], onDispose = () => {}, onExit = () => {}, onSessionPersisted = () => {} }) {
  return new PiRpcAdapter({
    readiness: {
      executablePath: "/usr/local/bin/pi",
      environment: {},
      version: "0.84.3",
      source: "user-installed",
      compatibility: "pi-rpc-v1",
    },
    workspaceRoot: "/workspace",
    onEvent: (event) => events.push(event),
    onDispose,
    onExit,
    onSessionPersisted,
    clientFactory: (options) => {
      const client = new FakePiClient(options);
      clients.push(client);
      return client;
    },
  });
}

class FakePiClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.closed = false;
    this.calls = [];
    this.extensionResponses = [];
    this.state = {
      sessionId: "pi-session",
      sessionName: "Pi test",
      model: { provider: "openai-codex", id: "gpt-5.6-sol" },
      thinkingLevel: "high",
    };
  }

  async request(type, payload = {}) {
    this.calls.push({ type, payload });
    if (type === "get_state") return structuredClone(this.state);
    if (type === "get_available_models") return { models: [{
      provider: "openai-codex",
      id: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      reasoning: true,
      contextWindow: 256_000,
      thinkingLevelMap: { xhigh: "xhigh" },
    }] };
    if (type === "get_commands") return { commands: [{ name: "review", description: "Review changes", source: "extension" }] };
    if (type === "get_available_thinking_levels") return { levels: ["off", "low", "medium", "high", "xhigh"] };
    if (type === "set_model") this.state.model = { provider: payload.provider, id: payload.modelId };
    if (type === "set_thinking_level") this.state.thinkingLevel = payload.level;
    if (type === "get_messages") return { messages: [] };
    return {};
  }

  respondExtensionUi(message) {
    this.extensionResponses.push(message);
  }

  getDiagnostics() { return ""; }

  dispose() { this.closed = true; }
}
