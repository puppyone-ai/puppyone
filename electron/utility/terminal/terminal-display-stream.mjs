import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import unicode11 from "@xterm/addon-unicode11";
import { canCheckpointXterm, captureXtermCheckpoint } from "../../../shared/terminal-contract/xterm-checkpoint.mjs";

const { Terminal } = headless;
const { SerializeAddon } = serialize;
const { Unicode11Addon } = unicode11;
const HIGH_WATER = 128 * 1024;
const LOW_WATER = 32 * 1024;
const MAX_BUFFER = 2 * 1024 * 1024;
const MAX_CHECKPOINT = 8 * 1024 * 1024;
const MAX_FRAME = 32 * 1024;

/** A bounded canonical parser plus a single ACK-gated display connection. */
export function createTerminalDisplayStream({ session, onFailure = () => {} }) {
  const terminal = new Terminal({ cols: session.cols, rows: session.rows, scrollback: 6000, convertEol: true, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  terminal.onData((data) => { if (!session.exited) session.terminal.write(data); });
  let queue = [];
  let queuedBytes = 0;
  let parsing = false;
  let paused = false;
  let disposed = false;
  let port = null;
  let connection = null;
  let sequence = 0;
  let inFlight = null;
  let outbound = [];
  let outboundBytes = 0;
  let replay = [];
  let replayBytes = 0;
  let checkpoint = { cols: terminal.cols, rows: terminal.rows, data: "" };
  let lastCheckpoint = Date.now();
  let terminalExit = null;
  let pendingAttachment = null;

  const bytes = (entry) => Buffer.byteLength(entry.data ?? "") + Buffer.byteLength(JSON.stringify(entry.checkpointState ?? null)) + 32;
  const fail = (message) => {
    if (disposed) return;
    onFailure({ type: "stream-failed", code: "TERMINAL_OUTPUT_BUDGET", message });
    dispose();
    try { session.terminal.kill(); } catch { /* Native close will report the final result. */ }
  };
  const throttle = () => {
    const total = queuedBytes + outboundBytes + (inFlight?.bytes ?? 0);
    if (!paused && total >= HIGH_WATER) { paused = true; session.terminal.pause(); }
    else if (paused && total <= LOW_WATER) { paused = false; session.terminal.resume(); }
  };
  const makeCheckpoint = (force = false) => {
    if (!canCheckpointXterm(terminal)) return;
    if (!force && replayBytes < LOW_WATER && Date.now() - lastCheckpoint < 250) return;
    let data = serializer.serialize({ scrollback: 6000 });
    if (Buffer.byteLength(data) > MAX_CHECKPOINT) data = serializer.serialize({ scrollback: 1000 });
    if (Buffer.byteLength(data) > MAX_CHECKPOINT) { fail("Terminal checkpoint exceeds its recovery budget."); return; }
    checkpoint = { cols: terminal.cols, rows: terminal.rows, data, checkpointState: captureXtermCheckpoint(terminal) };
    if (bytes(checkpoint) > MAX_CHECKPOINT) { fail("Terminal checkpoint state exceeds its recovery budget."); return; }
    replay = [];
    replayBytes = 0;
    lastCheckpoint = Date.now();
  };
  const send = () => {
    if (!port || inFlight || disposed || outbound.length === 0) return;
    const entries = [];
    let size = 0;
    while (outbound.length && (size === 0 || size + bytes(outbound[0]) <= MAX_FRAME)) {
      const entry = outbound.shift();
      size += bytes(entry);
      entries.push(entry);
    }
    outboundBytes -= size;
    inFlight = { sequence: ++sequence, bytes: size };
    port.postMessage({ type: "terminal-frame", connection, sequence, entries });
  };
  const record = (entry) => {
    replay.push(entry);
    replayBytes += bytes(entry);
    if (port) { outbound.push(entry); outboundBytes += bytes(entry); }
    makeCheckpoint();
    if (replayBytes > MAX_BUFFER) { fail("An unfinished terminal sequence exceeds its recovery budget."); return; }
    send();
    throttle();
  };
  const drain = () => {
    if (disposed || parsing || !queue.length) return;
    const entry = queue.shift();
    queuedBytes -= bytes(entry);
    parsing = true;
    const done = () => {
      if (disposed) return;
      parsing = false;
      record(entry);
      if (pendingAttachment) {
        const pending = pendingAttachment;
        pendingAttachment = null;
        attach(pending.port, pending.binding);
      }
      drain();
    };
    if (entry.cols) { terminal.resize(entry.cols, entry.rows); done(); }
    else if (entry.exit) { done(); }
    else terminal.write(entry.data, done);
  };
  const enqueue = (entry) => {
    if (disposed) return;
    queue.push(entry);
    queuedBytes += bytes(entry);
    if (queuedBytes + outboundBytes > MAX_BUFFER) { fail("Terminal producer exceeded the bounded output queue."); return; }
    throttle();
    drain();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    port?.close();
    port = null;
    pendingAttachment?.port.close();
    pendingAttachment = null;
    queue = []; outbound = []; replay = [];
    terminal.dispose();
  }
  function attach(nextPort, binding) {
      if (disposed) { nextPort.close(); return; }
      if (parsing) {
        pendingAttachment?.port.close();
        pendingAttachment = { port: nextPort, binding };
        return;
      }
      port?.close();
      port = nextPort;
      connection = binding.connection;
      sequence = 0;
      inFlight = null;
      makeCheckpoint(true);
      outbound = [{ ...checkpoint, reset: true }, ...replay];
      if (terminalExit && !outbound.some((entry) => entry.exit)) outbound.push({ exit: terminalExit });
      outboundBytes = outbound.reduce((sum, entry) => sum + bytes(entry), 0);
      nextPort.on("message", ({ data }) => {
        if (port !== nextPort || data?.connection !== connection || data.type !== "terminal-ack") return;
        if (!inFlight || data.sequence !== inFlight.sequence) return;
        inFlight = null;
        send();
        throttle();
      });
      nextPort.on("close", () => {
        if (port !== nextPort) return;
        port = null; inFlight = null; outbound = []; outboundBytes = 0;
        makeCheckpoint(true);
        throttle();
      });
      send();
      throttle();
  }
  return {
    write(data) {
      // Keep each parser and MessagePort operation bounded, including a noisy
      // native producer that supplies an unusually large onData callback.
      for (let start = 0; start < data.length; start += 8192) enqueue({ data: data.slice(start, start + 8192) });
    },
    resize: (cols, rows) => enqueue({ cols, rows }),
    exit(event) { terminalExit = event; enqueue({ exit: event }); },
    attach,
    dispose,
    diagnostics: () => ({ queuedBytes, outboundBytes, replayBytes, paused, inFlight: inFlight?.sequence ?? null, disposed }),
  };
}

export const terminalDisplayStreamLimits = Object.freeze({ highWater: HIGH_WATER, lowWater: LOW_WATER, maxBuffer: MAX_BUFFER, maxCheckpoint: MAX_CHECKPOINT, maxFrame: MAX_FRAME });
