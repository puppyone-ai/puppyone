/**
 * Desktop Main's SSH client for folders on the owner's other computers.
 *
 * One SSH connection per folder, inside a Cloud byte tunnel. For each
 * connection Main makes a fresh Ed25519 key, asks the Cloud for a five-minute
 * certificate for that device, and checks the host key against the one the
 * Cloud registered for the device. The session is encrypted end to end with
 * the host's SSH server: the Cloud relays bytes it cannot read.
 *
 * Channels: `puppyone-files` (file protocol v1: requests and watches), a shell
 * with a pty (terminals), and `puppyone-agent <launcher>` (Agents).
 */
import crypto from "node:crypto";
import { Duplex } from "node:stream";
import { createRequire } from "node:module";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";
import { certificateKey, ed25519Raw, openSshPrivateKey, openSshPublicKey, parsePublicKeyLine } from "./openssh.mjs";

const require = createRequire(import.meta.url);
const { Client, utils } = require("ssh2");

export const FILES_SUBSYSTEM = "puppyone-files";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LINE_BYTES = 12 * 1024 * 1024;
const READY_TIMEOUT_MS = 20_000;
// A read or watch that takes longer is a dead path (a NAT that dropped it): give up and reconnect.
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 45_000;
// The host's file error codes, as HTTP-like statuses the editor already understands.
const STATUS = { conflict: 409, already_exists: 409, not_empty: 409, not_found: 404, folder_unavailable: 403,
  root_changed: 403, not_allowed: 403, invalid_path: 400, unsupported_file: 400, too_many_entries: 400,
  invalid_content: 400, revision_required: 400, file_operation_failed: 400, too_large: 413,
  device_offline: 503, device_busy: 503, tunnel_limit: 503, tunnel_unavailable: 503, network_unavailable: 0 };

export class HostSshError extends Error {
  constructor(code, { status = STATUS[code] ?? 400, outcomeUnknown = false } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

/** A Duplex over a WebSocket whose binary messages are the tunnel's bytes. */
function socketStream(ws) {
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      if (ws.readyState !== 1) { callback(new Error("Tunnel closed.")); return; }
      ws.send(chunk);
      callback();
    },
    final(callback) { try { ws.close(); } catch { /* already closed */ } callback(); },
    destroy(error, callback) { try { ws.close(); } catch { /* already closed */ } callback(error); },
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") return;
    stream.push(Buffer.from(event.data));
  });
  ws.addEventListener("close", () => stream.push(null));
  ws.addEventListener("error", () => stream.destroy(new Error("Tunnel failed.")));
  return stream;
}

/** Waits for the tunnel's `ready`; a refusal arrives as `{type: "error", code}`. */
function tunnelReady(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new HostSshError("device_offline")); }, READY_TIMEOUT_MS);
    const onMessage = (event) => {
      if (typeof event.data !== "string") return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      cleanup();
      if (frame?.type === "ready") resolve();
      else reject(new HostSshError(typeof frame?.code === "string" ? frame.code : "tunnel_unavailable"));
    };
    const onClose = () => { cleanup(); reject(new HostSshError("network_unavailable", { status: 0 })); };
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    }
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
  });
}

/** The file protocol over one `puppyone-files` channel: JSON lines, numbered requests, watches. */
function filesChannel(channel) {
  let nextId = 1;
  let buffered = Buffer.alloc(0);
  let closed = false;
  const pending = new Map();
  const watches = new Map();
  channel.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length > MAX_LINE_BYTES) { channel.close(); return; }
    for (let end = buffered.indexOf(10); end >= 0; end = buffered.indexOf(10)) {
      const line = buffered.subarray(0, end);
      buffered = buffered.subarray(end + 1);
      let message;
      try { message = JSON.parse(line.toString("utf8")); } catch { channel.close(); return; }
      if (Number.isSafeInteger(message.watch)) {
        const watcher = watches.get(message.watch);
        if (!watcher) continue;
        if (message.ended) {
          watches.delete(message.watch);
          const refused = pending.get(message.watch);
          if (refused) { pending.delete(message.watch); clearTimeout(refused.timer); refused.reject(new HostSshError("folder_unavailable")); }
          else watcher.ended();
        }
        else watcher.onEvent({ paths: Array.isArray(message.paths) ? message.paths : [], reset: message.reset === true });
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (typeof message.error === "string") waiter.reject(new HostSshError(message.error));
      else waiter.resolve(message.result ?? null);
    }
  });
  channel.on("close", () => {
    closed = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      // The host may or may not have applied a mutation in flight.
      waiter.reject(new HostSshError("network_unavailable", { status: 0, outcomeUnknown: waiter.mutating }));
    }
    pending.clear();
    for (const watcher of watches.values()) watcher.ended();
    watches.clear();
  });
  const send = (value) => channel.write(`${JSON.stringify(value)}\n`);

  return Object.freeze({
    isOpen: () => !closed,
    request(request, { mutating = false } = {}) {
      if (closed) return Promise.reject(new HostSshError("network_unavailable", { status: 0 }));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new HostSshError("device_timeout", { status: 504, outcomeUnknown: mutating }));
        }, mutating ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer, mutating });
        send({ id, op: "request", request });
      });
    },
    /** Resolves once watching; `ended` fires when the watch or the connection ends. */
    watch(onEvent, ended) {
      if (closed) return Promise.reject(new HostSshError("network_unavailable", { status: 0 }));
      const id = nextId++;
      watches.set(id, { onEvent, ended });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new HostSshError("device_timeout", { status: 504 })); }, READ_TIMEOUT_MS);
        pending.set(id, { resolve: () => resolve(() => { watches.delete(id); if (!closed) send({ id, op: "unwatch" }); }),
          reject: (error) => { watches.delete(id); reject(error); }, timer, mutating: false });
        send({ id, op: "watch" });
      });
    },
  });
}

