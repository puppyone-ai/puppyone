import { describe, expect, it } from "vitest";
import { createHostConnector } from "../../../../electron/main/hosts/host-connector.mjs";

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
    const fileService = { read: async () => ({ revision: "abc", content_base64: "bm90ZQ==" }) };
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
});
