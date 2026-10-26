import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonlRpcConnection } from "../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";
import { PiRpcClient } from "../../../../electron/main/agent/protocols/pi-rpc/pi-rpc-client.mjs";

afterEach(() => vi.useRealTimers());

function fixture(kind) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  const writes = [];
  child.stdin = new Writable({ write(chunk, _encoding, done) { writes.push(JSON.parse(String(chunk))); done(); } });
  const Client = kind === "pi" ? PiRpcClient : JsonlRpcConnection;
  const client = new Client({ executablePath: "/fixture/agent", args: [], cwd: "/fixture", env: {},
    spawn: () => child, forceKillTimeoutMs: 0 });
  const reply = (index, data = { accepted: true }) => {
    const request = writes[index];
    child.stdout.write(JSON.stringify(kind === "pi"
      ? { type: "response", id: request.id, command: request.type, success: true, data }
      : { id: request.id, result: data }) + "\n");
  };
  return { child, client, writes, reply };
}

describe.each(["jsonrpc", "pi"])("%s request lifetime", kind => {
  it("keeps sibling requests and streaming alive while a slow read expires", async () => {
    vi.useFakeTimers();
    const { client, child, reply } = fixture(kind);
    const slow = expect(client.request("read", {}, { timeoutMs: 20 })).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    const sibling = client.request("state", {}, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(25);
    await slow;
    reply(1, { running: true });
    await expect(sibling).resolves.toEqual({ running: true });
    reply(0);
    expect(client.closed).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    client.dispose();
  });

  it("delivers a late mutation receipt once without resending the mutation", async () => {
    vi.useFakeTimers();
    const { client, child, reply, writes } = fixture(kind);
    const receipt = vi.fn();
    const pending = expect(client.request("prompt", {}, { timeoutMs: 20, onLateResponse: receipt }))
      .rejects.toMatchObject({ deliveryOutcome: "unknown" });
    await vi.advanceTimersByTimeAsync(21);
    await pending;
    reply(0);
    expect(receipt).toHaveBeenCalledExactlyOnceWith(null, { accepted: true });
    expect(writes).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();
    client.dispose();
  });

  it("cancels only the caller's wait and ignores its eventual reply", async () => {
    const { client, child, reply, writes } = fixture(kind);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(client.request("read", {}, { signal: cancelled.signal })).rejects.toThrow();
    expect(writes).toHaveLength(0);
    const controller = new AbortController();
    const pending = client.request("prompt", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    reply(0);
    expect(client.pending.size).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
    client.dispose();
  });

  it("bounds retained receipts without mistaking an old reply for protocol corruption", async () => {
    vi.useFakeTimers();
    const { client, child, reply } = fixture(kind);
    for (let index = 0; index < 520; index++) {
      const controller = new AbortController();
      const pending = client.request("read", {}, { signal: controller.signal }).catch(() => {});
      controller.abort();
      await pending;
    }
    expect(client.requests.late.size).toBe(512);
    reply(0);
    expect(child.kill).not.toHaveBeenCalled();
    const next = client.request("state");
    reply(520);
    await next;
    client.dispose();
    expect(client.requests.late.size).toBe(0);
  });

  it("still rejects every pending request on actual process exit", async () => {
    const { client, child } = fixture(kind);
    const pending = client.request("prompt");
    child.emit("close", 1, null);
    await expect(pending).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    expect(client.closed).toBe(true);
    expect(client.pending.size).toBe(0);
  });
});
