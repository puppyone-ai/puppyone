#!/usr/bin/env node
/**
 * The "Desktop" of one computer, for two-computer acceptance against the real
 * qubits deployment. It is the only holder of the person's session, controls
 * this computer's Host service over its local control channel, and opens the
 * other computer's folders with the Desktop's real remote clients.
 *
 * Test-only stand-in: sign-in is a Supabase password grant instead of the
 * Desktop's browser sign-in. Everything after the token is the Desktop's code.
 *
 * Protocol: one JSON command per stdin line `{id, command, ...args}`; replies
 * `{id, ok, result|error}`; unsolicited `{event, ...}`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { connectControlClient } from "/desktop/electron/host-service/control.mjs";
import { requestCloudApi } from "/desktop/electron/main/cloud-api-client.mjs";
import { createRemoteHostClient } from "/desktop/electron/main/hosts/remote-host-client.mjs";
import { createRemoteExecClient } from "/desktop/electron/main/hosts/remote-exec-client.mjs";
import { createHostSshClient } from "/desktop/electron/main/hosts/ssh/host-ssh-client.mjs";

const env = process.env;
const apiBase = env.ACCEPT_API;
const stateDir = env.ACCEPT_STATE;
const folderRoot = env.ACCEPT_FOLDER;
const computer = env.ACCEPT_NAME;
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

// --- test-only sign-in -------------------------------------------------------
let token = null, refreshToken = null, expiresAt = 0, userId = null;
async function grant(kind, body) {
  const response = await fetch(`${env.ACCEPT_SUPABASE_URL}/auth/v1/token?grant_type=${kind}`, {
    method: "POST", headers: { apikey: env.ACCEPT_SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  token = value.access_token; refreshToken = value.refresh_token; userId = value.user.id;
  expiresAt = Date.now() + (value.expires_in - 120) * 1000;
}
async function fresh() {
  if (!token) await grant("password", { email: env.ACCEPT_EMAIL, password: env.ACCEPT_PASSWORD });
  else if (Date.now() > expiresAt) await grant("refresh_token", { refresh_token: refreshToken });
}
await fresh();
const session = () => ({ user_id: userId, api_base_url: apiBase, session_generation: "accept" });
const expectedSession = () => ({ userId, generation: "accept" });
const authorized = (init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

// --- Main's credential holder, as the remote clients see it ------------------
const auth = {
  async requestSessionApi(base, route, init = {}) { await fresh(); return requestCloudApi(base, route, authorized(init)); },
  async openHostTunnelSocket(_base, socketUrl, _expected, WebSocketImpl = globalThis.WebSocket) {
    await fresh();
    return new WebSocketImpl(socketUrl, ["version.v1", `version.bearer.${token}`]);
  },
};
// As in Main: one SSH connection per remote folder carries files, terminals and Agents.
const ssh = createHostSshClient({ auth, apiBase, logger: { warn() {} } });
const remoteHost = createRemoteHostClient({ auth, apiBase, ssh });
const remoteExec = createRemoteExecClient({ auth, apiBase, ssh });

// --- this computer's Host service --------------------------------------------
const desktop = await connectControlClient({ stateDir, role: "desktop", logger: { warn() {} },
  onEvent: (event, data) => emit({ event: `host:${event}`, data }),
  handlers: {
    session: async () => session(),
    async api({ base, route, init }) {
      if (base !== apiBase) throw new Error("Wrong deployment.");
      await fresh();
      const result = await requestCloudApi(base, route, authorized({ method: init.method, headers: init.headers ?? {},
        body: init.body ?? undefined }));
      return result ?? null;
    },
  } });
await desktop.call("configure", { apiBase });

async function folderRevision(deviceId, folderId) {
  const catalog = await auth.requestSessionApi(apiBase, "/hosts", { method: "GET" });
  const device = catalog.devices.find((item) => item.id === deviceId);
  return device.folders.find((item) => item.id === folderId).revision;
}
const patchFolder = (deviceId, folderId, body) => auth.requestSessionApi(apiBase,
  `/hosts/devices/${deviceId}/folders/${folderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) });

const watches = new Map();
const terminals = new Map();
const time = async (fn) => { const started = performance.now(); const result = await fn(); return { result, ms: performance.now() - started }; };

const commands = {
  whoami: async () => ({ userId, computer }),
  status: () => desktop.call("status"),
  async share({ writable = true, name }) {
    const { deviceId, accountId } = await desktop.call("identityRegister",
      { name: computer, platform: process.platform, expectedSession: expectedSession() });
    const { folderId } = await desktop.call("registryRegister", { deviceId, rootPath: folderRoot,
      name: name ?? path.basename(folderRoot), writable, expectedSession: expectedSession() });
    await desktop.call("connect", { accountId, deviceId });
    return { deviceId, folderId, accountId };
  },
  async resume() {
    const existing = await desktop.call("identityExisting", { accountId: userId });
    if (!existing || !await desktop.call("registryHasActive", existing)) return { deviceId: null };
    await desktop.call("connect", existing);
    return existing;
  },
  // host:set-execution in electron/main/ipc/host-ipc.mjs, the person having clicked Allow.
  async setExecution({ deviceId, folderId, terminal = false, git = false, agent = false }) {
    const wanted = { terminal, git, agent };
    const status = await desktop.call("status");
    const row = status.folders.find((item) => item.folderId === folderId);
    const revision = await folderRevision(deviceId, folderId);
    const widening = (terminal && !row.execution?.terminal) || (git && !row.execution?.git) || (agent && !row.execution?.agent);
    const update = () => patchFolder(deviceId, folderId, { name: row.name, writable: row.writable,
      expected_revision: revision, ...wanted });
    const local = { accountId: userId, deviceId, folderId, ...wanted };
    if (widening) { const result = await update(); await desktop.call("registrySetExecution", local); return result; }
    await desktop.call("registrySetExecution", local);
    return update();
  },
  // host:update-folder: narrow locally first, widen locally only after the backend agreed.
  async setAccess({ deviceId, folderId, writable }) {
    const status = await desktop.call("status");
    const row = status.folders.find((item) => item.folderId === folderId);
    const execution = writable ? row.execution : { terminal: false, git: false, agent: false };
    const access = { accountId: userId, deviceId, folderId, name: row.name, writable };
    if (!writable) await desktop.call("registrySetAccess", access);
    const result = await patchFolder(deviceId, folderId, { name: row.name, writable,
      expected_revision: await folderRevision(deviceId, folderId), ...execution });
    if (writable) await desktop.call("registrySetAccess", access);
    return result;
  },
  unshare: ({ deviceId, folderId }) => desktop.call("registryRemove", { deviceId, folderId }),
  stopSharing: () => desktop.call("stopSharing"),
  // Owner-side API, as Desktop's settings would call it.
  api: async ({ method = "GET", route, body }) => { await fresh();
    return requestCloudApi(apiBase, route, authorized({ method, headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined })); },
  catalog: () => auth.requestSessionApi(apiBase, "/hosts", { method: "GET" }),
  // The other computer's folder, through the Desktop's real remote client.
  remote: ({ folderId, request }) => time(() => remoteHost.request(folderId, request, expectedSession())),
  watch({ folderId }) {
    const controller = new AbortController();
    watches.set(folderId, controller);
    void remoteHost.watch(folderId, expectedSession(), async (event) => emit({ event: "watch", folderId, at: Date.now(), ...event }),
      controller.signal).then(() => emit({ event: "watch-ended", folderId }));
    return true;
  },
  unwatch({ folderId }) { watches.get(folderId)?.abort(); watches.delete(folderId); return true; },
  async execOpen({ folderId, cols = 120, rows = 30 }) {
    const id = `t-${randomUUID().slice(0, 8)}`;
    const record = { output: "", events: [] };
    terminals.set(id, record);
    await remoteExec.open({ id, folderId, kind: "shell", launcher: "shell", cols, rows, expectedSession: expectedSession() },
      (event) => {
        if (event.type === "output") record.output += event.data;
        else { record.events.push(event); emit({ event: "terminal", id, ...event }); }
      });
    return { id };
  },
  execInput: ({ terminal, data }) => remoteExec.input(terminal, data),
  execRead: ({ terminal }) => terminals.get(terminal) ?? null,
  execClose: ({ terminal }) => remoteExec.close(terminal),
  // This computer's own folder, as its owner edits it locally.
  async local({ op, path: relative, content_base64 }) {
    const target = path.join(folderRoot, relative ?? "");
    if (op === "write") { await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(content_base64, "base64")); return true; }
    if (op === "read") return (await fs.readFile(target)).toString("base64");
    if (op === "exists") return fs.access(target).then(() => true, () => false);
    if (op === "list") return fs.readdir(target);
    throw new Error("Unknown local op");
  },
};

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.command === "quit") { desktop.close(); emit({ id: request.id, ok: true, result: {} }); process.exit(0); }
  try {
    const handler = commands[request.command];
    if (!handler) throw new Error(`Unknown command ${request.command}`);
    emit({ id: request.id, ok: true, result: (await handler(request)) ?? null });
  } catch (error) {
    emit({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error),
      status: error?.status ?? null });
  }
});
lines.on("close", () => { desktop.close(); process.exit(0); });
emit({ event: "started", computer, userId });
