/**
 * The local control channel between Desktop and the host service.
 *
 * One JSON object per line over a Unix socket (a named pipe on Windows) in the
 * host service's own state directory. Only this user can reach it: the
 * directory and socket are 0700/0600, and every connection must first present
 * the token the host service wrote there (0600). Both ends can call the other:
 * Desktop asks the host service to share or stop, and the host service asks
 * Desktop for the few Cloud calls that need the signed-in person.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MAX_LINE = 1024 * 1024;
const HELLO_TIMEOUT_MS = 5_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_SOCKET_PATH = 100;

export function hostControlPaths(stateDir, platform = process.platform) {
  const tokenPath = path.join(stateDir, "control-token");
  if (platform === "win32") {
    const name = crypto.createHash("sha256").update(path.resolve(stateDir).toLowerCase()).digest("hex").slice(0, 24);
    return { socketPath: `\\\\.\\pipe\\puppyone-host-${name}`, tokenPath };
  }
  const inside = path.join(stateDir, "control.sock");
  // Unix socket paths are limited (104 bytes on macOS). A long state directory
  // gets a short socket in a private directory of this user's home instead.
  if (Buffer.byteLength(inside) <= MAX_SOCKET_PATH) return { socketPath: inside, tokenPath };
  const name = crypto.createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 24);
  return { socketPath: path.join(os.homedir(), ".puppyone-host", `${name}.sock`), tokenPath };
}

/** A peer that can call and be called; the transport is any line-oriented duplex socket. */
export function createRpcPeer(socket, { handlers = {}, onEvent = () => {}, onClose = () => {}, logger = console } = {}) {
  const pending = new Map();
  let buffered = "";
  let closed = false;

  function write(value) {
    if (closed) return false;
    socket.write(`${JSON.stringify(value)}\n`);
    return true;
  }

  async function dispatch(message) {
    if (message.type === "event") { try { onEvent(message.event, message.data); } catch { /* observers never break the channel */ } return; }
    if (message.type === "result" || message.type === "error") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.type === "result") waiter.resolve(message.result);
      else waiter.reject(Object.assign(new Error(message.message || "Host service call failed."),
        { code: message.code ?? null, status: message.status ?? null }));
      return;
    }
    if (message.type !== "call" || typeof message.method !== "string") return;
    const handler = Object.hasOwn(handlers, message.method) ? handlers[message.method] : null;
    if (!handler) { write({ type: "error", id: message.id, message: "Unknown method." }); return; }
    try {
      write({ type: "result", id: message.id, result: (await handler(message.params ?? {})) ?? null });
    } catch (error) {
      write({ type: "error", id: message.id, message: error?.message ?? String(error),
        code: typeof error?.code === "string" ? error.code : null,
        status: Number.isInteger(error?.status) ? error.status : null });
    }
  }

  socket.setEncoding?.("utf8");
  socket.on("data", (chunk) => {
    buffered += chunk;
    if (buffered.length > MAX_LINE && !buffered.includes("\n")) { close(); return; }
    for (let index = buffered.indexOf("\n"); index >= 0; index = buffered.indexOf("\n")) {
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { close(); return; }
      void dispatch(message).catch((error) => logger.warn?.("Host control dispatch failed", error?.message));
    }
  });
  socket.on("close", () => finish());
  socket.on("error", () => finish());

  function finish() {
    if (closed) return;
    closed = true;
    for (const [, waiter] of pending) { clearTimeout(waiter.timer); waiter.reject(new Error("Host service disconnected.")); }
    pending.clear();
    try { onClose(); } catch { /* nothing to undo */ }
  }

  function close() { socket.destroy(); finish(); }

  return Object.freeze({
    call(method, params = {}, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
      if (closed) return Promise.reject(new Error("Host service disconnected."));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Host service did not answer.")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        write({ type: "call", id, method, params });
      });
    },
    emit(event, data) { return write({ type: "event", event, data }); },
    close,
    isClosed: () => closed,
  });
}

async function writePrivate(file, content) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content, { mode: 0o600, flag: "wx" });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

/**
 * Serves the control channel. `handlersFor(peerRole)` builds the methods a
 * connected client may call; `onPeer` receives each authenticated peer.
 */
