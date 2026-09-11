import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createTerminalDisplayStream } from "./terminal-display-stream.mjs";

class Port extends EventEmitter {
  sent = [];
  postMessage(message) { this.sent.push(message); }
  close() { this.emit("close"); }
  acknowledge(connection, sequence) { this.emit("message", { data: { type: "terminal-ack", connection, sequence } }); }
}
const until = async (test) => { for (let i = 0; i < 100 && !test(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); expect(test()).toBe(true); };
function fixture() {
  const pty = { pause: vi.fn(), resume: vi.fn(), kill: vi.fn(), write: vi.fn() };
  const stream = createTerminalDisplayStream({ session: { cols: 80, rows: 24, terminal: pty } });
  return { pty, stream };
}
describe("PTY display flow and recovery", () => {
  it("sends only one frame until the consumer acknowledges parsing", async () => {
    const { stream } = fixture();
    const port = new Port();
    stream.attach(port, { connection: "a" });
    stream.write("hello");
    await until(() => stream.diagnostics().outboundBytes > 0);
    expect(port.sent).toHaveLength(1);
    port.acknowledge("stale", 1);
    expect(port.sent).toHaveLength(1);
    port.acknowledge("a", 1);
    expect(port.sent).toHaveLength(2);
    expect(port.sent[1].entries[0].data).toBe("hello");
    stream.dispose();
  });
  it("recreates a screen without respawning, including a split escape sequence", async () => {
    const { stream, pty } = fixture();
    stream.write("hello\x1b[");
    await until(() => stream.diagnostics().replayBytes > 0);
    const port = new Port();
    stream.attach(port, { connection: "b" });
    expect(port.sent[0].entries[0].reset).toBe(true);
    expect(port.sent[0].entries.some((entry) => entry.data === "hello\x1b[")).toBe(true);
    stream.write("31mred");
    port.acknowledge("b", 1);
    await until(() => port.sent.length === 2);
    expect(port.sent[1].entries[0].data).toBe("31mred");
    expect(pty.kill).not.toHaveBeenCalled();
    stream.dispose();
  });
  it("pauses a noisy PTY and releases pressure when a crashed display detaches", async () => {
    const { stream, pty } = fixture();
    const port = new Port();
    stream.attach(port, { connection: "a" });
    stream.write("x".repeat(160 * 1024));
    await until(() => stream.diagnostics().outboundBytes >= 128 * 1024);
    expect(pty.pause).toHaveBeenCalled();
    port.close();
    await until(() => !stream.diagnostics().paused);
    expect(pty.resume).toHaveBeenCalled();
    stream.dispose();
  });
  it("has one canonical query responder even without a display", async () => {
    const { stream, pty } = fixture();
    stream.write("\x1b[6n");
    await until(() => pty.write.mock.calls.length > 0);
    expect(pty.write).toHaveBeenCalledExactlyOnceWith("\x1b[1;1R");
    stream.dispose();
  });
});
