import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerHostIpcHandlers } from "../../../../electron/main/ipc/host-ipc.mjs";
import { connectControlClient } from "../../../../electron/host-service/control.mjs";
import { runHostService } from "../../../../electron/host-service/runtime.mjs";

const apiBase = "https://api.puppyone.ai/api/v1";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const device = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const epoch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const cleanup = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
// Test stand-in for the OS key store. NOT encryption.
const secureStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value),
  decryptString: (bytes) => bytes.toString() };

async function temporaryRoot() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-host-ipc-")));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/** The Cloud as the host service sees it: only the device-signed challenge. */
function deviceChallenges() {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers });
    return { ok: true, status: 200, text: async () => JSON.stringify({
      challenge_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", epoch, nonce: "nonce" }) };
  };
  return { requests, fetchImpl };
}

/** A launcher like Desktop's, whose "spawn" starts the host service in this process. */
function inProcessHostService(stateDir, fetchImpl, { detect = async () => null } = {}) {
  const running = { host: null, starts: 0 };
  const start = async () => {
    running.starts++;
    running.host = await runHostService({ stateDir, secureStorage, appVersion: "0.0.0-test", logger: { warn() {} },
      WebSocketImpl: FakeWebSocket, fetchImpl, detect });
  };
  const stop = async () => { await running.host?.close(); running.host = null; };
  cleanup.push(stop);
  const tryConnect = async (options) => {
    try { return await connectControlClient({ stateDir, role: "desktop", logger: { warn() {} }, ...options }); } catch { return null; }
  };
  return { running, start, stop, launcher: { tryConnect,
    hasState: async () => fs.access(path.join(stateDir, "host-sharing.json")).then(() => true, () => false),
    ensure: async (options) => (await tryConnect(options)) ?? (await start(), tryConnect(options)) } };
}

function desktop({ userData, launcher, session, answers = null }) {
  const listeners = new Set();
  const apiCalls = [];
  const auth = {
    readSession: async () => session.current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    async requestSessionApi(_base, route, init) {
      apiCalls.push({ route, method: init?.method ?? "GET" });
      if (route === "/hosts/devices") return { device_id: device };
      if (route === `/hosts/devices/${device}/folders`) return { folder_id: JSON.parse(init.body).folder_id };
      throw new Error(`unexpected ${route}`);
    },
  };
  const handlers = new Map();
  const marked = [];
  const prompts = [];
  const ipc = registerHostIpcHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    app: { getPath: () => userData }, auth, apiBase, logger: { warn() {} }, hostService: launcher,
    authorizeWorkspaceRoot: async (_event, root) => root,
    dialog: { showMessageBox: async (_window, options) => { prompts.push(options); return { response: answers?.shift() ?? 1 }; } },
    BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [] }, t: (id) => id,
    markWorkspaceShared: async (root, folderId) => { marked.push({ root, folderId }); } });
  cleanup.push(async () => ipc.dispose());
  return { handlers, ipc, apiCalls, marked, prompts,
    signIn(next) { session.current = next; for (const listener of listeners) listener(); },
    status: () => handlers.get("host:status")() };
}

