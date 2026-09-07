import { describe, expect, it, vi } from "vitest";
import {
  ClaudeAgentSdkAdapter,
  formatClaudePrompt,
} from "../electron/main/agent/runtimes/claude/claude-agent-sdk-adapter.mjs";
import { AgentProviderSessionUnavailableError } from "../electron/main/agent/runtime/agent-runtime-port.mjs";

describe("Claude Agent SDK runtime adapter", () => {
  it("keeps an unexpected SDK stream failure distinct from a native terminal result", async () => {
    const controller = persistentQueryController();
    const sdk = { query: vi.fn((request) => controller.connect(request.prompt, request.options)) };
    const onEvent = vi.fn(), onExit = vi.fn();
    const adapter = createAdapter({ sdk, onEvent, onExit });
    const created = await adapter.createSession();
    expect(created.providerSessionId).toMatch(/^[a-f0-9-]{36}$/);
    await adapter.startTurn({ prompt: "Hello" });
    expect(sdk.query.mock.calls[0][0].options.sessionId).toBe(created.providerSessionId);
    await vi.waitFor(() => expect(controller.messages).toHaveLength(1));
    controller.fail(new Error("Stream disconnected"));
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ expected: false })));
    expect(onEvent.mock.calls.some(([event]) => ["turn.failed", "turn.interrupted", "turn.completed"].includes(event.type))).toBe(false);
    await adapter.dispose();
  });

  it("discovers workspace sessions through the native SDK metadata API", async () => {
    const sdk = {
      query: vi.fn(),
      listSessions: vi.fn(async () => [{
        sessionId: "claude-native",
        summary: "Review auth",
        customTitle: "Auth review",
        createdAt: 1_788_000_000_000,
        lastModified: 1_788_000_100_000,
        cwd: "/workspace",
      }]),
    };
    const adapter = createAdapter({ sdk });

    await expect(adapter.discoverSessions({ cursor: "20", limit: 20 })).resolves.toEqual({
      supported: true,
      coverage: { scopeComplete: false, snapshotId: null },
      sessions: [expect.objectContaining({ providerSessionId: "claude-native", title: "Auth review" })],
      nextCursor: null,
    });
    expect(sdk.listSessions).toHaveBeenCalledWith({ dir: "/workspace", limit: 20, offset: 20 });
    await adapter.dispose();
  });

  it("maps only authorized live workspace references into the native prompt", () => {
    expect(formatClaudePrompt("Review", [
      { kind: "workspace-entry", path: "/workspace/src/app.ts" },
      { kind: "workspace-entry", path: "/workspace/src" },
      { kind: "staged-attachment", path: "/private/staging/image.snapshot" },
      { kind: "workspace-entry", path: "/outside/secret.txt" },
    ], "/workspace")).toBe([
      "Review",
      "",
      "Authorized context files for this turn:",
      "- /workspace/src/app.ts",
      "- /workspace/src",
    ].join("\n"));
  });

  it("inspects the native account/model catalog with user-only settings and the Claude Code prompt", async () => {
    const query = inspectionQuery();
    const sdk = { query: vi.fn(() => query) };
    const adapter = createAdapter({ sdk });

    const inspection = await adapter.inspect();

    expect(inspection.account).toMatchObject({
      account: { type: "firstParty", email: "user@example.test", planType: "api" },
      requiresRuntimeSetup: false,
    });
    expect(inspection.models[0]).toMatchObject({ model: "claude-sonnet", variants: ["low", "high"] });
    expect(inspection.capabilities).toMatchObject({
      manualApprovals: true,
      structuredQuestions: true,
      fork: true,
      revision: "claude-agent-sdk:0.3.159:claude-code:2.1.0",
      protocol: { name: "claude-agent-sdk", version: "0.3.159", agentVersion: "2.1.0" },
    });
    const options = sdk.query.mock.calls[0][0].options;
    expect(options.settingSources).toEqual(["user"]);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(options.permissionMode).toBe("default");
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(query.close).toHaveBeenCalled();
    await adapter.dispose();
  });

  it("does not route third-party product traffic through Claude subscription OAuth", async () => {
    const query = inspectionQuery({
      email: "subscriber@example.test",
      subscriptionType: "pro",
      apiProvider: "firstParty",
      tokenSource: "oauth",
    });
    const adapter = createAdapter({
      sdk: { query: vi.fn(() => query) },
      environment: { PATH: "/usr/bin", HOME: "/home/test" },
    });

    const inspection = await adapter.inspect();

    expect(inspection.account).toMatchObject({
      account: null,
      requiresRuntimeSetup: true,
      error: expect.stringContaining("subscription OAuth cannot be used"),
    });
    await adapter.dispose();
  });

  it("classifies a missing native conversation as an unavailable saved session", async () => {
    const adapter = createAdapter({
      sdk: { query: vi.fn(), getSessionInfo: vi.fn(async () => null) },
    });

    await expect(adapter.resumeSession({ threadId: "claude-stale" }))
      .rejects.toBeInstanceOf(AgentProviderSessionUnavailableError);
    await adapter.dispose();
  });

  it("keeps one native SDK query alive across follow-up turns", async () => {
    const controller = persistentQueryController();
    const inspection = inspectionQuery();
    const sdk = {
      query: vi.fn((request) => sdk.query.mock.calls.length === 1
        ? inspection
        : controller.connect(request.prompt, request.options)),
    };
    const onEvent = vi.fn();
    const adapter = createAdapter({ sdk, onEvent });
    await adapter.inspect();
    await adapter.createSession({ model: "claude-sonnet", effort: "high", mode: "agent" });

    await expect(adapter.startTurn({
      prompt: "Unsafe",
      contextReferences: [{ kind: "workspace-entry", path: "/outside/secret.txt" }],
    })).rejects.toThrow(/unsupported|unauthorized/i);
    await expect(adapter.startTurn({
      prompt: "Unsupported",
      attachments: [{ kind: "staged-attachment", path: "/private/staging/image.snapshot" }],
    })).rejects.toThrow(/unsupported|unauthorized/i);

    const first = await adapter.startTurn({
      prompt: "First",
      model: "claude-sonnet",
      effort: "high",
      mode: "agent",
      contextReferences: [{ path: "/workspace/src/app.ts" }],
    });
    await vi.waitFor(() => expect(controller.messages).toHaveLength(1));
    controller.finish("First answer");
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId: first.turnId })));

    const second = await adapter.startTurn({ prompt: "Second", model: "claude-sonnet", effort: "high", mode: "agent" });
    await vi.waitFor(() => expect(controller.messages).toHaveLength(2));
    controller.finish("Second answer");
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId: second.turnId })));

    expect(sdk.query).toHaveBeenCalledTimes(2);
    expect(sdk.query.mock.calls[1][0].options.effort).toBe("high");
    expect(controller.query.initializationResult).toHaveBeenCalledTimes(1);
    expect(controller.query.setModel).toHaveBeenCalledWith("claude-sonnet");
    expect(controller.messages[0].message.content).toContain("/workspace/src/app.ts");
    expect(controller.messages[1].message.content).toBe("Second");
    await adapter.dispose();
  });

  it("restarts the native query when authorized project instructions change without changing size", async () => {
    const controllers = [persistentQueryController(), persistentQueryController()];
    const sdk = { query: vi.fn((request) => controllers[sdk.query.mock.calls.length - 1].connect(request.prompt, request.options)) };
    let instructions = { source: "AGENTS.md", text: "alpha", bytes: 5 };
    const onEvent = vi.fn();
    const adapter = createAdapter({
      sdk,
      onEvent,
      projectInstructionLoader: vi.fn(async () => instructions),
    });
    await adapter.createSession({ model: "claude-sonnet", mode: "agent" });

    const first = await adapter.startTurn({ prompt: "First", model: "claude-sonnet", mode: "agent" });
    await vi.waitFor(() => expect(controllers[0].messages).toHaveLength(1));
    controllers[0].finish("First answer");
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId: first.turnId })));

    instructions = { source: "AGENTS.md", text: "bravo", bytes: 5 };
    const second = await adapter.startTurn({ prompt: "Second", model: "claude-sonnet", mode: "agent" });
    await vi.waitFor(() => expect(controllers[1].messages).toHaveLength(1));
    expect(sdk.query).toHaveBeenCalledTimes(2);
    expect(sdk.query.mock.calls[0][0].options.systemPrompt.append).toContain("alpha");
    expect(sdk.query.mock.calls[1][0].options.systemPrompt.append).toContain("bravo");
    controllers[1].finish("Second answer");
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId: second.turnId })));
    await adapter.dispose();
  });

  it("correlates native approvals and structured questions without persisting permission changes", async () => {
    const controller = persistentQueryController();
    const sdk = { query: vi.fn((request) => controller.connect(request.prompt, request.options)) };
    const onEvent = vi.fn();
    const adapter = createAdapter({ sdk, onEvent });
    await adapter.createSession({ model: "claude-sonnet", mode: "agent" });
    const { turnId } = await adapter.startTurn({ prompt: "Fix it", model: "claude-sonnet", mode: "agent" });
    await vi.waitFor(() => expect(controller.messages).toHaveLength(1));

    const options = sdk.query.mock.calls[0][0].options;
    const approval = options.canUseTool("Bash", { command: "npm test" }, {
      toolUseID: "tool-1",
      title: "Allow command",
      suggestions: [
        { type: "addRules", destination: "session", rules: [], behavior: "allow" },
        { type: "addRules", destination: "localSettings", rules: [], behavior: "allow" },
      ],
    });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "approval.requested" })));
    const approvalEvent = onEvent.mock.calls.map(([event]) => event).find((event) => event.type === "approval.requested");
    adapter.resolveApproval({ requestId: approvalEvent.payload.requestId, decision: "acceptForSession", turnId });
    await expect(approval).resolves.toMatchObject({
      behavior: "allow",
      updatedPermissions: [{ destination: "session" }],
    });

    const question = options.canUseTool("AskUserQuestion", {
      questions: [{ header: "Choice", question: "Continue?", multiSelect: false, options: [{ label: "Yes" }] }],
    }, { toolUseID: "question-1" });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "question.requested" })));
    const questionEvent = onEvent.mock.calls.map(([event]) => event).find((event) => event.type === "question.requested");
    adapter.resolveQuestion({ requestId: questionEvent.payload.requestId, answers: [["Yes"]], rejected: false, turnId });
    await expect(question).resolves.toEqual({
      behavior: "allow",
      updatedInput: expect.objectContaining({ answers: { "Continue?": "Yes" } }),
    });

    controller.finish("Done");
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed", turnId })));
    await adapter.dispose();
  });
});

