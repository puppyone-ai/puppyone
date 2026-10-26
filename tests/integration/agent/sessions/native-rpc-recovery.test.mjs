import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JsonlRpcConnection } from "../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";
import { PiRpcClient } from "../../../../electron/main/agent/protocols/pi-rpc/pi-rpc-client.mjs";

const script = fileURLToPath(new URL("../../../fixtures/agent/runtimes/delayed-rpc.mjs", import.meta.url));

describe.each(["jsonrpc", "pi"])("%s real subprocess recovery", kind => {
  it("survives a request deadline, accepts its late receipt, and remains usable until explicitly closed", async () => {
    const options = { executablePath: process.execPath, cwd: process.cwd(), env: {}, forceKillTimeoutMs: 1000 };
    const client = kind === "pi" ? new PiRpcClient({ ...options, argsPrefix: [script] })
      : new JsonlRpcConnection({ ...options, args: [script] });
    try {
      const initial = await client.request("state", {}, { timeoutMs: 5000 });
      const receipt = Promise.withResolvers();
      await expect(client.request("prompt", { delayMs: 100 }, {
        timeoutMs: 20, onLateResponse: (error, value) => error ? receipt.reject(error) : receipt.resolve(value),
      })).rejects.toMatchObject({ deliveryOutcome: "unknown" });
      expect(client.closed).toBe(false);
      const sibling = await client.request("state", {}, { timeoutMs: 1000 });
      expect(sibling.pid).toBe(initial.pid);
      await expect(receipt.promise).resolves.toEqual(initial);
      expect((await client.request("state")).pid).toBe(initial.pid);
    } finally {
      client.dispose();
      await client.waitForExit({ timeoutMs: 3000 });
    }
    expect(client.exitInfo).not.toBeNull();
    expect(client.pending.size).toBe(0);
  });
});
