import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  JsonlRpcConnection,
  JsonlRpcErrorResponse,
} from "../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";

describe("Codex JSONL JSON-RPC transport", () => {
  it("rejects non-canonical process launch inputs before spawning", () => {
    const spawn = vi.fn();
    expect(() => new JsonlRpcConnection({
      executablePath: "codex",
      args: [],
      cwd: "/workspace",
      env: {},
      spawn,
    })).toThrow("absolute JSONL-RPC executable");
    expect(() => new JsonlRpcConnection({
      executablePath: "/usr/local/bin/codex",
      args: ["app-server\n--unsafe"],
      cwd: "/workspace",
      env: {},
      spawn,
    })).toThrow("arguments are invalid");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("correlates responses while tolerating additive unknown fields", async () => {
    const child = createChild();
    const connection = createConnection(child);
    const request = connection.request("account/read", { refreshToken: false });
    expect(JSON.parse(child.writes[0])).toMatchObject({ jsonrpc: "2.0", id: 1, method: "account/read" });
    child.stdout.write(`${JSON.stringify({ id: 1, result: { account: null }, future: "ignored" })}\n`);
    await expect(request).resolves.toEqual({ account: null });
    connection.dispose();
  });

  it("preserves JSON-RPC error codes for protocol fallback decisions", async () => {
    const child = createChild();
    const connection = createConnection(child);
    const request = connection.request("session/new", {});
    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } })}\n`);

    await expect(request).rejects.toBeInstanceOf(JsonlRpcErrorResponse);
    await expect(request).rejects.toMatchObject({ method: "session/new", code: -32601 });
    connection.dispose();
  });

  it("separates notifications and server requests", () => {
    const child = createChild();
    const connection = createConnection(child);
    const notification = vi.fn();
    const request = vi.fn();
    connection.on("notification", notification);
    connection.on("request", request);
    child.stdout.write(`${JSON.stringify({ method: "turn/started", params: { extra: true } })}\n`);
    child.stdout.write(`${JSON.stringify({ method: "item/fileChange/requestApproval", id: "approval-1", params: {} })}\n`);
    expect(notification).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    connection.dispose();
  });

  it("terminates on malformed framing, oversized lines, and duplicate response ids", async () => {
    const malformedChild = createChild();
    const malformed = createConnection(malformedChild);
    const protocolError = vi.fn();
    malformed.on("protocolError", protocolError);
    malformedChild.stdout.write("not-json\n");
    expect(protocolError).toHaveBeenCalledOnce();
    expect(malformedChild.kill).toHaveBeenCalledOnce();

    const oversizedChild = createChild();
    const oversized = createConnection(oversizedChild, { maxLineBytes: 32 });
    oversizedChild.stdout.write("x".repeat(40));
    expect(oversizedChild.kill).toHaveBeenCalledOnce();

    const duplicateChild = createChild();
    const duplicate = createConnection(duplicateChild);
    const pending = duplicate.request("model/list", {});
    duplicateChild.stdout.write(`${JSON.stringify({ id: 1, result: { data: [] } })}\n`);
    await pending;
    duplicateChild.stdout.write(`${JSON.stringify({ id: 1, result: { data: [] } })}\n`);
    expect(duplicateChild.kill).toHaveBeenCalledOnce();
  });

  it("retires an ambiguous connection when a request times out", async () => {
    vi.useFakeTimers();
    try {
      const child = createChild();
      const connection = createConnection(child);
      const exit = vi.fn();
      connection.on("exit", exit);
      const pending = connection.request("turn/start", {}, { timeoutMs: 20 });
      const rejection = expect(pending).rejects.toMatchObject({
        code: "JSONL_RPC_TIMEOUT",
        method: "turn/start",
      });

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(child.kill).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(expect.objectContaining({ expected: false }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to a forced kill when the provider ignores graceful disposal", async () => {
    vi.useFakeTimers();
    try {
      const child = createChild();
      child.kill = vi.fn(() => true);
      const connection = createConnection(child, { forceKillTimeoutMs: 50 });
      connection.dispose();
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

      await vi.advanceTimersByTimeAsync(55);

      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createConnection(child, options = {}) {
  return new JsonlRpcConnection({
    executablePath: "/usr/local/bin/codex",
    args: ["app-server", "--listen", "stdio://"],
    cwd: "/workspace",
    env: {},
    spawn: () => child,
    ...options,
  });
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.writes = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      child.writes.push(String(chunk).trim());
      callback();
    },
  });
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
  });
  return child;
}
