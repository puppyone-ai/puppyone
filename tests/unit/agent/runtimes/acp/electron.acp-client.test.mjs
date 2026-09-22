import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "../../../../../electron/main/agent/protocols/acp/acp-client.mjs";
import { acpResolveApproval } from "../../../../../electron/main/agent/protocols/acp/acp-interactions.mjs";
import { JsonlRpcErrorResponse } from "../../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";

describe("provider-neutral ACP client", () => {
  it("negotiates capabilities and caches legacy method-name fallback", async () => {
    const connection = new FakeConnection();
    connection.responses.set("initialize", {
      agentInfo: { name: "fixture", version: "1.0.0" },
      agentCapabilities: { loadSession: true },
      authMethods: [{ id: "token" }],
    });
    connection.responses.set("newSession", { sessionId: "session-1" });
    connection.failMethods.add("session/new");
    const client = new AcpClient({ connection });

    await expect(client.initialize()).resolves.toMatchObject({ agentInfo: { name: "fixture" } });
    await expect(client.newSession({ cwd: "/workspace" })).resolves.toEqual({ sessionId: "session-1" });
    await expect(client.newSession({ cwd: "/workspace" })).resolves.toEqual({ sessionId: "session-1" });

    expect(connection.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "session/new",
      "newSession",
      "newSession",
    ]);
    expect(client.agentCapabilities).toEqual({ loadSession: true });
    expect(client.authMethods).toEqual([{ id: "token" }]);
  });

  it("uses an unbounded prompt request and fans out cancel before negotiation", async () => {
    const connection = new FakeConnection();
    connection.responses.set("session/prompt", { stopReason: "end_turn" });
    const client = new AcpClient({ connection });

    await client.prompt({ sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] });
    client.cancel({ sessionId: "session-1" });

    expect(connection.request).toHaveBeenCalledWith("session/prompt", expect.any(Object), { timeoutMs: 0 });
    expect(connection.notify.mock.calls.map(([method]) => method)).toEqual(["session/cancel", "cancel"]);
  });

  it("uses the standard ACP model-selection method", async () => {
    const connection = new FakeConnection();
    connection.responses.set("session/set_model", {});
    const client = new AcpClient({ connection });

    await expect(client.setModel({ sessionId: "session-1", modelId: "provider:model" })).resolves.toEqual({});

    expect(connection.request).toHaveBeenCalledWith(
      "session/set_model",
      { sessionId: "session-1", modelId: "provider:model" },
      { timeoutMs: 30_000 },
    );
  });

  it("sends an explicitly registered provider extension without method fallback", async () => {
    const connection = new FakeConnection();
    connection.responses.set("_fixture/status", { ready: true });
    const client = new AcpClient({ connection });

    await expect(client.requestExtension("_fixture/status", {}, { timeoutMs: 1_250 }))
      .resolves.toEqual({ ready: true });

    expect(connection.request).toHaveBeenCalledWith("_fixture/status", {}, { timeoutMs: 1_250 });
    expect(() => client.requestExtension(" ")).toThrow("ACP extension method is required.");
  });

  it("correlates permission and workspace-file callbacks without exposing unknown methods", async () => {
    const connection = new FakeConnection();
    const delegate = {
      requestPermission: vi.fn(async () => ({ outcome: { outcome: "selected", optionId: "allow" } })),
      readTextFile: vi.fn(async () => ({ content: "hello" })),
      writeTextFile: vi.fn(async () => ({})),
    };
    const client = new AcpClient({ connection, delegate });

    connection.emit("request", { id: 1, method: "session/request_permission", params: { sessionId: "session-1" } });
    connection.emit("request", { id: 2, method: "fs/read_text_file", params: { path: "README.md" } });
    connection.emit("request", { id: 3, method: "fs/writeTextFile", params: { path: "README.md", content: "x" } });
    connection.emit("request", { id: 4, method: "terminal/create", params: {} });
    await vi.waitFor(() => expect(connection.respond.mock.calls).toHaveLength(3));

    expect(connection.respond).toHaveBeenCalledWith(1, { outcome: { outcome: "selected", optionId: "allow" } });
    expect(connection.respond).toHaveBeenCalledWith(2, { content: "hello" });
    expect(connection.respond).toHaveBeenCalledWith(3, {});
    expect(connection.respondError).toHaveBeenCalledWith(4, -32601, "ACP client method is not supported.");
    client.dispose();
  });

  it("preserves an advertised session-scoped permission option", () => {
    const resolve = vi.fn();
    const adapter = {
      activeTurn: { turnId: "turn-1" },
      pendingApprovals: new Map([["approval-1", {
        turnId: "turn-1",
        options: [
          { optionId: "allow_always", kind: "allow_always" },
          { optionId: "allow_session", kind: "allow_always" },
        ],
        resolve,
      }]]),
      runtimeDescriptor: { displayName: "fixture" },
    };

    acpResolveApproval(adapter, {
      requestId: "approval-1",
      decision: "acceptForSession",
      turnId: "turn-1",
    });

    expect(resolve).toHaveBeenCalledWith({
      outcome: { outcome: "selected", optionId: "allow_session" },
    });
  });

  it("retires the connection when an asynchronous session callback fails", async () => {
    const connection = new FakeConnection();
    const client = new AcpClient({
      connection,
      delegate: { onSessionUpdate: vi.fn(async () => { throw new Error("callback failed with sk-1234567890123456"); }) },
    });

    connection.emit("notification", {
      method: "session/update",
      params: { sessionId: "session-1", update: { sessionUpdate: "plan" } },
    });

    await vi.waitFor(() => expect(connection.dispose).toHaveBeenCalledWith(
      expect.stringContaining("ACP client callback failed"),
      { expected: false },
    ));
    expect(connection.dispose.mock.calls[0][0]).not.toContain("sk-1234567890123456");
    client.dispose();
  });
});

class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.responses = new Map();
    this.failMethods = new Set();
    this.request = vi.fn(async (method) => {
      if (this.failMethods.has(method)) throw new JsonlRpcErrorResponse(method, -32601, "not found");
      if (!this.responses.has(method)) throw new Error(`No fixture response for ${method}`);
      return this.responses.get(method);
    });
    this.notify = vi.fn();
    this.respond = vi.fn();
    this.respondError = vi.fn();
    this.dispose = vi.fn();
  }
}
