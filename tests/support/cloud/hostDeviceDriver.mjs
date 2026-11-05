#!/usr/bin/env node
/**
 * Headless host-side driver for cross-repository device-folder acceptance.
 *
 * Runs the real Puppyone Host service (device identity, local folder registry,
 * root-closed file service and outbound device connection) and its control
 * channel under plain Node against a LOOPBACK PuppyOne API, with this driver as
 * its Desktop: the only holder of the person's session. It is not a packaged
 * App: Electron safeStorage, windows, IPC and approval dialogs are replaced below.
 *
 * Protocol: one JSON command per stdin line `{id, command, ...args}`; one JSON
 * line per reply `{id, ok, result|error}` or unsolicited `{event, ...}` on stdout.
 */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { connectControlClient } from "../../../electron/host-service/control.mjs";
import { runHostService } from "../../../electron/host-service/runtime.mjs";

const { HOST_E2E_API: apiBase, HOST_E2E_USER: userId, HOST_E2E_STATE: stateDir,
  HOST_E2E_FOLDER: folderRoot } = process.env;
if (!["127.0.0.1", "localhost"].includes(new URL(apiBase).hostname)) {
  throw new Error("The host driver only talks to a loopback API.");
}

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const session = { user_id: userId, api_base_url: apiBase, session_generation: "host-e2e" };
const expectedSession = { userId, generation: session.session_generation };
// Test-only stand-in for Electron safeStorage. This is NOT encryption.
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "host-e2e",
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8"),
};

const host = await runHostService({ stateDir, secureStorage, appVersion: "0.0.0-e2e", logger: { warn() {} } });
const desktop = await connectControlClient({ stateDir, role: "desktop", logger: { warn() {} },
  onEvent: (event, data) => {
    if (event === "revoked") emit({ event: "revoked", accountId: data.accountId, deviceId: data.deviceId });
  },
  handlers: {
    session: async () => session,
    async api({ base, route, init, expectedSession: expected }) {
      if (base !== apiBase) throw new Error("Wrong deployment.");
      if (expected && (expected.userId !== userId || expected.generation !== session.session_generation)) {
        throw new Error("Session changed.");
      }
      const response = await fetch(`${base}${route}`, { method: init.method,
        headers: { ...(init.headers ?? {}), Authorization: "Bearer host-e2e" }, body: init.body ?? undefined });
      const text = await response.text();
      if (!response.ok) {
        throw Object.assign(new Error(`Request failed (${response.status}): ${text}`), { status: response.status });
      }
      return text ? JSON.parse(text) : null;
    },
  } });
await desktop.call("configure", { apiBase });

const identityFile = path.join(stateDir, "host-device-identity.json");
const registryFile = path.join(stateDir, "host-folder-registry.json");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]"));
const commands = {
  async share({ writable = false }) {
    const { deviceId, accountId } = await desktop.call("identityRegister",
      { name: "Host E2E", platform: process.platform, expectedSession });
    const { folderId } = await desktop.call("registryRegister", { deviceId, rootPath: folderRoot,
      name: path.basename(folderRoot), writable, expectedSession });
    await desktop.call("connect", { accountId, deviceId });
    return { deviceId, folderId };
  },
  async resume() {
    const existing = await desktop.call("identityExisting", { accountId: userId });
    if (!existing || !await desktop.call("registryHasActive", existing)) return { deviceId: null };
    await desktop.call("connect", existing);
    return { deviceId: existing.deviceId };
  },
  async unshare({ deviceId, folderId }) {
    return { removed: await desktop.call("registryRemove", { deviceId, folderId }) };
  },
  async state() {
    return { identities: (await readJson(identityFile)).length,
      folders: (await readJson(registryFile)).map(({ folderId, state }) => ({ folderId, state })) };
  },
};
const stopAll = async () => { desktop.close(); await host.close(); };

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.command === "exit") {
    await stopAll();
    emit({ id: request.id, ok: true, result: {} });
    process.exit(0);
  }
  try {
    const handler = commands[request.command];
    if (!handler) throw new Error(`Unknown command ${request.command}`);
    emit({ id: request.id, ok: true, result: await handler(request) });
  } catch (error) {
    emit({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
lines.on("close", () => { void stopAll().finally(() => process.exit(0)); });
emit({ event: "started" });