export async function startControlServer({ stateDir, handlersFor, onPeer = () => {}, logger = console,
  platform = process.platform, maxClients = 4 }) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(stateDir, 0o700).catch(() => {});
  const { socketPath, tokenPath } = hostControlPaths(stateDir, platform);
  const token = crypto.randomBytes(32).toString("base64url");
  await writePrivate(tokenPath, token);
  if (platform !== "win32") {
    await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(socketPath), 0o700).catch(() => {});
    await fs.rm(socketPath, { force: true });
  }
  const expected = Buffer.from(token);
  const peers = new Set();

  const server = net.createServer((socket) => {
    if (peers.size >= maxClients) { socket.destroy(); return; }
    let buffered = "";
    const timer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);
    const onHello = (chunk) => {
      buffered += chunk.toString("utf8");
      if (buffered.length > 4096) { socket.destroy(); return; }
      const index = buffered.indexOf("\n");
      if (index < 0) return;
      socket.removeListener("data", onHello);
      clearTimeout(timer);
      let hello;
      try { hello = JSON.parse(buffered.slice(0, index)); } catch { socket.destroy(); return; }
      const presented = Buffer.from(typeof hello?.token === "string" ? hello.token : "");
      if (hello?.type !== "hello" || presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
        socket.destroy(); return;
      }
      const role = hello.role === "desktop" ? "desktop" : "client";
      let peer = null;
      peer = createRpcPeer(socket, { handlers: handlersFor(role, () => peer), logger,
        onClose: () => peers.delete(peer) });
      peers.add(peer);
      socket.write(`${JSON.stringify({ type: "welcome" })}\n`);
      const rest = buffered.slice(index + 1);
      if (rest) socket.emit("data", rest);
      try { onPeer(peer, role); } catch (error) { logger.warn?.("Host control peer setup failed", error?.message); }
    };
    socket.on("data", onHello);
    socket.on("error", () => clearTimeout(timer));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.removeListener("error", reject); resolve(); });
  });
  if (platform !== "win32") await fs.chmod(socketPath, 0o600).catch(() => {});

  return Object.freeze({
    socketPath,
    broadcast(event, data) { for (const peer of peers) peer.emit(event, data); },
    peers: () => [...peers],
    async close() {
      for (const peer of peers) peer.close();
      await new Promise((resolve) => server.close(() => resolve()));
      if (platform !== "win32") await fs.rm(socketPath, { force: true }).catch(() => {});
      await fs.rm(tokenPath, { force: true }).catch(() => {});
    },
  });
}

/** Connects as Desktop (or another local client). Rejects if no host service is listening. */
export async function connectControlClient({ stateDir, role = "desktop", handlers = {}, onEvent, onClose,
  platform = process.platform, logger = console }) {
  const { socketPath, tokenPath } = hostControlPaths(stateDir, platform);
  const token = (await fs.readFile(tokenPath, "utf8")).trim();
  const socket = net.createConnection(socketPath);
  let rest = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Host service did not answer.")); }, HELLO_TIMEOUT_MS);
    let buffered = "";
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(`${JSON.stringify({ type: "hello", token, role })}\n`));
    const onData = (chunk) => {
      buffered += chunk.toString("utf8");
      const index = buffered.indexOf("\n");
      if (index < 0) return;
      socket.removeListener("data", onData);
      // Hold anything that follows the welcome until the peer is listening.
      socket.pause();
      clearTimeout(timer);
      let welcome;
      try { welcome = JSON.parse(buffered.slice(0, index)); } catch { welcome = null; }
      if (welcome?.type !== "welcome") { socket.destroy(); reject(new Error("Host service refused this client.")); return; }
      rest = buffered.slice(index + 1);
      resolve();
    };
    socket.on("data", onData);
    socket.once("close", () => { clearTimeout(timer); reject(new Error("Host service closed the connection.")); });
  });
  socket.removeAllListeners("error");
  socket.removeAllListeners("close");
  const peer = createRpcPeer(socket, { handlers, onEvent, onClose, logger });
  if (rest) socket.emit("data", rest);
  socket.resume();
  return peer;
}
