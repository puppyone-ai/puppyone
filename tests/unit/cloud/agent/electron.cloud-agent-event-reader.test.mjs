import { describe, expect, it, vi } from "vitest";
import { readCloudAgentEventBatch } from "../../../../electron/main/cloud-agent-event-reader.mjs";
import { requestCloudApi } from "../../../../electron/main/cloud-api-client.mjs";
function stream(chunks) {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); }, cancel,
  }), { headers: { "Content-Type": "text/event-stream" } });
  return { response, cancel };
}
const encode = text => new TextEncoder().encode(text);
const frame = (id, event = "text_delta", data = { text: "你好" }) => `id: ${id}\r\nevent: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
describe("Authenticated Cloud Agent SSE batching", () => {
  it("decodes split UTF-8 and CRLF, returns a terminal batch and cancels only the read", async () => {
    const bytes = encode(frame(1) + frame(2, "terminal", { state: "succeeded" }));
    const { response, cancel } = stream([...bytes].map(byte => Uint8Array.of(byte)));
    expect(await readCloudAgentEventBatch(response)).toEqual([
      { id: 1, event: "text_delta", data: { text: "你好" } }, { id: 2, event: "terminal", data: { state: "succeeded" } },
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds batches, idle wait time and authoritative reset", async () => {
    const many = stream([encode(Array.from({ length: 65 }, (_, i) => frame(i + 1)).join(""))]);
    expect(await readCloudAgentEventBatch(many.response)).toHaveLength(64);
    const heartbeat = stream([encode(": keepalive\n\n")]);
    expect(await readCloudAgentEventBatch(heartbeat.response, { maxWaitMs: 20 })).toEqual([]);
    expect(heartbeat.cancel).toHaveBeenCalledTimes(1);
    const reset = stream([encode(frame(8, "reset", { sequence: 8 }))]);
    expect(await readCloudAgentEventBatch(reset.response)).toEqual([{ id: 8, event: "reset", data: { sequence: 8 } }]);
  });
  it("retains one idle connection across repeated keepalives until data arrives", async () => {
    const fixture = stream([encode(": keepalive\n\n"), encode(": keepalive\n\n"),
      encode(frame(1, "text", { delta: "reply" })), encode(": keepalive\n\n")]);
    expect(await readCloudAgentEventBatch(fixture.response)).toEqual([
      { id: 1, event: "text", data: { delta: "reply" } },
    ]);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed cursors, non-SSE and unbounded frames", async () => {
    await expect(readCloudAgentEventBatch(stream([encode(frame("not-a-sequence"))]).response)).rejects.toThrow("cursor");
    await expect(readCloudAgentEventBatch(new Response("{}"))).rejects.toThrow("stream");
    await expect(readCloudAgentEventBatch(stream([encode("x".repeat(512 * 1024 + 1))]).response)).rejects.toThrow("limit");
  });
  it("passes the authorized request through the existing API client without JSON decoding SSE", async () => {
    const fixture = stream([encode(frame(1, "terminal"))]);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(fixture.response);
    try {
      expect(await requestCloudApi("https://cloud-fixture.puppyone.ai/api/v1", "/agents/runs/id/events?after=0",
        { headers: { Authorization: "Bearer fixture-only" }, responseType: "agent-events" })).toHaveLength(1);
      expect(fetch.mock.calls[0][1].responseType).toBeUndefined();
    } finally { fetch.mockRestore(); }
  });
});
