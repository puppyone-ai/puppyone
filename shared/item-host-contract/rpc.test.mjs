import { describe, expect, it, vi } from "vitest";
import { createHostRpc } from "./rpc.mjs";

describe("instance host RPC", () => {
  it("isolates generations and releases capacity only on settlement", async () => {
    const sent = [];
    const rpc = createHostRpc({ generation: "a", send: (message) => sent.push(message), maxPending: 1 });
    const first = rpc.call("start");
    await expect(rpc.call("start")).rejects.toMatchObject({ code: "HOST_BUSY" });
    await rpc.receive({ ...sent[0], type: "result", generation: "old", value: 1 });
    expect(rpc.diagnostics().pending).toBe(1);
    await rpc.receive({ ...sent[0], type: "result", value: 2 });
    await expect(first).resolves.toBe(2);
    expect(rpc.diagnostics().pendingBytes).toBe(0);
    rpc.close();
  });
  it("does not retry timed-out commands and ignores late replies", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const rpc = createHostRpc({ generation: "a", send, timeoutMs: 10 });
    const outcome = expect(rpc.call("start")).rejects.toMatchObject({ code: "HOST_DELIVERY_UNKNOWN" });
    await vi.advanceTimersByTimeAsync(11);
    await outcome;
    expect(send).toHaveBeenCalledTimes(1);
    await rpc.receive({ ...send.mock.calls[0][0], type: "result", value: "late" });
    expect(rpc.diagnostics().pending).toBe(0);
    rpc.close();
    vi.useRealTimers();
  });
  it("bounds bytes and rejects all callers on host exit", async () => {
    const rpc = createHostRpc({ generation: "a", send() {}, maxMessageBytes: 256 });
    await expect(rpc.call("start", ["x".repeat(256)])).rejects.toMatchObject({ code: "HOST_BUSY" });
    const pending = rpc.call("close");
    rpc.close();
    await expect(pending).rejects.toMatchObject({ code: "HOST_CLOSED" });
    expect(rpc.diagnostics().pendingBytes).toBe(0);
  });
});
