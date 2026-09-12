import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  PiRpcClient,
  PiRpcErrorResponse,
} from "../../../../../electron/main/agent/runtimes/pi/pi-rpc-client.mjs";

describe("Pi official RPC transport", () => {
  it("launches the official JSONL mode and correlates command responses without JSON-RPC fields", async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const client = createClient({ spawn });
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/pi",
      ["--mode", "rpc", "--no-approve", "--no-session"],
      expect.objectContaining({ cwd: "/workspace", shell: false }),
    );

    const pending = client.request("get_state");
    const command = JSON.parse(child.writes[0]);
    expect(command).toEqual({ id: "puppyone-1", type: "get_state" });
    expect(command).not.toHaveProperty("jsonrpc");
    child.stdout.write(`${JSON.stringify({
      type: "response",
      id: command.id,
      command: "get_state",
      success: true,
      data: { sessionId: "pi-session" },
    })}\n`);
    await expect(pending).resolves.toEqual({ sessionId: "pi-session" });
    client.dispose();
  });

  it("keeps asynchronous Pi events separate from command responses", () => {
    const child = createChild();
    const client = createClient({ spawn: () => child });
    const event = vi.fn();
    client.on("event", event);
    child.stdout.write(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi" } })}\n`);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ type: "message_update" }));
    client.dispose();
  });

  it("preserves native failures and retires malformed, oversized, and mismatched streams", async () => {
    const errorChild = createChild();
    const errorClient = createClient({ spawn: () => errorChild });
    const rejected = errorClient.request("set_model", { provider: "openai", modelId: "missing" });
    errorChild.stdout.write(`${JSON.stringify({
      type: "response",
      id: "puppyone-1",
      command: "set_model",
      success: false,
      error: "model unavailable",
    })}\n`);
    await expect(rejected).rejects.toBeInstanceOf(PiRpcErrorResponse);
    await expect(rejected).rejects.toMatchObject({ command: "set_model" });
    errorClient.dispose();

    const malformedChild = createChild();
    const malformedClient = createClient({ spawn: () => malformedChild });
    malformedChild.stdout.write("not-json\n");
    expect(malformedChild.kill).toHaveBeenCalledWith("SIGTERM");

    const oversizedChild = createChild();
    const oversizedClient = createClient({ spawn: () => oversizedChild, maxLineBytes: 32 });
    oversizedChild.stdout.write("x".repeat(40));
    expect(oversizedChild.kill).toHaveBeenCalledWith("SIGTERM");

    const mismatchChild = createChild();
    const mismatchClient = createClient({ spawn: () => mismatchChild });
    const mismatch = mismatchClient.request("get_state");
    mismatchChild.stdout.write(`${JSON.stringify({
      type: "response",
      id: "puppyone-1",
      command: "get_messages",
      success: true,
      data: {},
    })}\n`);
    await expect(mismatch).rejects.toThrow(/did not match/i);
    expect(mismatchChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("retires a process after an ambiguous request timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = createChild();
      const client = createClient({ spawn: () => child });
      const pending = client.request("prompt", { message: "hello" }, { timeoutMs: 20 });
      const rejection = expect(pending).rejects.toMatchObject({ code: "PI_RPC_TIMEOUT", command: "prompt" });
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createClient(options = {}) {
  return new PiRpcClient({
    executablePath: "/usr/local/bin/pi",
    args: ["--no-session"],
    cwd: "/workspace",
    env: {},
    forceKillTimeoutMs: 0,
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
  child.kill = vi.fn(() => true);
  return child;
}
