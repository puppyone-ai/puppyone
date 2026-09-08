import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { JsonlRpcConnection } from "../electron/main/agent/transports/jsonl-rpc-connection.mjs";
import { PiRpcClient } from "../electron/main/agent/runtimes/pi/pi-rpc-client.mjs";
import { runBoundedProcessProbe } from "../electron/main/agent/transports/bounded-process-probe.mjs";
import { AgentRuntimeRegistry } from "../electron/main/agent/runtime/agent-runtime-registry.mjs";
import { createCodexRuntimeDefinition } from "../electron/main/agent/runtimes/codex/codex-runtime-definition.mjs";

function childProcess(write) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.writes = [];
  child.stdin = new Writable({ write: write ?? ((chunk, _encoding, callback) => { child.writes.push(String(chunk)); callback(); }) });
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", null, "SIGTERM")); return true; });
  return child;
}
function client(Type, child, options = {}) {
  return new Type({ executablePath: "/usr/bin/fake", args: [], cwd: "/workspace", env: {}, spawn: () => child, ...options });
}

describe.each([JsonlRpcConnection, PiRpcClient])("native pipe lifecycle (%s)", (Type) => {
  it("cancels before dispatch without writing and treats cancellation after dispatch as unknown delivery", async () => {
    const child = childProcess();
    const connection = client(Type, child);
    const before = new AbortController();
    before.abort(new Error("Cancelled"));
    await expect(connection.request("prompt", {}, { signal: before.signal })).rejects.toThrow("Cancelled");
    expect(child.writes).toHaveLength(0);
    const after = new AbortController();
    const response = connection.request("prompt", {}, { signal: after.signal });
    const assertion = expect(response).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    after.abort();
    await assertion;
    expect(connection.closed).toBe(true);
    await connection.waitForExit();
    expect(child.kill).toHaveBeenCalled();
  });

  it("handles asynchronous broken pipes without accepting the request or leaving it pending", async () => {
    const child = childProcess((_chunk, _encoding, callback) => queueMicrotask(() => callback(new Error("EPIPE"))));
    const connection = client(Type, child);
    await expect(connection.request("prompt", {})).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    await connection.waitForExit();
    expect(connection.pending.size).toBe(0);
  });

  it("bounds an unfinished oversized tail even when a valid message came before it", async () => {
    const child = childProcess();
    const connection = client(Type, child, { maxLineBytes: 80 });
    const valid = Type === PiRpcClient ? { type: "agent_start" } : { method: "notice" };
    child.stdout.write(`${JSON.stringify(valid)}\n${"x".repeat(81)}`);
    expect(connection.closed).toBe(true);
    await connection.waitForExit();
  });

  it("does not claim disposal completed until the operating system reports process exit", async () => {
    const child = childProcess();
    child.kill = vi.fn(() => true);
    const connection = client(Type, child);
    connection.dispose();
    const stopped = vi.fn();
    const wait = connection.waitForExit().then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    await wait;
    expect(stopped).toHaveBeenCalledOnce();
  });
});

describe("native discovery and resource ownership", () => {
  it("rejects malformed JSON-RPC success envelopes as uncertain delivery", async () => {
    const child = childProcess();
    const connection = client(JsonlRpcConnection, child);
    const request = connection.request("turn/start", {});
    child.stdout.write('{"id":1}\n');
    await expect(request).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    await connection.waitForExit();
  });

  it("kills a cancelled discovery probe and prevents an already cancelled probe from spawning", async () => {
    const child = childProcess();
    const controller = new AbortController();
    const spawn = vi.fn(() => child);
    const pending = runBoundedProcessProbe("/usr/bin/fake", ["--version"], { spawn, signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow(/cancelled/);
    controller.abort();
    await assertion;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(runBoundedProcessProbe("/usr/bin/fake", [], { spawn, signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("centrally tracks every adapter, coalesces disposal, retains failed cleanup and rejects new work after shutdown", async () => {
    const first = vi.fn().mockRejectedValueOnce(new Error("cleanup failed")).mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const registry = new AgentRuntimeRegistry([createCodexRuntimeDefinition({ adapterFactory: () => ({
      inspect() {}, createSession() {}, resumeSession() {}, startTurn() {}, interruptTurn() {},
      dispose: calls++ === 0 ? first : second,
    }) })]);
    registry.createAdapter("codex", { readiness: {} });
    registry.createAdapter("codex", { readiness: {} });
    expect(registry.hasActiveResources()).toBe(true);
    const one = registry.dispose();
    expect(registry.dispose()).toBe(one);
    await expect(one).rejects.toThrow(/failed to dispose/);
    expect(second).toHaveBeenCalledOnce();
    expect(registry.hasActiveResources()).toBe(true);
    expect(() => registry.createAdapter("codex", { readiness: {} })).toThrow(/closed/);
    await registry.dispose();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledOnce();
    expect(registry.hasActiveResources()).toBe(false);
  });
});
