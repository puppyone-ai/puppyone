import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CursorAcpAdapter } from "../electron/main/agent/runtimes/cursor/cursor-acp-adapter.mjs";
import { discoverCursorBackend } from "../electron/main/agent/runtimes/cursor/cursor-discovery.mjs";

describe("Cursor ACP runtime", () => {
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
          text: { accepted: false },
        },
      },
    });
    expect(inspection.capabilities.revision).toBe("cursor-acp:1:image1:embedded0");

    await adapter.createSession({ mode: "agent" });
    const { turnId } = await adapter.startTurn({ prompt: "Fix it" });
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
    const adapter = new CursorAcpAdapter({
      readiness: { executablePath: "/tools/agent", environment: {}, version: "2026.08.1", source: "path-installation" },
      workspaceRoot: "/workspace",
      appVersion: "0.3.11",
      connectionFactory: () => connection,
      fileSystemFactory: () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }),
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
      expect.objectContaining({ type: "turn.started", payload: { prompt: "Fix tabs" } }),
      expect.objectContaining({ type: "assistant.completed", payload: { text: "Done" } }),
    ]));
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