export function createHostSshClient({ auth, apiBase, WebSocketImpl = globalThis.WebSocket, logger = console }) {
  const deployment = resolveCloudApiBaseUrl(apiBase);
  const connections = new Map();

  async function deviceOf(folderId, expectedSession) {
    const catalog = await auth.requestSessionApi(deployment, "/hosts", { method: "GET" }, expectedSession);
    const device = (catalog?.devices ?? []).find((item) => item.folders?.some((folder) => folder.id === folderId));
    if (!device) throw new HostSshError("folder_unavailable");
    if (device.online === false) throw new HostSshError("device_offline");
    return device.id;
  }

  async function connect(folderId, expectedSession) {
    const deviceId = await deviceOf(folderId, expectedSession);
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const userKey = utils.parseKey(openSshPrivateKey(privateKey));
    const issued = await auth.requestSessionApi(deployment, `/hosts/devices/${encodeURIComponent(deviceId)}/ssh-certificate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: openSshPublicKey(ed25519Raw(privateKey).publicKey) }) }, expectedSession);
    const hostKey = parsePublicKeyLine(issued?.host_key);
    const url = new URL(`/api/v1/hosts/folders/${folderId}/tunnel`,
      typeof issued?.gateway_url === "string" && issued.gateway_url ? issued.gateway_url : new URL(deployment).origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = await auth.openHostTunnelSocket(deployment, url.toString(), expectedSession, WebSocketImpl);
    ws.binaryType = "arraybuffer";
    // Listen for SSH bytes before `ready`: the host may speak first, right after it.
    const sock = socketStream(ws);
    await tunnelReady(ws).catch((error) => { sock.destroy(); throw error; });
    const client = new Client();
    await new Promise((resolve, reject) => {
      client.once("ready", resolve);
      client.once("error", (error) => reject(error?.level === "client-authentication"
        ? new HostSshError("folder_unavailable") : new HostSshError("network_unavailable", { status: 0 })));
      client.connect({ sock, username: folderId, readyTimeout: READY_TIMEOUT_MS,
        // Two unanswered keepalives (about 20 s) end a connection the network silently dropped.
        keepaliveInterval: 10_000, keepaliveCountMax: 2,
        authHandler: [{ type: "publickey", username: folderId, key: certificateKey(userKey, issued.certificate) }],
        // Only this device's registered key; never trust on first use.
        hostVerifier: (key) => Buffer.from(key).equals(hostKey) });
    });
    client.on("error", (error) => logger.warn?.("Remote folder connection error", error?.message));
    let files = null;
    const connection = {
      client,
      closed: false,
      async files() {
        if (files?.isOpen()) return files;
        files = await new Promise((resolve, reject) => client.subsys(FILES_SUBSYSTEM, (error, channel) =>
          error ? reject(new HostSshError("folder_unavailable")) : resolve(filesChannel(channel))));
        return files;
      },
      /** A terminal (`launcher` "shell") or an Agent, with a pty. */
      terminal({ launcher, cols, rows }) {
        const pty = { term: "xterm-256color", cols, rows };
        return new Promise((resolve, reject) => {
          const done = (error, channel) => (error ? reject(new HostSshError("not_allowed")) : resolve(channel));
          if (launcher === "shell") client.shell(pty, done);
          else client.exec(`puppyone-agent ${launcher}`, { pty }, done);
        });
      },
      close() { client.end(); },
    };
    client.on("close", () => {
      connection.closed = true;
      if (connections.get(folderId)?.connection === connection) connections.delete(folderId);
    });
    return connection;
  }

  /** The folder's open connection, or a new one. Failures are HostSshError. */
  async function get(folderId, expectedSession) {
    if (!UUID.test(folderId)) throw new HostSshError("invalid_request");
    const current = connections.get(folderId);
    if (current) {
      const connection = await current.promise.catch(() => null);
      if (connection && !connection.closed) return connection;
      if (connections.get(folderId) === current) connections.delete(folderId);
    }
    const entry = { promise: null, connection: null };
    entry.promise = connect(folderId, expectedSession).then((connection) => { entry.connection = connection; return connection; });
    connections.set(folderId, entry);
    try {
      return await entry.promise;
    } catch (error) {
      if (connections.get(folderId) === entry) connections.delete(folderId);
      throw error instanceof HostSshError ? error : normalize(error);
    }
  }

  function close(folderId) {
    const entry = connections.get(folderId);
    connections.delete(folderId);
    entry?.connection?.close();
  }

  function closeAll() { for (const folderId of [...connections.keys()]) close(folderId); }

  return Object.freeze({ get, close, closeAll });
}

/** Session API failures keep their status and code; anything else is a lost network. */
export function normalize(error) {
  if (error instanceof HostSshError) return error;
  const status = Number.isFinite(error?.status) ? error.status
    : Number(/Request failed \((\d{3})\)/.exec(String(error?.message ?? ""))?.[1]) || 0;
  const code = /"code":\s*"([a-z_]+)"/.exec(String(error?.message ?? ""))?.[1]
    ?? ({ 0: "network_unavailable", 403: "folder_unavailable", 404: "folder_unavailable" }[status] ?? "file_operation_failed");
  return new HostSshError(code, { status });
}
