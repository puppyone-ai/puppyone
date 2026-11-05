import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerHostIpcHandlers } from "../../../../electron/main/ipc/host-ipc.mjs";

const apiBase = "https://api.puppyone.ai/api/v1";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const device = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const epoch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

class FakeWebSocket {
  static OPEN = 1;
  static opened = [];
  constructor(url) {
    this.url = url; this.readyState = 1; this.listeners = new Map();
    FakeWebSocket.opened.push(this);
    queueMicrotask(() => this.listeners.get("open")?.({}));
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  send(data) {
    if (JSON.parse(data).signature) {
      queueMicrotask(() => this.listeners.get("message")?.({ data: JSON.stringify({ type: "ready", epoch }) }));
    }
  }
  close() { this.readyState = 3; this.listeners.get("close")?.({}); }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("host IPC", () => {
  it("shares with the device key while its owner is signed in here, and stops on sign-out", async () => {
    const userData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-ipc-")));
    const folder = path.join(userData, "Notes");
    await fs.mkdir(folder);
    roots.push(userData);
    let session = { user_id: owner, session_generation: "one", api_base_url: apiBase };
    const listeners = new Set();
    const signIn = (next) => { session = next; for (const listener of listeners) listener(); };
    const auth = {
      readSession: async () => session,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      async requestSessionApi(_base, route, init) {
        if (route === "/hosts/devices") return { device_id: device };
        if (route === `/hosts/devices/${device}/folders`) return { folder_id: JSON.parse(init.body).folder_id };
        throw new Error(`unexpected ${route}`);
      },
    };
    const challenges = [];
    const fetchImpl = async (url, init) => {
      challenges.push({ url, headers: init.headers });
      return { ok: true, status: 200, text: async () => JSON.stringify({
        challenge_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", epoch, nonce: "nonce" }) };
    };
    const handlers = new Map();
    const host = registerHostIpcHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      app: { getPath: () => userData }, auth, apiBase, logger: { warn() {} },
      secureStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value),
        decryptString: (bytes) => bytes.toString() },
      authorizeWorkspaceRoot: async (_event, root) => root,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [] }, t: (id) => id,
      WebSocketImpl: FakeWebSocket, fetchImpl });
    const status = () => handlers.get("host:status")();

    expect(await handlers.get("host:register-folder")({ sender: {} }, { rootPath: folder }))
      .toMatchObject({ deviceId: device });
    expect((await status()).state).toBe("online");
    // The connection asked for its challenge with the device key, not the person's token.
    expect(challenges).toEqual([{ url: `${apiBase}/hosts/devices/${device}/device-challenge`,
      headers: { "Content-Type": "application/json" } }]);

    // A new session for the same person does not interrupt sharing.
    signIn({ ...session, session_generation: "two" });
    await settle();
    expect((await status()).state).toBe("online");

    // Signing out here stops sharing (not a revocation: the identity stays).
    signIn(null);
    await settle();
    expect((await status()).state).toBe("off");
    expect(FakeWebSocket.opened.at(-1).readyState).toBe(3);

    // Someone else signing in does not resume it; the owner signing back in does.
    signIn({ user_id: other, session_generation: "three", api_base_url: apiBase });
    await settle();
    await expect(handlers.get("host:connect")({}, { userId: other, generation: "three" }))
      .resolves.toEqual({ deviceId: null });
    expect((await status()).state).toBe("off");
    signIn({ user_id: owner, session_generation: "four", api_base_url: apiBase });
    expect(await handlers.get("host:connect")({}, { userId: owner, generation: "four" })).toEqual({ deviceId: device });
    expect((await status()).state).toBe("online");
    expect(challenges).toHaveLength(2);
    host.dispose();
  });

  it("requires an admitted local root and explicit approval before registration", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    let promptCount = 0;
    const host = registerHostIpcHandlers({ ipcMain, app: { getPath: () => "/unused" },
      auth: { readSession: async () => ({ user_id: "a", session_generation: "one",
        api_base_url: "https://api.puppyone.ai/api/v1" }),
        requestSessionApi: async () => { throw new Error("must not contact cloud"); } },
      apiBase: "https://api.puppyone.ai/api/v1", authorizeWorkspaceRoot: async (_event, root) => {
        if (root !== "/authorized") throw new Error("Unauthorized root");
        return root;
      }, dialog: { showMessageBox: async () => { promptCount++; return { response: 0 }; } },
      BrowserWindow: { fromWebContents: () => ({}) }, t: (id) => id });
    const event = { sender: {} };
    await expect(handlers.get("host:register-folder")(event, { rootPath: "/etc" })).rejects.toThrow("Unauthorized root");
    expect(promptCount).toBe(0);
    expect(await handlers.get("host:register-folder")(event, { rootPath: "/authorized" })).toEqual({ cancelled: true });
    expect(promptCount).toBe(1);
    host.dispose();
  });
});