describe("host IPC", () => {
  it("requires an admitted local root and explicit approval before registration", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    let promptCount = 0;
    const host = registerHostIpcHandlers({ ipcMain, app: { getPath: () => "/unused" },
      auth: { readSession: async () => ({ user_id: "a", session_generation: "one",
        api_base_url: "https://api.puppyone.ai/api/v1" }),
        requestSessionApi: async () => { throw new Error("must not contact cloud"); } },
      hostService: { tryConnect: async () => null, hasState: async () => false,
        ensure: async () => { throw new Error("must not start the host service"); } },
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
    // Nothing shared: status never starts a host service.
    expect((await handlers.get("host:status")()).state).toBe("off");
    host.dispose();
  });

  it("shares through the host service, which keeps sharing after Desktop quits and resumes on its own", async () => {
    const userData = await temporaryRoot();
    const stateDir = path.join(userData, "host-service");
    const folder = path.join(userData, "Notes");
    await fs.mkdir(folder);
    const cloud = deviceChallenges();
    const service = inProcessHostService(stateDir, cloud.fetchImpl);
    const session = { current: { user_id: owner, session_generation: "one", api_base_url: apiBase } };

    const first = desktop({ userData, launcher: service.launcher, session });
    expect(await first.handlers.get("host:register-folder")({ sender: {} }, { rootPath: folder }))
      .toMatchObject({ deviceId: device });
    expect(service.running.starts).toBe(1);
    expect((await first.status()).state).toBe("online");
    expect((await first.status()).folders).toEqual([expect.objectContaining({ name: "Notes", writable: false })]);
    // Desktop ran the person's Cloud calls; the host service asked only for its device challenge.
    expect(first.apiCalls.map(({ route }) => route)).toEqual(["/hosts/devices", `/hosts/devices/${device}/folders`]);
    expect(cloud.requests).toEqual([{ url: `${apiBase}/hosts/devices/${device}/device-challenge`,
      headers: { "Content-Type": "application/json" } }]);
    expect(first.marked).toEqual([{ root: folder, folderId: expect.any(String) }]);
    // The device key and the local root live with the host service, not the App.
    await expect(fs.access(path.join(stateDir, "host-device-identity.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(userData, "host-device-identity.json"))).rejects.toThrow();
    expect((await fs.stat(stateDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(stateDir, "control-token"))).mode & 0o777).toBe(0o600);

    // Desktop quits: sharing continues.
    first.ipc.dispose();
    await settle();
    expect(service.running.host.service.status().state).toBe("online");

    // The host service restarts with nobody signed in and no Desktop: it resumes by itself.
    await service.stop();
    await service.start();
    await settle();
    expect(service.running.host.service.status().state).toBe("online");
    expect(cloud.requests).toHaveLength(2);

    // A new Desktop finds it running and does not start another.
    const second = desktop({ userData, launcher: service.launcher, session });
    expect((await second.status()).state).toBe("online");
    expect(service.running.starts).toBe(2);
  });

  it("stops sharing when the person here signs out or switches accounts, and resumes for the owner", async () => {
    const userData = await temporaryRoot();
    const folder = path.join(userData, "Notes");
    await fs.mkdir(folder);
    const cloud = deviceChallenges();
    const service = inProcessHostService(path.join(userData, "host-service"), cloud.fetchImpl);
    const session = { current: { user_id: owner, session_generation: "one", api_base_url: apiBase } };
    const app = desktop({ userData, launcher: service.launcher, session });
    await app.handlers.get("host:register-folder")({ sender: {} }, { rootPath: folder });
    expect((await app.status()).state).toBe("online");

    // A new session for the same person does not interrupt sharing.
    app.signIn({ ...session.current, session_generation: "two" });
    await settle();
    expect((await app.status()).state).toBe("online");

    // Signing out here stops sharing (not a revocation: the identity stays).
    app.signIn(null);
    await settle();
    expect((await app.status()).state).toBe("off");
    expect(FakeWebSocket.opened.at(-1).readyState).toBe(3);
    // And it stays stopped across a host service restart.
    await service.stop();
    await service.start();
    await settle();
    expect(service.running.host.service.status().state).toBe("off");

    // Someone else signing in does not resume it; the owner signing back in does.
    app.signIn({ user_id: other, session_generation: "three", api_base_url: apiBase });
    await settle();
    await expect(app.handlers.get("host:connect")({}, { userId: other, generation: "three" }))
      .resolves.toEqual({ deviceId: null });
    expect((await app.status()).state).toBe("off");
    app.signIn({ user_id: owner, session_generation: "four", api_base_url: apiBase });
    await settle();
    expect(await app.handlers.get("host:connect")({}, { userId: owner, generation: "four" })).toEqual({ deviceId: device });
    expect((await app.status()).state).toBe("online");
  });

  it("lets the host service run only host routes with the person's session, and only for this deployment", async () => {
    const userData = await temporaryRoot();
    const stateDir = path.join(userData, "host-service");
    const service = inProcessHostService(stateDir, deviceChallenges().fetchImpl);
    const session = { current: { user_id: owner, session_generation: "one", api_base_url: apiBase } };
    const app = desktop({ userData, launcher: service.launcher, session });
    // Start the host service the way sharing would, then call Desktop back from it.
    await service.start();
    await app.handlers.get("host:set-sharing-paused")({}, { paused: true, expectedSession: { userId: owner, generation: "one" } });
    const [peer] = service.running.host.control.peers();
    expect(await peer.call("session")).toEqual({ user_id: owner, session_generation: "one", api_base_url: apiBase });
    await expect(peer.call("api", { base: apiBase, route: "/ai/balance", init: { method: "GET" } })).rejects.toThrow("not available");
    await expect(peer.call("api", { base: "https://evil.example/api/v1", route: "/hosts/devices",
      init: { method: "POST" } })).rejects.toThrow("not available");
    await expect(peer.call("api", { base: apiBase, route: "/hosts", init: { method: "GET" } })).rejects.toThrow("not available");
    expect(app.apiCalls).toEqual([]);
    expect((await app.status()).paused).toBe(true);
  });

  it("keeps the whole-computer tier separate, confirmed here, and refuses running where there is no sandbox", async () => {
    const userData = await temporaryRoot();
    const folder = path.join(userData, "Notes");
    await fs.mkdir(folder);
    const service = inProcessHostService(path.join(userData, "host-service"), deviceChallenges().fetchImpl);
    const session = { current: { user_id: owner, session_generation: "one", api_base_url: apiBase } };
    const expectedSession = { userId: owner, generation: "one" };
    const app = desktop({ userData, launcher: service.launcher, session });
    const { folderId } = await app.handlers.get("host:register-folder")({ sender: {} }, { rootPath: folder, writable: true });
    expect(await app.status()).toMatchObject({ sandbox: null, wholeComputer: false });

    // No sandbox here: turning on a terminal explains why it cannot run, and changes nothing.
    app.prompts.length = 0;
    expect(await app.handlers.get("host:set-execution")({ sender: {} }, { deviceId: device, folderId, terminal: true,
      git: false, agent: false, expectedRevision: 1, expectedSession })).toEqual({ cancelled: true, reason: "sandbox_unavailable" });
    expect(app.prompts.map((prompt) => prompt.message)).toEqual(["native.host.execution.unavailable"]);
    expect(app.apiCalls.some(({ method }) => method === "PATCH")).toBe(false);

    // The whole computer is its own switch, behind its own confirmation; declining keeps it off.
    const declined = desktop({ userData, launcher: service.launcher, session, answers: [0] });
    expect(await declined.handlers.get("host:set-whole-computer")({ sender: {} }, { enabled: true, expectedSession }))
      .toEqual({ cancelled: true });
    expect((await app.status()).wholeComputer).toBe(false);
    app.prompts.length = 0;
    expect(await app.handlers.get("host:set-whole-computer")({ sender: {} }, { enabled: true, expectedSession }))
      .toEqual({ wholeComputer: true });
    expect(app.prompts.map((prompt) => prompt.title)).toEqual(["native.host.whole.title"]);
    expect((await app.status()).wholeComputer).toBe(true);
    // It survives a restart of the host service, and turning it off needs no confirmation.
    await service.stop();
    await service.start();
    expect((await app.status()).wholeComputer).toBe(true);
    app.prompts.length = 0;
    expect(await app.handlers.get("host:set-whole-computer")({ sender: {} }, { enabled: false, expectedSession }))
      .toEqual({ wholeComputer: false });
    expect(app.prompts).toEqual([]);
  });

  it("asks about the sandboxed tier, not the whole computer, where a sandbox exists", async () => {
    const userData = await temporaryRoot();
    const folder = path.join(userData, "Notes");
    await fs.mkdir(folder);
    const service = inProcessHostService(path.join(userData, "host-service"), deviceChallenges().fetchImpl,
      { detect: async () => ({ mechanism: "seatbelt", path: "/usr/bin/sandbox-exec" }) });
    const session = { current: { user_id: owner, session_generation: "one", api_base_url: apiBase } };
    const app = desktop({ userData, launcher: service.launcher, session, answers: [1, 0] });
    const { folderId } = await app.handlers.get("host:register-folder")({ sender: {} }, { rootPath: folder, writable: true });
    expect((await app.status()).sandbox).toBe("seatbelt");
    app.prompts.length = 0;
    expect(await app.handlers.get("host:set-execution")({ sender: {} }, { deviceId: device, folderId, terminal: true,
      git: false, agent: false, expectedRevision: 1, expectedSession: { userId: owner, generation: "one" } }))
      .toEqual({ cancelled: true });
    expect(app.prompts).toEqual([expect.objectContaining({ message: "native.host.execution.sandboxed",
      detail: "native.host.execution.sandboxedDetail" })]);
  });
});
