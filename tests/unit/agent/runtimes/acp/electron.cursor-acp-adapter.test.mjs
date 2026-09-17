import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CursorAcpAdapter } from "../../../../../electron/main/agent/runtimes/cursor/cursor-acp-adapter.mjs";
import { discoverCursorBackend } from "../../../../../electron/main/agent/runtimes/cursor/cursor-discovery.mjs";

describe("Cursor ACP runtime", () => {
  it("does not turn a lost ACP response into a native failed turn", async () => {
    const connection = new FakeCursorConnection();
    const onEvent = vi.fn(), onExit = vi.fn();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {} }, workspaceRoot: "/workspace", onEvent, onExit,
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: async () => ({ source: null, text: "", bytes: 0 }),
    });
    await adapter.createSession();
    await adapter.startTurn({ prompt: "Hello" });
    connection.prompt.reject(Object.assign(new Error("Pipe lost"), { deliveryOutcome: "unknown" }));
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ expected: false })));
    expect(onEvent.mock.calls.some(([event]) => ["turn.failed", "turn.interrupted", "turn.completed"].includes(event.type))).toBe(false);
    await adapter.dispose();
  });

  it("preserves native completion while classifying Cursor's terminal HTTP/2 cancellation as degraded", async () => {
    const connection = new FakeCursorConnection();
    const onEvent = vi.fn();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1" },
      workspaceRoot: "/workspace",
      onEvent,
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: async () => ({ source: null, text: "", bytes: 0 }),
    });
    await adapter.createSession();
    const { turnId } = await adapter.startTurn({ prompt: "Finish the work" });
    connection.sendUpdate({
      sessionUpdate: "agent_message_chunk",
      messageId: "terminal-error",
      content: { type: "text", text: "Error: RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8)" },
    });
    connection.finishPrompt({ stopReason: "end_turn" });

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "turn.completed",
      turnId,
      payload: expect.objectContaining({
        status: "completed",
        completionQuality: "degraded",
        failureScope: "upstream-request",
        failureCode: "CURSOR_HTTP2_STREAM_CANCEL",
        retryable: true,
        transportHealth: "healthy",
        sideEffects: "none",
      }),
    })));
    expect(onEvent.mock.calls.some(([event]) => event.type === "turn.failed")).toBe(false);
    await adapter.dispose();
  });

  it("classifies the structured Cursor child-task error without treating similar prose as a failure", async () => {
    const connection = new FakeCursorConnection();
    const onEvent = vi.fn();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1" },
      workspaceRoot: "/workspace",
      onEvent,
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: async () => ({ source: null, text: "", bytes: 0 }),
    });
    await adapter.createSession();
    await adapter.startTurn({ prompt: "Continue" });
    connection.sendUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "child-task",
      kind: "task",
      title: "Agent task",
      status: "completed",
      rawOutput: {
        providerOptions: { cursor: { highLevelToolCallResult: { output: {
          error: { error: "[canceled] http/2 stream closed with error code CANCEL (0x8)" },
        } } } },
      },
    });
    connection.sendUpdate({
      sessionUpdate: "agent_message_chunk",
      messageId: "summary",
      content: { type: "text", text: "The log mentions Error: RetriableError, but this sentence is not the terminal signature." },
    });
    connection.finishPrompt({ stopReason: "end_turn" });
    await vi.waitFor(() => expect(onEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "turn.completed")?.payload).toMatchObject({
        completionQuality: "degraded",
        failureScope: "child-task",
        sideEffects: "possible",
      }));
    await adapter.dispose();
  });

  it("does not classify explanatory text that merely mentions a Cursor retry error", async () => {
    const connection = new FakeCursorConnection();
    const onEvent = vi.fn();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1" },
      workspaceRoot: "/workspace",
      onEvent,
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: async () => ({ source: null, text: "", bytes: 0 }),
    });
    await adapter.createSession();
    await adapter.startTurn({ prompt: "Explain" });
    connection.sendUpdate({
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: "I handled Error: RetriableError: [canceled] http/2 stream closed with error code CANCEL (0x8) and finished." },
    });
    connection.finishPrompt({ stopReason: "end_turn" });
    await vi.waitFor(() => expect(onEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === "turn.completed")?.payload).not.toHaveProperty("completionQuality"));
    await adapter.dispose();
  });

  it("classifies a detected signed-in Cursor CLI as an ACP-ready Agent", async () => {
    const readiness = await discoverCursorBackend({
      resolveCandidate: async () => ({ executablePath: "/tools/agent", argsPrefix: [], source: "path-installation" }),
      probe: async () => ({ installation: "detected", version: "2026.08.1", authentication: "signed-in", source: "path-installation" }),
    });
    expect(readiness).toMatchObject({
      status: "ready",
      code: "READY",
      executablePath: "/tools/agent",
      compatibility: "acp-v1",
      selectable: true,
    });
  });

  it.each([
    ["signed-out", "installed-not-authenticated", "AUTHENTICATION_REQUIRED"],
    ["expired", "installed-not-authenticated", "AUTHENTICATION_EXPIRED"],
    ["error", "error", "AUTHENTICATION_PROBE_FAILED"],
    ["unknown", "error", "AUTHENTICATION_STATUS_UNKNOWN"],
  ])("keeps Cursor authentication state %s distinct", async (authentication, status, code) => {
    const readiness = await discoverCursorBackend({
      resolveCandidate: async () => ({ executablePath: "/tools/agent", argsPrefix: [], source: "path-installation" }),
      probe: async () => ({
        installation: "detected",
        version: "2026.08.1",
        authentication,
        authenticationDiagnostic: authentication === "error" ? "Cursor status probe ended with exit code 139." : undefined,
        source: "path-installation",
      }),
    });
    expect(readiness).toMatchObject({ status, code, selectable: false });
    if (["error", "unknown"].includes(authentication)) {
      expect(readiness.inspectionFallback).toBe("runtime-handshake");
    } else {
      expect(readiness).not.toHaveProperty("inspectionFallback");
    }
  });

  it.each([
    ["crashed", "AUTHENTICATION_PROBE_CRASHED"],
    ["timed-out", "AUTHENTICATION_PROBE_TIMED_OUT"],
  ])("preserves the Cursor authentication probe failure mode %s", async (authenticationFailure, code) => {
    const readiness = await discoverCursorBackend({
      resolveCandidate: async () => ({ executablePath: "/tools/agent", argsPrefix: [], source: "path-installation" }),
      probe: async () => ({
        installation: "detected",
        version: "2026.08.1",
        authentication: "error",
        authenticationFailure,
        authenticationDiagnostic: "bounded probe diagnostic",
        source: "path-installation",
      }),
    });
    expect(readiness).toMatchObject({ status: "error", code, inspectionFallback: "runtime-handshake" });
  });

  it("uses agent acp with Cursor login, permissions, questions and streaming", async () => {
    const onEvent = vi.fn();
    const connection = new FakeCursorConnection();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      appVersion: "0.3.11",
      onEvent,
      connectionFactory: (options) => {
        connection.options = options;
        return connection;
      },
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    const inspection = await adapter.inspect();
    expect(connection.options.args).toEqual(["acp"]);
    expect(connection.request).toHaveBeenCalledWith("authenticate", { methodId: "cursor_login" }, expect.any(Object));
    expect(inspection.capabilities).toMatchObject({
      protocol: { name: "acp", version: 1 },
      manualApprovals: true,
      structuredQuestions: true,
      resume: true,
      referenceInputs: {
        attachments: {
          image: { accepted: true },
          text: { accepted: true },
          binary: { accepted: true },
        },
      },
    });
    expect(inspection.capabilities.revision).toBe("cursor-acp:1:image1:embedded0");

    await adapter.createSession({ mode: "agent" });
    const stagedPath = fileURLToPath(import.meta.url);
    const { turnId } = await adapter.startTurn({
      prompt: "Fix @cursor-notes.txt",
      references: [{
        kind: "staged-attachment",
        path: stagedPath,
        displayName: "cursor-notes.txt",
        mime: "text/plain",
        inlineMentioned: true,
        mentionDelivery: "resource",
      }],
    });
    await vi.waitFor(() => expect(connection.request).toHaveBeenCalledWith(
      "session/prompt",
      expect.objectContaining({
        prompt: [
          { type: "text", text: "Fix @cursor-notes.txt" },
          expect.objectContaining({
            type: "resource_link",
            uri: pathToFileURL(stagedPath).href,
            name: "cursor-notes.txt",
          }),
        ],
      }),
      { timeoutMs: 0 },
    ));
    connection.sendUpdate({ sessionUpdate: "agent_message_chunk", messageId: "answer", content: { type: "text", text: "Done" } });
    connection.sendRequest(11, "cursor/ask_question", {
      toolCallId: "question-tool",
      title: "Choose mode",
      questions: [{ id: "mode", prompt: "Mode?", options: [{ id: "agent", label: "Agent" }] }],
    });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "question.requested", turnId })));
    const question = onEvent.mock.calls.map(([event]) => event).find((event) => event.type === "question.requested");
    adapter.resolveQuestion({ requestId: question.payload.requestId, answers: [["agent"]], rejected: false, turnId });
    await vi.waitFor(() => expect(connection.respond).toHaveBeenCalledWith(11, expect.objectContaining({ outcome: "answered" })));
    connection.finishPrompt({ stopReason: "end_turn" });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.completed" })));
    await adapter.dispose();
  });

  it("bootstraps authentication, inspection and the live session on one ACP connection", async () => {
    const connections = [];
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      connectionFactory: (options) => {
        const connection = new FakeCursorConnection();
        connection.options = options;
        connections.push(connection);
        return connection;
      },
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    const result = await adapter.bootstrapSession({ kind: "create", mode: "agent" });

    expect(connections).toHaveLength(1);
    expect(result).toMatchObject({
      inspection: { account: { requiresRuntimeSetup: false } },
      providerSession: { providerSessionId: "cursor-session", mode: "agent" },
    });
    expect(connections[0].request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
    ]);
    await adapter.dispose();
  });

  it("discovers and hydrates native ACP sessions only when the runtime advertises the capabilities", async () => {
    const connection = new FakeCursorConnection({ list: true, replayHistory: true });
    const onEvent = vi.fn();
    const writeTextFile = vi.fn();
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      appVersion: "0.3.11",
      onEvent,
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    await expect(adapter.discoverSessions({ cursor: "opaque", limit: 20 })).resolves.toEqual({
      supported: true,
      coverage: { scopeComplete: false, snapshotId: null },
      sessions: [expect.objectContaining({ providerSessionId: "cursor-history", title: "Fix tabs" })],
      nextCursor: null,
    });
    await adapter.resumeSession({ threadId: "cursor-history" });
    await expect(adapter.readHistory()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "turn.started",
        payload: { prompt: "Fix tabs", restored: true, userMessageId: "user-1" },
      }),
      expect.objectContaining({ type: "assistant.completed", payload: { text: "Done" } }),
      expect.objectContaining({
        type: "tool.completed",
        itemId: "search-history",
        payload: expect.objectContaining({ kind: "search", input: { query: "tabs" }, outputPreview: "2 matches" }),
      }),
    ]));
    expect(connection.request.mock.calls.map(([method]) => method)).not.toContain("session/prompt");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === "approval.requested")).toBe(false);
    expect(connection.respond).toHaveBeenCalledWith(91, { outcome: { outcome: "cancelled" } });
    expect(connection.respondError).toHaveBeenCalledWith(
      92,
      -32603,
      expect.stringContaining("history is loading"),
    );
    await adapter.dispose();
  });

  it("classifies a stale Cursor ACP locator as unavailable", async () => {
    const connection = new FakeCursorConnection({ invalidLoad: true });
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      appVersion: "0.3.11",
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    await expect(adapter.resumeSession({ threadId: "cursor-stale" })).rejects.toMatchObject({
      code: "AGENT_PROVIDER_SESSION_UNAVAILABLE",
    });
    await adapter.dispose();
  });

  it("uses ACP session/resume when an Agent can reconnect but cannot replay history", async () => {
    const connection = new FakeCursorConnection({ loadSession: false });
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      appVersion: "0.3.11",
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
      projectInstructionLoader: vi.fn(async () => ({ source: null, text: "", bytes: 0 })),
    });

    await adapter.resumeSession({ threadId: "cursor-history" });
    expect(connection.request.mock.calls.map(([method]) => method)).toContain("session/resume");
    expect(connection.request.mock.calls.map(([method]) => method)).not.toContain("session/load");
    await expect(adapter.readHistory()).resolves.toEqual([]);
    await adapter.dispose();
  });
});