function createAdapter({
  sdk,
  onEvent = vi.fn(),
  onExit = vi.fn(),
  environment = { PATH: "/usr/bin", HOME: "/home/test", ANTHROPIC_API_KEY: "test-key" },
  projectInstructionLoader = vi.fn(async () => []),
}) {
  return new ClaudeAgentSdkAdapter({
    readiness: {
      status: "ready",
      source: "user-installed",
      version: "2.1.0",
      executablePath: "/tools/claude",
      environment,
    },
    workspaceRoot: "/workspace",
    appVersion: "1.2.3",
    sdkLoader: vi.fn(async () => sdk),
    onEvent,
    onExit,
    projectInstructionLoader,
    spawnClaudeCodeProcess: vi.fn(),
  });
}

function inspectionQuery(account = {
  email: "user@example.test",
  subscriptionType: "api",
  apiProvider: "firstParty",
  apiKeySource: "environment",
}) {
  return {
    initializationResult: vi.fn(async () => ({
      account,
      models: [{ value: "claude-sonnet", displayName: "Sonnet", description: "Fast", supportedEffortLevels: ["low", "high"] }],
      commands: [{ name: "review", description: "Review changes", argumentHint: "" }],
    })),
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {},
  };
}

function persistentQueryController() {
  let input = null;
  let nativeId = null;
  let turnGate = null;
  const messages = [];
  const query = {
    initializationResult: vi.fn(async () => ({ models: [], commands: [], account: {} })),
    setModel: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield { type: "system", subtype: "init", session_id: nativeId, model: "claude-sonnet", permissionMode: "default" };
      for await (const message of input) {
        messages.push(message);
        const completion = deferred();
        turnGate = completion;
        const text = await completion.promise;
        yield {
          type: "stream_event",
          session_id: nativeId,
          uuid: `assistant-${messages.length}`,
          event: { type: "content_block_delta", delta: { type: "text_delta", text } },
        };
        yield {
          type: "assistant",
          session_id: nativeId,
          uuid: `assistant-${messages.length}`,
          message: { content: [{ type: "text", text }] },
        };
        yield { type: "result", subtype: "success", session_id: nativeId, usage: {}, num_turns: 1 };
      }
    },
  };
  return {
    query,
    messages,
    connect(channel, options) {
      input = channel;
      nativeId = options.resume ?? options.sessionId;
      return query;
    },
    fail(error) { turnGate.reject(error); turnGate = null; },
    finish(text) {
      if (!turnGate) throw new Error("No Claude turn is waiting for completion.");
      const gate = turnGate;
      turnGate = null;
      gate.resolve(text);
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
