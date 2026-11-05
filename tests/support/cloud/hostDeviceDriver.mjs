#!/usr/bin/env node
/**
 * Headless host-side driver for cross-repository device-folder acceptance.
 *
 * Runs the real Electron-main host modules (device identity, local folder
 * registry, root-closed file service and outbound connector) under plain Node
 * against a LOOPBACK PuppyOne API. It is not a packaged App: Electron
 * safeStorage, windows, IPC and approval dialogs are replaced below.
 *
 * Protocol: one JSON command per stdin line `{id, command, ...args}`; one JSON
 * line per reply `{id, ok, result|error}` or unsolicited `{event, ...}` on stdout.
 */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createDeviceIdentityService } from "../../../electron/main/hosts/device-identity.mjs";
import { createHostFolderRegistry } from "../../../electron/main/hosts/host-folder-registry.mjs";
import { createHostFileService } from "../../../electron/main/hosts/host-file-service.mjs";
import { createHostConnector } from "../../../electron/main/hosts/host-connector.mjs";

const { HOST_E2E_API: apiBase, HOST_E2E_USER: userId, HOST_E2E_STATE: stateDir,
  HOST_E2E_FOLDER: folderRoot } = process.env;
if (!["127.0.0.1", "localhost"].includes(new URL(apiBase).hostname)) {
  throw new Error("The host driver only talks to a loopback API.");
}

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const session = { user_id: userId, api_base_url: apiBase, session_generation: "host-e2e" };
const expectedSession = { userId, generation: session.session_generation };
const auth = {
  readSession: async () => session,
  subscribe: () => () => {},
  async requestSessionApi(base, route, init = {}, expected = null) {
    if (expected && (expected.userId !== userId || expected.generation !== session.session_generation)) {
      throw new Error("Session changed.");
    }
    const response = await fetch(`${base}${route}`, { ...init,
      headers: { ...init.headers, Authorization: "Bearer host-e2e" } });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Request failed (${response.status}): ${text}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  },
};
// Test-only stand-in for Electron safeStorage. This is NOT encryption.
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "host-e2e",
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8"),
};

const identityFile = path.join(stateDir, "host-device-identity.json");
const registryFile = path.join(stateDir, "host-folder-registry.json");
const identity = createDeviceIdentityService({ filePath: identityFile, secureStorage, auth, apiBase });
const registry = createHostFolderRegistry({ filePath: registryFile, auth, apiBase });
let active = null;
const fileService = createHostFileService({ resolveFolder: (folderId) => active
  ? registry.resolve(folderId, active.accountId, active.deviceId) : null });
const connector = createHostConnector({ apiBase, auth, identity, registry, fileService,
  logger: { warn() {} }, appVersion: "0.0.0-e2e",
  onRevoked: (lost) => {
    active = null;
    void registry.forgetDevice(lost).then(() => identity.forget(lost))
      .then(() => emit({ event: "revoked", ...lost }), (error) => emit({ event: "cleanup_failed", error: error.message }));
  } });

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]"));
const commands = {
  async share({ writable = false }) {
    const { deviceId, accountId } = await identity.register("Host E2E", process.platform, expectedSession);
    const { folderId } = await registry.register({ deviceId, rootPath: folderRoot,
      name: path.basename(folderRoot), writable, expectedSession });
    active = { deviceId, accountId };
    if (!connector.isActive()) await connector.connect(deviceId);
    return { deviceId, folderId };
  },
  async resume() {
    const existing = await identity.existingForCurrentAccount();
    if (!existing || !await registry.hasActive(existing.accountId, existing.deviceId)) return { deviceId: null };
    active = existing;
    if (!connector.isActive()) await connector.connect(existing.deviceId);
    return { deviceId: existing.deviceId };
  },
  async unshare({ deviceId, folderId }) {
    return { removed: await registry.remove(deviceId, folderId) };
  },
  async state() {
    return { identities: (await readJson(identityFile)).length,
      folders: (await readJson(registryFile)).map(({ folderId, state }) => ({ folderId, state })) };
  },
};

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.command === "exit") {
    connector.stop();
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
lines.on("close", () => { connector.stop(); process.exit(0); });
emit({ event: "started" });