class FakeCursorConnection extends EventEmitter {
  constructor({ list = false, replayHistory = false, loadSession = true, invalidLoad = false } = {}) {
    super();
    this.closed = false;
    this.prompt = deferred();
    this.request = vi.fn(async (method) => {
      if (method === "initialize") return {
        protocolVersion: 1,
        agentInfo: { name: "Cursor", version: "2026.08.1" },
        agentCapabilities: {
          ...(loadSession ? { loadSession: true } : {}),
          sessionCapabilities: { resume: {}, ...(list ? { list: {} } : {}) },
          promptCapabilities: { image: true },
          _meta: { cursor: { askQuestion: 1 } },
        },
        authMethods: [{ id: "cursor_login" }],
      };
      if (method === "authenticate") return {};
      if (method === "session/list") return {
        sessions: [{ sessionId: "cursor-history", cwd: "/workspace", title: "Fix tabs", updatedAt: "2026-08-30T00:00:00.000Z" }],
      };
      if (method === "session/load" && invalidLoad) {
        throw Object.assign(new Error("session/load: Invalid params"), { code: -32602 });
      }
      if (method === "session/new" || method === "session/load" || method === "session/resume") {
        if (method === "session/load" && replayHistory) queueMicrotask(() => {
          this.sendUpdate({ sessionUpdate: "user_message_chunk", messageId: "user-1", content: { type: "text", text: "Fix " } }, "cursor-history");
          this.sendUpdate({ sessionUpdate: "user_message_chunk", messageId: "user-1", content: { type: "text", text: "tabs" } }, "cursor-history");
          this.sendUpdate({ sessionUpdate: "agent_message_chunk", messageId: "assistant-1", content: { type: "text", text: "Done" } }, "cursor-history");
          this.sendUpdate({
            sessionUpdate: "tool_call",
            toolCallId: "search-history",
            kind: "search",
            title: "Search workspace",
            status: "pending",
            rawInput: { query: "tabs" },
          }, "cursor-history");
          this.sendUpdate({
            sessionUpdate: "tool_call_update",
            toolCallId: "search-history",
            status: "completed",
            rawOutput: "2 matches",
          }, "cursor-history");
          this.sendRequest(91, "session/request_permission", {
            sessionId: "cursor-history",
            toolCall: { toolCallId: "historical-write", title: "Historical write", kind: "edit" },
            options: [{ optionId: "allow", kind: "allow_once" }],
          });
          this.sendRequest(92, "fs/write_text_file", {
            sessionId: "cursor-history",
            path: "README.md",
            content: "must not be written",
          });
        });
        return {
          sessionId: method === "session/new" ? "cursor-session" : "cursor-history",
          modes: { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent" }, { id: "plan", name: "Plan" }] },
        };
      }
      if (method === "session/prompt") return this.prompt.promise;
      if (method === "session/set_mode") return {};
      throw new Error(`Unexpected Cursor ACP request: ${method}`);
    });
    this.notify = vi.fn();
    this.respond = vi.fn();
    this.respondError = vi.fn();
  }
  sendUpdate(update, sessionId = "cursor-session") { this.emit("notification", { method: "session/update", params: { sessionId, update } }); }
  sendRequest(id, method, params) { this.emit("request", { id, method, params }); }
  finishPrompt(result) { this.prompt.resolve(result); this.prompt = deferred(); }
  dispose(reason, { expected = true } = {}) { this.closed = true; this.emit("exit", { expected, reason }); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
