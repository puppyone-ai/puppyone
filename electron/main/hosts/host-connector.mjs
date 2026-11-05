import { normalizeCloudApiBaseUrl, resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FRAME_CHARACTERS = 12 * 1024 * 1024;
const HEARTBEAT_MS = 10_000;
const MAX_WATCHES = 64;

/** Server close codes (host file protocol v1). */
export const CLOSE_REVOKED = 4004;
const FILE_ERRORS = new Set(["invalid_path", "not_found", "already_exists", "not_empty", "folder_unavailable",
  "root_changed", "unsupported_file", "too_many_entries", "invalid_content", "revision_required", "conflict"]);

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

/**
 * A signed, outbound-only device connection. No local listening port.
 *
 * Lifecycle: `connect` starts serving; transport loss retries with backoff;
 * `suspend`/`wake` follow system sleep; `stop` ends it; a definite revocation
 * (close 4004 or a 403 challenge) stops for good and calls `onRevoked`.
 */
export function createHostConnector({ apiBase, auth, identity, registry, fileService,
  WebSocketImpl = globalThis.WebSocket, logger = console, onRevoked = () => {}, onStatus = () => {} }) {
  const deployment = resolveCloudApiBaseUrl(apiBase);
  let socket = null;
  let heartbeat = null;
  let stopped = true;
  let accountId = null;
  let deviceId = null;
  let sessionGeneration = null;
  let unsubscribe = null;
  let wantsConnection = false;
  let retryTimer = null;
  let retryDelay = 1000;
  let state = "off";
  let lastAccessAt = null;
  let activeRequests = 0;
  const watches = new Map();

  function notify() {
    try { onStatus(status()); } catch { /* Status observers never control the connection. */ }
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    notify();
  }

  function status() {
    return { state, deviceId, activeRequests, watching: watches.size, lastAccessAt };
  }

  function stopWatches() {
    for (const stop of watches.values()) {
      try { stop(); } catch { /* A watcher that already ended has nothing to release. */ }
    }
    watches.clear();
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    stopWatches();
    const previous = socket;
    socket = null;
    if (previous && previous.readyState < 2) previous.close();
  }

  function stop() {
    wantsConnection = false; stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    close(); unsubscribe?.(); unsubscribe = null;
    setState("off");
  }

  // Only a definite server denial (socket close 4004 or a 403 challenge) means
  // revoked. Transport errors and 5xx keep retrying with the same identity.
  function revoked() {
    const lost = { accountId, deviceId };
    stop();
    try { onRevoked(lost); } catch (error) { logger.warn("Device revocation cleanup failed", error?.message); }
  }

  function retry() {
    if (!wantsConnection || retryTimer) return;
    setState("offline");
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30_000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void current().then(valid => {
        if (!valid) { stop(); return; }
        if (wantsConnection && stopped) void connect(deviceId).catch(() => retry());
      }).catch(() => stop());
    }, delay);
  }

  async function current() {
    const session = await auth.readSession();
    return session?.user_id === accountId && session?.session_generation === sessionGeneration &&
      session?.api_base_url === deployment;
  }

  function send(ws, frame) {
    if (ws === socket && ws.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify(frame));
  }

  async function handleFile(message, ws) {
    if (!UUID.test(message?.folder_id) || !UUID.test(message?.id) || !await current()) {
      stop(); return;
    }
    const folder = await registry.resolve(message.folder_id, accountId, deviceId);
    if (!folder) { send(ws, { type: "reply", id: message.id, error: "folder_unavailable" }); return; }
    activeRequests++; lastAccessAt = new Date().toISOString(); notify();
    try {
      const result = await fileService.run(message);
      if (await current()) send(ws, { type: "reply", id: message.id, result });
    } catch (error) {
      if (await current()) send(ws, { type: "reply", id: message.id,
        error: FILE_ERRORS.has(error?.code) ? error.code : "file_operation_failed" });
    } finally {
      activeRequests--; notify();
    }
  }

  async function handleWatch(message, ws) {
    const subscription = message?.subscription;
    if (!UUID.test(message?.folder_id) || !UUID.test(subscription) || !await current()) { stop(); return; }
    const ended = () => send(ws, { type: "event", subscription, paths: [], reset: true });
    if (watches.has(subscription) || watches.size >= MAX_WATCHES ||
        !await registry.resolve(message.folder_id, accountId, deviceId)) { ended(); return; }
    try {
      const stopWatch = await fileService.watch(message.folder_id, (event) => {
        send(ws, { type: "event", subscription, paths: event.paths, reset: event.reset });
      }, ended);
      if (ws !== socket) { stopWatch(); return; }
      watches.set(subscription, stopWatch);
      lastAccessAt = new Date().toISOString(); notify();
    } catch { ended(); }
  }

  function handleUnwatch(message) {
    const stopWatch = watches.get(message?.subscription);
    watches.delete(message?.subscription);
    stopWatch?.();
    notify();
  }

  async function connect(registeredDeviceId) {
    if (!UUID.test(registeredDeviceId) || !WebSocketImpl) throw new Error("Host connector unavailable.");
    if (!stopped) throw new Error("Host is already connecting.");
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    stopped = false;
    wantsConnection = true;
    setState("connecting");
    try {
    const session = await auth.readSession();
    if (!session?.user_id || session.api_base_url !== deployment) {
      stopped = true; throw new Error("Sign in before connecting this device.");
    }
    accountId = session.user_id;
    deviceId = registeredDeviceId;
    sessionGeneration = session.session_generation;
    const challenge = await auth.requestSessionApi(deployment, `/hosts/devices/${deviceId}/challenge`,
      { method: "POST" }, { userId: accountId, generation: sessionGeneration });
    if (stopped || !await current()) { stopped = true; throw new Error("Account changed during connection."); }
    if (![challenge.challenge_id, challenge.epoch].every((value) => UUID.test(value)) ||
        typeof challenge.nonce !== "string") throw new Error("Invalid device challenge.");
    const payload = `puppyone-device-v1\n${accountId}\n${deviceId}\n${challenge.challenge_id}\n${challenge.epoch}\n${challenge.nonce}`;
    const signature = await identity.signForCurrentAccount(deviceId, payload);
    if (stopped) throw new Error("Connection cancelled.");
    const ws = new WebSocketImpl(deviceSocketUrl(deployment, deviceId, challenge.connect_url));
    socket = ws;
    unsubscribe = auth.subscribe?.(() => { void current().then((valid) => { if (!valid) stop(); }); });
    return await new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { if (!ready) { close(); reject(new Error("Device connection timed out.")); } }, 15_000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ owner: accountId, challenge_id: challenge.challenge_id,
          epoch: challenge.epoch, nonce: challenge.nonce, signature }));
      });
      ws.addEventListener("message", (event) => {
        if (ws !== socket) return;
        let message;
        try {
          if (typeof event.data !== "string" || event.data.length > MAX_FRAME_CHARACTERS) throw new Error("Frame too large");
          message = JSON.parse(event.data);
        } catch { close(); return; }
        if (message?.type === "ready" && message.epoch === challenge.epoch && !ready) {
          ready = true; retryDelay = 1000; clearTimeout(timeout); setState("online");
          resolve({ deviceId, epoch: challenge.epoch });
          heartbeat = setInterval(() => send(ws, { type: "heartbeat" }), HEARTBEAT_MS);
        } else if (!ready) {
          close();
        } else if (message?.type === "file") {
          void handleFile(message, ws).catch(() => close());
        } else if (message?.type === "watch") {
          void handleWatch(message, ws).catch(() => close());
        } else if (message?.type === "unwatch") {
          handleUnwatch(message);
        }
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(timeout);
        if (socket === ws) {
          close(); unsubscribe?.(); unsubscribe = null; stopped = true;
          if (event?.code === CLOSE_REVOKED) revoked();
          else if (ready) retry();
        }
        if (!ready) reject(new Error("Device connection closed."));
      });
      ws.addEventListener("error", (error) => { logger.warn("Device connection error", error?.message ?? "unknown"); });
    });
    } catch (error) {
      stopped = true; close(); unsubscribe?.(); unsubscribe = null;
      if (error?.status === 403 && wantsConnection) revoked();
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
    close(); unsubscribe?.(); unsubscribe = null; stopped = true;
    if (previous) setState("offline");
  }

  /** Wake or network change: reconnect at once instead of waiting out the backoff. */
  function wake() {
    if (!wantsConnection || !stopped || !deviceId) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryDelay = 1000;
    void current().then((valid) => {
      if (!valid) { stop(); return; }
      if (wantsConnection && stopped) void connect(deviceId).catch(() => retry());
    }).catch(() => stop());
  }

  return Object.freeze({ connect, stop, suspend, wake, status,
    isActive: () => wantsConnection, deviceId: () => deviceId });
}
