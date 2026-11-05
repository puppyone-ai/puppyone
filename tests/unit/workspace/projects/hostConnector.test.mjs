import { describe, expect, it } from "vitest";
import { createHostConnector, deviceSocketUrl } from "../../../../electron/main/hosts/host-connector.mjs";

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

describe("host connector", () => {
  it("makes an outbound signed connection, dispatches only registered files and stops", async () => {
    const seen = [];
    const auth = {
      readSession: async () => ({ user_id: owner, api_base_url: apiBase, session_generation: "one" }),
      requestSessionApi: async (base, route, init, expected) => {
        seen.push({ base, route, init, expected });
        return { challenge_id: challenge, epoch, nonce: "some-nonce" };
      },
      subscribe: () => () => {},
    };
    const identity = { signForCurrentAccount: async (_device, payload) => {
      seen.push(payload); return "signature";
    } };
    const registry = { resolve: async (id) => id === folder ? { rootPath: "/unused" } : null };
    const fileService = { run: async (message) => {
      expect(message).toMatchObject({ action: "read", path: "note.md", folder_id: folder });
      return { revision: "abc", content_base64: "bm90ZQ==" };
    } };
    const connector = createHostConnector({ apiBase, auth, identity, registry, fileService, WebSocketImpl: FakeWebSocket });
    expect(await connector.connect(device)).toEqual({ deviceId: device, epoch });
    const socket = FakeWebSocket.last;
    expect(socket.url).toBe(`wss://api.puppyone.ai/api/v1/hosts/devices/${device}/connect`);
    expect(seen[0].expected).toEqual({ userId: owner, generation: "one" });
    expect(seen[1]).toContain(`puppyone-device-v1\n${owner}\n${device}\n${challenge}\n${epoch}\nsome-nonce`);
    socket.emit("message", { data: JSON.stringify({ type: "file", id: request, folder_id: folder, action: "read", path: "note.md" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.sent.at(-1)).toEqual({ type: "reply", id: request, result: { revision: "abc", content_base64: "bm90ZQ==" } });
    connector.stop();
    expect(socket.readyState).toBe(3);
  });

  it("stops for good on a revocation close or a refused challenge, but retries an outage", async () => {
    let challenges = 0;
    let refuse = null;
    const revoked = [];
    const auth = {
      readSession: async () => ({ user_id: owner, api_base_url: apiBase, session_generation: "one" }),
      requestSessionApi: async () => {
        challenges++;
        if (refuse) { const error = new Error("refused"); error.status = refuse; throw error; }
        return { challenge_id: challenge, epoch, nonce: "some-nonce" };
      },
      subscribe: () => () => {},
    };
    const connector = createHostConnector({ apiBase, auth, onRevoked: (lost) => revoked.push(lost),
      identity: { signForCurrentAccount: async () => "signature" }, logger: { warn() {} },
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: FakeWebSocket });
    await connector.connect(device);
    FakeWebSocket.last.readyState = 3;
    FakeWebSocket.last.emit("close", { code: 4004 });
    expect(revoked).toEqual([{ accountId: owner, deviceId: device }]);
    expect(connector.isActive()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(challenges).toBe(1);

    refuse = 503;
    await expect(connector.connect(device)).rejects.toThrow("refused");
    expect(connector.isActive()).toBe(true);
    refuse = 403;
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(challenges).toBe(3);
    expect(revoked).toHaveLength(2);
    expect(connector.isActive()).toBe(false);
  });

  it("serves watch subscriptions and releases them on unwatch and on close", async () => {
    const stopped = [];
    let emit;
    const auth = {
      readSession: async () => ({ user_id: owner, api_base_url: apiBase, session_generation: "one" }),
      requestSessionApi: async () => ({ challenge_id: challenge, epoch, nonce: "some-nonce" }),
      subscribe: () => () => {},
    };
    const fileService = { watch: async (folderId, onEvent) => {
      expect(folderId).toBe(folder);
      emit = onEvent;
      return () => stopped.push(folderId);
    } };
    const connector = createHostConnector({ apiBase, auth, fileService, logger: { warn() {} },
      identity: { signForCurrentAccount: async () => "signature" },
      registry: { resolve: async (id) => id === folder ? { rootPath: "/unused" } : null }, WebSocketImpl: FakeWebSocket });
    await connector.connect(device);
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
    let challenges = 0;
    const auth = {
      readSession: async () => ({ user_id: owner, api_base_url: apiBase, session_generation: "one" }),
      requestSessionApi: async () => { challenges++; return { challenge_id: challenge, epoch, nonce: "some-nonce" }; },
      subscribe: () => () => {},
    };
    const connector = createHostConnector({ apiBase, auth, logger: { warn() {} },
      identity: { signForCurrentAccount: async () => "signature" },
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: FakeWebSocket });
    await connector.connect(device);
    const first = FakeWebSocket.last;
    connector.suspend();
    expect(first.readyState).toBe(3);
    expect(connector.status().state).toBe("offline");
    expect(connector.isActive()).toBe(true);
    connector.wake();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(challenges).toBe(2);
    expect(FakeWebSocket.last).not.toBe(first);
    expect(connector.status().state).toBe("online");
    connector.stop();
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
    let challenges = 0;
    const auth = {
      readSession: async () => ({ user_id: owner, api_base_url: apiBase, session_generation: "one" }),
      requestSessionApi: async () => { challenges++; return { challenge_id: challenge, epoch, nonce: "some-nonce" }; },
      subscribe: () => () => {},
    };
    const connector = createHostConnector({ apiBase, auth,
      identity: { signForCurrentAccount: async () => "signature" },
      registry: { resolve: async () => null }, fileService: {}, WebSocketImpl: FakeWebSocket });
    await connector.connect(device);
    const first = FakeWebSocket.last;
    first.close();
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(challenges).toBe(2);
    expect(FakeWebSocket.last).not.toBe(first);
    connector.stop();
  });
});
