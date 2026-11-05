import { describe, expect, it } from "vitest";
import {
  createHostConnector,
  deviceChallengeRequestPayload,
  deviceSocketUrl,
  HOST_PROTOCOL_VERSION,
} from "../../../../electron/main/hosts/host-connector.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const device = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const folder = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const challenge = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const epoch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const request = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const apiBase = "https://api.puppyone.ai/api/v1";

class FakeWebSocket {
  static OPEN = 1;
  static last;
  constructor(url) {
    this.url = url; this.readyState = 1; this.listeners = new Map(); this.sent = [];
    FakeWebSocket.last = this;
    queueMicrotask(() => this.emit("open", {}));
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  emit(type, event) { this.listeners.get(type)?.(event); }
  send(data) {
    const value = JSON.parse(data); this.sent.push(value);
    if (value.signature) queueMicrotask(() => this.emit("message", { data: JSON.stringify({ type: "ready", epoch }) }));
  }
  close() { this.readyState = 3; this.emit("close", {}); }
}

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** The Cloud's device-challenge route; no human session is ever involved. */
function challengeRoute() {
  const route = { requests: [], refusal: null };
  route.fetchImpl = async (url, init) => {
    route.requests.push({ url, init, body: JSON.parse(init.body) });
    const refusal = typeof route.refusal === "function" ? route.refusal(route.requests.length) : route.refusal;
    return refusal ? reply(refusal.status, refusal.body) : reply(200, { challenge_id: challenge, epoch, nonce: "some-nonce" });
  };
  return route;
}

const signer = (seen = []) => ({ signForDevice: async (who, payload) => { seen.push({ who, payload }); return "signature"; } });

describe("host connector", () => {
  it("makes an outbound connection with only the device key, dispatches only registered files and stops", async () => {
    const route = challengeRoute();
    const signed = [];
    const registry = { resolve: async (id) => id === folder ? { rootPath: "/unused" } : null };
    const fileService = { run: async (message) => {
      expect(message).toMatchObject({ action: "read", path: "note.md", folder_id: folder });
      return { revision: "abc", content_base64: "bm90ZQ==" };
    } };
    const bootId = "abababab-abab-4bab-8bab-abababababab";
    const connector = createHostConnector({ apiBase, identity: signer(signed), registry, fileService,
      WebSocketImpl: FakeWebSocket, fetchImpl: route.fetchImpl, now: () => 1_800_000_000_500,
      appVersion: "1.4.0-beta.2", bootId });
    expect(await connector.connect(device, owner)).toEqual({ deviceId: device, epoch });

    // The challenge request is signed by the device and carries no Authorization header.
    const [asked] = route.requests;
    expect(asked.url).toBe(`${apiBase}/hosts/devices/${device}/device-challenge`);
    expect(asked.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(asked.body).toEqual({ owner, timestamp: 1_800_000_000, signature: "signature" });
    expect(signed[0]).toEqual({ who: { accountId: owner, deviceId: device },
      payload: deviceChallengeRequestPayload(owner, device, 1_800_000_000) });
    expect(signed[0].payload).toBe(`puppyone-device-challenge-v1\n${owner}\n${device}\n1800000000`);
    expect(signed[1].payload).toBe(`puppyone-device-v1\n${owner}\n${device}\n${challenge}\n${epoch}\nsome-nonce`);

    const socket = FakeWebSocket.last;
    expect(socket.sent[0]).toMatchObject({ owner, challenge_id: challenge, epoch, signature: "signature",
      protocol: HOST_PROTOCOL_VERSION, boot_id: bootId, app_version: "1.4.0-beta.2" });
    expect(socket.url).toBe(`wss://api.puppyone.ai/api/v1/hosts/devices/${device}/connect`);
    socket.emit("message", { data: JSON.stringify({ type: "file", id: request, folder_id: folder, action: "read", path: "note.md" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.sent.at(-1)).toEqual({ type: "reply", id: request, result: { revision: "abc", content_base64: "bm90ZQ==" } });
    expect(connector.accountId()).toBe(owner);
    connector.stop();
    expect(socket.readyState).toBe(3);
  });

  it("refuses to connect without a registered account and device", async () => {
    const connector = createHostConnector({ apiBase, identity: signer(), registry: {}, fileService: {},
      WebSocketImpl: FakeWebSocket, fetchImpl: challengeRoute().fetchImpl });
    await expect(connector.connect(device)).rejects.toThrow("unavailable");
    await expect(connector.connect("not-a-device", owner)).rejects.toThrow("unavailable");
    expect(connector.isActive()).toBe(false);
  });

  it("retries once with the Cloud's clock when this computer's clock is off", async () => {
    const route = challengeRoute();
    route.refusal = (count) => count === 1
      ? { status: 401, body: { detail: { code: "device_clock_skew", server_time: 2_000_000_000 } } } : null;
    const signed = [];
    const connector = createHostConnector({ apiBase, identity: signer(signed), registry: {}, fileService: {},
      WebSocketImpl: FakeWebSocket, fetchImpl: route.fetchImpl, now: () => 1_000_000_000_000 });
    await connector.connect(device, owner);
    expect(route.requests.map(({ body }) => body.timestamp)).toEqual([1_000_000_000, 2_000_000_000]);
    expect(connector.status().state).toBe("online");
    connector.stop();
  });

  it("never treats a bad signature, a clock that stays off or an unexplained 403 as revocation", async () => {
    for (const refusal of [
      { status: 401, body: { detail: { code: "device_proof_invalid" } } },
      { status: 401, body: { detail: { code: "device_clock_skew", server_time: 5 } } },
      { status: 403, body: { detail: "Forbidden" } },
    ]) {
      const route = challengeRoute();
      route.refusal = refusal;
      const revoked = [];
      const connector = createHostConnector({ apiBase, identity: signer(), registry: {}, fileService: {},
        logger: { warn() {} }, onRevoked: (lost) => revoked.push(lost), WebSocketImpl: FakeWebSocket,
        fetchImpl: route.fetchImpl });
      await expect(connector.connect(device, owner)).rejects.toThrow("refused");
      expect(revoked).toEqual([]);
      // Still sharing: it keeps the identity and retries with backoff.
      expect(connector.isActive()).toBe(true);
      expect(connector.status().state).toBe("offline");
      connector.stop();
    }
  });

  it("stops for good on a revocation close or a device_revoked refusal, but retries an outage", async () => {
    const route = challengeRoute();
    const revoked = [];
    const connector = createHostConnector({ apiBase, onRevoked: (lost) => revoked.push(lost),
      identity: signer(), logger: { warn() {} }, registry: { resolve: async () => null }, fileService: {},
      WebSocketImpl: FakeWebSocket, fetchImpl: route.fetchImpl });
    await connector.connect(device, owner);
    FakeWebSocket.last.readyState = 3;
    FakeWebSocket.last.emit("close", { code: 4004 });
    expect(revoked).toEqual([{ accountId: owner, deviceId: device }]);
    expect(connector.isActive()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(route.requests).toHaveLength(1);

    route.refusal = { status: 503, body: { detail: { code: "device_unavailable" } } };
    await expect(connector.connect(device, owner)).rejects.toThrow("refused");
    expect(connector.isActive()).toBe(true);
    route.refusal = { status: 403, body: { detail: { code: "device_revoked" } } };
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(route.requests).toHaveLength(3);
    expect(revoked).toHaveLength(2);
    expect(connector.isActive()).toBe(false);
  });

  it("serves watch subscriptions and releases them on unwatch and on close", async () => {
    const stopped = [];
    let emit;
    const fileService = { watch: async (folderId, onEvent) => {
      expect(folderId).toBe(folder);
      emit = onEvent;
      return () => stopped.push(folderId);
    } };
    const connector = createHostConnector({ apiBase, fileService, logger: { warn() {} }, identity: signer(),
      registry: { resolve: async (id) => id === folder ? { rootPath: "/unused" } : null },
      WebSocketImpl: FakeWebSocket, fetchImpl: challengeRoute().fetchImpl });
    await connector.connect(device, owner);
    const socket = FakeWebSocket.last;
    const subscription = "abababab-abab-4bab-8bab-abababababab";
    socket.emit("message", { data: JSON.stringify({ type: "watch", subscription, folder_id: folder }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connector.status()).toMatchObject({ state: "online", watching: 1 });
    emit({ paths: ["note.md"], reset: false });
    expect(socket.sent.at(-1)).toEqual({ type: "event", subscription, paths: ["note.md"], reset: false });
    socket.emit("message", { data: JSON.stringify({ type: "unwatch", subscription }) });
    expect(stopped).toEqual([folder]);
    socket.emit("message", { data: JSON.stringify({ type: "watch", subscription, folder_id: folder }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    connector.stop();
    expect(stopped).toEqual([folder, folder]);
    expect(connector.status().state).toBe("off");
  });

  it("follows system sleep: drops the socket on suspend and reconnects at once on wake", async () => {
    const route = challengeRoute();
    const connector = createHostConnector({ apiBase, logger: { warn() {} }, identity: signer(),
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: FakeWebSocket,
      fetchImpl: route.fetchImpl });
    await connector.connect(device, owner);
    const first = FakeWebSocket.last;
    connector.suspend();
    expect(first.readyState).toBe(3);
    expect(connector.status().state).toBe("offline");
    expect(connector.isActive()).toBe(true);
    connector.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(route.requests).toHaveLength(2);
    expect(FakeWebSocket.last).not.toBe(first);
    expect(connector.status().state).toBe("online");
    connector.stop();
  });

  it("stops and asks for an update when the Cloud no longer serves its protocol", async () => {
    const route = challengeRoute();
    class OutdatedSocket extends FakeWebSocket {
      send(data) {
        this.sent.push(JSON.parse(data));
        queueMicrotask(() => { this.readyState = 3; this.emit("close", { code: 4005 }); });
      }
    }
    const revoked = [];
    const connector = createHostConnector({ apiBase, logger: { warn() {} }, appVersion: "not a version!",
      identity: signer(), onRevoked: (lost) => revoked.push(lost),
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: OutdatedSocket,
      fetchImpl: route.fetchImpl });
    await expect(connector.connect(device, owner)).rejects.toThrow();
    // An unexpected App version string is sent as "unknown" rather than blocking the connection.
    expect(FakeWebSocket.last.sent[0].app_version).toBe("unknown");
    expect(connector.status().state).toBe("outdated");
    expect(connector.isActive()).toBe(false);
    connector.wake();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(route.requests).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it("uses a dedicated gateway address only inside the PuppyOne host family", () => {
    expect(deviceSocketUrl(apiBase, device, undefined)).toBe(`wss://api.puppyone.ai/api/v1/hosts/devices/${device}/connect`);
    expect(deviceSocketUrl(apiBase, device, `https://devices.puppyone.ai/api/v1/hosts/devices/${device}/connect`))
      .toBe(`wss://devices.puppyone.ai/api/v1/hosts/devices/${device}/connect`);
    expect(() => deviceSocketUrl(apiBase, device, `https://evil.example/api/v1/hosts/devices/${device}/connect`)).toThrow();
    expect(() => deviceSocketUrl(apiBase, device, `http://devices.puppyone.ai/api/v1/hosts/devices/${device}/connect`)).toThrow();
    expect(() => deviceSocketUrl(apiBase, device, `https://devices.puppyone.ai/api/v1/hosts/devices/${folder}/connect`)).toThrow();
  });

  it("reconnects with a fresh challenge after an unexpected socket close", async () => {
    const route = challengeRoute();
    const connector = createHostConnector({ apiBase, identity: signer(),
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: FakeWebSocket,
      fetchImpl: route.fetchImpl });
    await connector.connect(device, owner);
    const first = FakeWebSocket.last;
    first.close();
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(route.requests).toHaveLength(2);
    expect(FakeWebSocket.last).not.toBe(first);
    connector.stop();
  });
});
