import { resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A signed, outbound-only device connection. No local listening port. */
export function createHostConnector({ apiBase, auth, identity, registry, fileService,
  WebSocketImpl = globalThis.WebSocket, logger = console }) {
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

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    const previous = socket;
    socket = null;
    if (previous && previous.readyState < 2) previous.close();
  }

  function stop() {
    wantsConnection = false; stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    close(); unsubscribe?.(); unsubscribe = null;
  }

  function retry() {
    if (!wantsConnection || retryTimer) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30_000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void current().then(valid => {
        if (!valid) { stop(); return; }
        if (wantsConnection) void connect(deviceId).catch(() => retry());
      }).catch(() => stop());
    }, delay);
  }

  async function current() {
    const session = await auth.readSession();
    return session?.user_id === accountId && session?.session_generation === sessionGeneration &&
      session?.api_base_url === deployment;
  }

  async function handleFile(message, ws) {
    if (!UUID.test(message?.folder_id) || !UUID.test(message?.id) || !await current()) {
      stop(); return;
    }
    const folder = await registry.resolve(message.folder_id, accountId, deviceId);
    if (!folder) {
      ws.send(JSON.stringify({ type: "reply", id: message.id, error: "folder_unavailable" }));
      return;
    }
    try {
      let result;
      if (message.action === "list" && typeof message.path === "string") {
        result = await fileService.list(message.folder_id, message.path);
      } else if (message.action === "read" && typeof message.path === "string") {
        result = await fileService.read(message.folder_id, message.path);
      } else if (message.action === "write" && typeof message.path === "string") {
        result = await fileService.write(message.folder_id, message.path,
          message.content_base64, message.expected_revision);
      } else throw new Error("Unsupported file operation");
      if (ws === socket && await current()) ws.send(JSON.stringify({ type: "reply", id: message.id, result }));
    } catch (error) {
      const allowed = new Set(["invalid_path", "folder_unavailable", "root_changed", "unsupported_file",
        "too_many_entries", "invalid_content", "revision_required", "conflict"]);
      if (ws === socket && await current()) ws.send(JSON.stringify({ type: "reply", id: message.id,
        error: allowed.has(error?.code) ? error.code : "file_operation_failed" }));
    }
  }

  async function connect(registeredDeviceId) {
    if (!UUID.test(registeredDeviceId) || !WebSocketImpl) throw new Error("Host connector unavailable.");
    if (!stopped) throw new Error("Host is already connecting.");
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    stopped = false;
    wantsConnection = true;
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
    const url = new URL(`${deployment}/hosts/devices/${deviceId}/connect`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocketImpl(url.toString());
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
          if (typeof event.data !== "string" || event.data.length > 12 * 1024 * 1024) throw new Error("Frame too large");
          message = JSON.parse(event.data);
        } catch { close(); return; }
        if (message.type === "ready" && message.epoch === challenge.epoch && !ready) {
          ready = true; retryDelay = 1000; clearTimeout(timeout); resolve({ deviceId, epoch: challenge.epoch });
          heartbeat = setInterval(() => { if (ws.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify({ type: "heartbeat" })); }, 10_000);
        } else if (message.type === "file" && ready) {
          void handleFile(message, ws).catch(() => close());
        }
      });
      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        if (socket === ws) {
          close(); unsubscribe?.(); unsubscribe = null; stopped = true;
          if (ready) retry();
        }
        if (!ready) reject(new Error("Device connection closed."));
      });
      ws.addEventListener("error", (error) => { logger.warn("Device connection error", error?.message ?? "unknown"); });
    });
    } catch (error) {
      stopped = true; close(); unsubscribe?.(); unsubscribe = null;
      if (wantsConnection) retry();
      throw error;
    }
  }

  return Object.freeze({ connect, stop, isActive: () => wantsConnection });
}
