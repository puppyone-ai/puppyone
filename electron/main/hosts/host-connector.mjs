import { randomUUID } from "node:crypto";
import { Duplex } from "node:stream";
import { normalizeCloudApiBaseUrl, resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FRAME_CHARACTERS = 12 * 1024 * 1024;
const HEARTBEAT_MS = 10_000;
// The gateway answers every heartbeat. A socket that stays silent this long is
// dead even if the OS has not noticed (sleep, a NAT that dropped it): reconnect.
const SILENT_MS = 30_000;
const MAX_RETRY_MS = 15_000;
const MAX_TUNNELS = 16;
// Raw bytes per tunnel_data frame (the gateway accepts up to 64 KiB).
const TUNNEL_CHUNK = 48 * 1024;
const STREAM_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** Server close codes (host file protocol v1). */
export const CLOSE_REVOKED = 4004;
export const CLOSE_UNSUPPORTED = 4005;
/** Host file protocol version this App speaks. */
export const HOST_PROTOCOL_VERSION = 1;
const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

/**
 * The challenge may name a dedicated gateway origin. Accept it only inside the
 * same PuppyOne host family the deployment itself is allowed to use.
 */
export function deviceSocketUrl(deployment, deviceId, connectUrl) {
  let url;
  if (typeof connectUrl === "string" && connectUrl) {
    url = new URL(connectUrl);
    const origin = normalizeCloudApiBaseUrl(`${url.protocol}//${url.host}`);
    if (!origin || url.pathname !== `/api/v1/hosts/devices/${deviceId}/connect` || url.search || url.hash ||
        url.username || url.password) throw new Error("Invalid device gateway address.");
  } else {
    url = new URL(`${deployment}/hosts/devices/${deviceId}/connect`);
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** What a host signs to ask for a challenge; the Cloud checks it against the registered key. */
export function deviceChallengeRequestPayload(accountId, deviceId, timestamp) {
  return `puppyone-device-challenge-v1\n${accountId}\n${deviceId}\n${timestamp}`;
}

/**
 * A signed, outbound-only device connection. No local listening port.
 *
 * The connection needs only the device key: it asks for each challenge with a
 * device-signed request, so it stays online with nobody signed in on this
 * computer. Whoever owns the connector decides when sharing stops.
 *
 * What it serves: byte tunnels, each one SSH session that ends on this
 * computer's SSH server (`sshServer`). The Cloud admits a tunnel for a folder
 * and relays its bytes; it never sees file content, commands or output. The
 * earlier plaintext file, watch and execution frames are refused.
 *
 * Lifecycle: `connect` starts serving; transport loss retries with backoff;
 * `suspend`/`wake` follow system sleep; `stop` ends it; a definite revocation
 * (close 4004 or a `device_revoked` refusal) stops for good and calls `onRevoked`.
 */
export function createHostConnector({ apiBase, identity, registry, sshServer = null,
  WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch, now = () => Date.now(),
  logger = console, onRevoked = () => {}, onStatus = () => {},
  appVersion = "unknown", bootId = randomUUID(), execService = null }) {
  // Sent with every proof; an unexpected App version string never blocks connecting.
  const hello = { protocol: HOST_PROTOCOL_VERSION, boot_id: bootId,
    app_version: APP_VERSION.test(String(appVersion)) ? String(appVersion) : "unknown" };
  const deployment = resolveCloudApiBaseUrl(apiBase);
  let socket = null;
  let heartbeat = null;
  let stopped = true;
  let accountId = null;
  let deviceId = null;
  // Learned from the Cloud when this computer's clock is off; never persisted.
  let clockOffset = 0;
  let wantsConnection = false;
  let retryTimer = null;
  let retryDelay = 1000;
  let state = "off";
  let lastAccessAt = null;
  const tunnels = new Map();
  let lastHeard = 0;

  function notify() {
    try { onStatus(status()); } catch { /* Status observers never control the connection. */ }
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    notify();
  }

  function status() {
    return { state, deviceId, activeRequests: 0, watching: 0, tunnels: tunnels.size, lastAccessAt,
      sessions: sshServer?.list() ?? [], running: execService?.list() ?? [] };
  }

  function endTunnels() {
    for (const tunnel of tunnels.values()) tunnel.end({ tell: false });
    tunnels.clear();
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    endTunnels();
    // Remote terminals end with the connection that carried them.
    void execService?.stopAll().catch(() => {});
    const previous = socket;
    socket = null;
    if (previous && previous.readyState < 2) previous.close();
  }

  function stop() {
    wantsConnection = false; stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    close();
    setState("off");
  }

  // Only a definite server denial (socket close 4004 or a `device_revoked`
  // refusal) means revoked. Transport errors, a bad clock or signature and 5xx
  // keep retrying with the same identity.
  function revoked() {
    const lost = { accountId, deviceId };
    stop();
    try { onRevoked(lost); } catch (error) { logger.warn("Device revocation cleanup failed", error?.message); }
  }

  // The Cloud no longer serves this App's protocol. Retrying cannot help, so stop
  // until the App is updated; the identity and shared folders stay as they are.
  function outdated() {
    stop();
    setState("outdated");
  }

  function retry() {
    if (!wantsConnection || retryTimer) return;
    setState("offline");
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wantsConnection && stopped) void connect(deviceId, accountId).catch(() => retry());
    }, delay);
  }

  /** A device-signed challenge request; one retry with the Cloud's clock if ours is off. */
  async function requestChallenge() {
    for (let attempt = 0; ; attempt++) {
      const timestamp = Math.floor((now() + clockOffset) / 1000);
      const signature = await identity.signForDevice({ accountId, deviceId },
        deviceChallengeRequestPayload(accountId, deviceId, timestamp));
      const response = await fetchImpl(`${deployment}/hosts/devices/${deviceId}/device-challenge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: accountId, timestamp, signature }),
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (response.ok) return body;
      const detail = body?.detail;
      if (response.status === 401 && detail?.code === "device_clock_skew" &&
          Number.isInteger(detail.server_time) && attempt === 0) {
        clockOffset = detail.server_time * 1000 - now();
        continue;
      }
      throw Object.assign(new Error(`Device challenge refused (${response.status}).`),
        { status: response.status, code: typeof detail?.code === "string" ? detail.code : null });
    }
  }

  function send(ws, frame) {
    if (ws === socket && ws.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify(frame));
  }

  /** One tunnel from the gateway: a Duplex whose bytes are an SSH session for this computer's SSH server. */
  async function openTunnel(message, ws) {
    const stream = message?.stream;
    if (typeof stream !== "string" || !STREAM_ID.test(stream) || !UUID.test(message?.folder_id)) { close(); return; }
    const refuse = (error) => send(ws, { type: "tunnel_refused", stream, error });
    if (tunnels.has(stream)) { close(); return; }
    if (!sshServer) { refuse("tunnel_unavailable"); return; }
    if (tunnels.size >= MAX_TUNNELS) { refuse("tunnel_limit"); return; }
    if (!await registry.resolve(message.folder_id, accountId, deviceId)) { refuse("folder_unavailable"); return; }
    if (ws !== socket) return;
    let ended = false;
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        for (let offset = 0; offset < chunk.length; offset += TUNNEL_CHUNK) {
          send(ws, { type: "tunnel_data", stream, data: chunk.subarray(offset, offset + TUNNEL_CHUNK).toString("base64") });
        }
        callback();
      },
      final(callback) { tunnel.end({ tell: true }); callback(); },
      destroy(error, callback) { tunnel.end({ tell: true }); callback(error); },
    });
    const tunnel = {
      push: (bytes) => { if (!ended) duplex.push(bytes); },
      end({ tell }) {
        if (ended) return;
        ended = true;
        tunnels.delete(stream);
        if (tell) send(ws, { type: "tunnel_close", stream });
        duplex.push(null);
        duplex.destroy();
        notify();
      },
    };
    tunnels.set(stream, tunnel);
    send(ws, { type: "tunnel_opened", stream });
    lastAccessAt = new Date().toISOString(); notify();
    if (!await sshServer.accept(duplex, { folderId: message.folder_id })) tunnel.end({ tell: true });
  }

  function tunnelData(message) {
    const tunnel = tunnels.get(message?.stream);
    if (!tunnel || typeof message.data !== "string") return;
    tunnel.push(Buffer.from(message.data, "base64"));
  }

  /** Plaintext file, watch and execution frames are no longer served: only SSH, end to end. */
  function refuseRelay(message, ws) {
    if (message.type === "file" && UUID.test(message.id)) send(ws, { type: "reply", id: message.id, error: "not_allowed" });
    else if (message.type === "watch" && UUID.test(message.subscription)) {
      send(ws, { type: "event", subscription: message.subscription, paths: [], reset: true });
    } else if (message.type === "exec_open" && typeof message.session === "string") {
      send(ws, { type: "exec_failed", session: message.session, error: "not_allowed" });
    }
  }

  async function connect(registeredDeviceId, registeredAccountId) {
    if (!UUID.test(registeredDeviceId) || !UUID.test(registeredAccountId) || !WebSocketImpl || !fetchImpl) {
      throw new Error("Host connector unavailable.");
    }
    if (!stopped) throw new Error("Host is already connecting.");
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    stopped = false;
    wantsConnection = true;
    setState("connecting");
    try {
    accountId = registeredAccountId;
    deviceId = registeredDeviceId;
    const challenge = await requestChallenge();
    if (stopped) throw new Error("Connection cancelled.");
    if (![challenge.challenge_id, challenge.epoch].every((value) => UUID.test(value)) ||
        typeof challenge.nonce !== "string") throw new Error("Invalid device challenge.");
    const payload = `puppyone-device-v1\n${accountId}\n${deviceId}\n${challenge.challenge_id}\n${challenge.epoch}\n${challenge.nonce}`;
    const signature = await identity.signForDevice({ accountId, deviceId }, payload);
    if (stopped) throw new Error("Connection cancelled.");
    const ws = new WebSocketImpl(deviceSocketUrl(deployment, deviceId, challenge.connect_url));
    socket = ws;
    return await new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { if (!ready) { close(); reject(new Error("Device connection timed out.")); } }, 15_000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ owner: accountId, challenge_id: challenge.challenge_id,
          epoch: challenge.epoch, nonce: challenge.nonce, signature, ...hello }));
      });
      ws.addEventListener("message", (event) => {
        if (ws !== socket) return;
        lastHeard = now();
        let message;
        try {
          if (typeof event.data !== "string" || event.data.length > MAX_FRAME_CHARACTERS) throw new Error("Frame too large");
          message = JSON.parse(event.data);
        } catch { close(); return; }
        if (message?.type === "ready" && message.epoch === challenge.epoch && !ready) {
          ready = true; retryDelay = 1000; clearTimeout(timeout); setState("online");
          resolve({ deviceId, epoch: challenge.epoch });
          heartbeat = setInterval(() => {
            if (now() - lastHeard <= SILENT_MS) { send(ws, { type: "heartbeat" }); return; }
            logger.warn("Device connection went silent; reconnecting");
            close(); stopped = true;
            retryDelay = 1000;
            retry();
          }, HEARTBEAT_MS);
        } else if (!ready) {
          close();
        } else if (message?.type === "tunnel_open") {
          void openTunnel(message, ws).catch(() => close());
        } else if (message?.type === "tunnel_data") {
          tunnelData(message);
        } else if (message?.type === "tunnel_close") {
          tunnels.get(message.stream)?.end({ tell: false });
        } else if (message?.type !== "heartbeat_ack") {
          refuseRelay(message ?? {}, ws);
        }
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(timeout);
        if (socket === ws) {
          close(); stopped = true;
          if (event?.code === CLOSE_REVOKED) revoked();
          else if (event?.code === CLOSE_UNSUPPORTED) outdated();
          else if (ready) retry();
        }
        if (!ready) reject(new Error("Device connection closed."));
      });
      ws.addEventListener("error", (error) => { logger.warn("Device connection error", error?.message ?? "unknown"); });
    });
    } catch (error) {
      stopped = true; close();
      if (error?.status === 403 && error?.code === "device_revoked" && wantsConnection) revoked();
      else if (wantsConnection) retry();
      throw error;
    }
  }

  /** System sleep: drop the socket now; the server would only see it idle out. */
  function suspend() {
    if (!wantsConnection) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const previous = socket;
    close(); stopped = true;
    if (previous) setState("offline");
  }

  /** Wake or network change: reconnect at once instead of waiting out the backoff. */
  function wake() {
    if (!wantsConnection || !stopped || !deviceId) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 1000;
    if (wantsConnection && stopped) void connect(deviceId, accountId).catch(() => retry());
  }

  return Object.freeze({ connect, stop, suspend, wake, status,
    isActive: () => wantsConnection, deviceId: () => deviceId, accountId: () => accountId });
}
