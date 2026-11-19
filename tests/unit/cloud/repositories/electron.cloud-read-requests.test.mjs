import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createCloudReadRequests } from "../../../../electron/main/cloud-read-requests.mjs";
function sender(id) { return Object.assign(new EventEmitter(), { id }); }
describe("Cloud GET ownership", () => {
  it("isolates renderers, cleans listeners and never cancels writes", () => {
    const registry = createCloudReadRequests(), a = sender(1), b = sender(2);
    const read = registry.begin(a, { requestId: "read", method: "GET" });
    registry.cancel(b, "read");
    expect(read.signal.aborted).toBe(false);
    registry.cancel(a, "read");
    expect(read.signal.aborted).toBe(true);
    read.close();
    expect(a.listenerCount("destroyed")).toBe(0);
    expect(registry.begin(a, { requestId: "write", method: "POST" })).toBeNull();
  });
  it("aborts a destroyed renderer and rejects duplicate or invalid ids", () => {
    const registry = createCloudReadRequests(), a = sender(1);
    const read = registry.begin(a, { requestId: "read" });
    expect(() => registry.begin(a, { requestId: "read" })).toThrow("Duplicate");
    expect(() => registry.begin(a, { requestId: "x".repeat(65) })).toThrow("Invalid");
    a.emit("destroyed");
    expect(read.signal.aborted).toBe(true);
    read.close();
  });
});
