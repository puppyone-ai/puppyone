import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeviceIdentityService } from "../hosts/device-identity.mjs";
import { createHostFolderRegistry } from "../hosts/host-folder-registry.mjs";
import { createHostFileService } from "../hosts/host-file-service.mjs";
import { createHostFileProcess } from "../hosts/host-file-process.mjs";
import { createHostConnector } from "../hosts/host-connector.mjs";
import { createRemoteHostClient } from "../hosts/remote-host-client.mjs";
import { createHostRecents } from "../hosts/host-recents.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WATCHES_PER_WINDOW = 32;

function requireSession(expectedSession) {
  if (!expectedSession || typeof expectedSession.userId !== "string" ||
      typeof expectedSession.generation !== "string") throw new Error("Session required.");
  return { userId: expectedSession.userId, generation: expectedSession.generation };
}

/**
 * Main owns device keys, local roots and Cloud credentials. Renderers receive
 * only public IDs, folder names and status; file bytes cross IPC only for the
 * folder a renderer explicitly opened.
 */
export function registerHostIpcHandlers({ ipcMain, app, auth, secureStorage, apiBase,
  authorizeWorkspaceRoot, dialog, BrowserWindow, t, utilityProcess = null, powerMonitor = null,
  fileServiceModulePath = null, markWorkspaceShared = async () => {}, logger = console }) {
  let services = null;
  let recents = null;
  const recentFolders = () => {
    recents ??= createHostRecents({ filePath: path.join(app.getPath("userData"), "host-recent-folders.json") });
    return recents;
  };
  async function currentAccount(expectedSession) {
    const session = await auth.readSession();
    if (!apiBase || session?.user_id !== expectedSession.userId ||
        session?.session_generation !== expectedSession.generation) throw new Error("Account changed.");
    return { deployment: apiBase, accountId: session.user_id };
  }
  let active = null;
  let paused = null;
  const folderWatches = new Map();
  const statePath = () => path.join(app.getPath("userData"), "host-sharing.json");

  function broadcast(status) {
    for (const window of BrowserWindow.getAllWindows?.() ?? []) {
      if (!window.isDestroyed()) window.webContents.send("host:status-changed", status);
    }
  }

  async function isPaused() {
    if (paused !== null) return paused;
    try { paused = JSON.parse(await fs.readFile(statePath(), "utf8"))?.paused === true; }
    catch { paused = false; }
    return paused;
  }

  async function setPaused(value) {
    paused = value === true;
    const file = statePath();
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ paused }), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
  }

  function ensureServices() {
    if (!apiBase) throw new Error("Cloud is not configured.");
    if (services) return services;
    const base = app.getPath("userData");
    const identity = createDeviceIdentityService({ filePath: path.join(base, "host-device-identity.json"),
      secureStorage, auth, apiBase });
    const registry = createHostFolderRegistry({ filePath: path.join(base, "host-folder-registry.json"),
      auth, apiBase });
    const resolveFolder = (folderId) => active
      ? registry.resolve(folderId, active.accountId, active.deviceId) : null;
    // File work runs in a utility process when available; tests use the same service inline.
    const fileService = utilityProcess && fileServiceModulePath
      ? createHostFileProcess({ utilityProcess, modulePath: fileServiceModulePath, resolveFolder, logger })
      : createHostFileService({ resolveFolder });
    const connector = createHostConnector({ apiBase, auth, identity, registry, fileService, logger,
      onStatus: (status) => broadcast({ ...status, paused: paused === true }),
      onRevoked: (lost) => {
        if (active?.deviceId === lost.deviceId && active?.accountId === lost.accountId) active = null;
        // Deny locally first, then drop the key; a later share registers a new device.
        void (async () => {
          const shared = await registry.list(lost.accountId, lost.deviceId);
          await registry.forgetDevice(lost);
          for (const row of shared) await markWorkspaceShared(row.rootPath, null).catch(() => {});
          await identity.forget(lost);
        })().catch((error) => logger.warn("Revoked device cleanup failed", error?.message));
      } });
    services = { identity, registry, connector, fileService };
    return services;
  }

  // Opening another computer's folder needs no device key: it works even where
  // this computer cannot store one (and so cannot share its own folders).
  let remote = null;
  function remoteClient() {
    if (!apiBase) throw new Error("Cloud is not configured.");
    remote ??= createRemoteHostClient({ auth, apiBase });
    return remote;
  }

  async function connectIfShared(expectedSession) {
    const { identity, registry, connector } = ensureServices();
    const existing = await identity.existingForCurrentAccount();
    const latest = await auth.readSession();
    if (latest?.user_id !== expectedSession.userId || latest?.session_generation !== expectedSession.generation) {
      throw new Error("Account changed during connection.");
    }
    if (!existing || existing.accountId !== expectedSession.userId ||
        !await registry.hasActive(existing.accountId, existing.deviceId)) return { deviceId: null };
    const { deviceId, accountId } = existing;
    active = { deviceId, accountId };
    if (await isPaused()) return { deviceId, paused: true };
    if (!connector.isActive()) await connector.connect(deviceId);
    return { deviceId };
  }

  const onSuspend = () => services?.connector.suspend();
  const onResume = () => services?.connector.wake();
  powerMonitor?.on("suspend", onSuspend);
  powerMonitor?.on("resume", onResume);
  powerMonitor?.on("unlock-screen", onResume);

  ipcMain.handle("host:catalog", async (_event, expectedSession) => {
    if (!apiBase) return { devices: [] };
    return auth.requestSessionApi(apiBase, "/hosts", { method: "GET" }, requireSession(expectedSession));
  });

  ipcMain.handle("host:register-folder", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const initialSession = await auth.readSession();
    if (!initialSession?.user_id || !initialSession?.session_generation ||
        initialSession.api_base_url !== apiBase) throw new Error("Sign in before sharing a folder.");
    const expectedSession = { userId: initialSession.user_id, generation: initialSession.session_generation };
    const name = path.basename(rootPath);
    const writable = request?.writable === true;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Host registration requires a current window.");
    const answer = await dialog.showMessageBox(window, { type: "warning",
      buttons: [t("native.host.cancel"), t("native.host.allow")],
      defaultId: 0, cancelId: 0, title: t("native.host.share.title"),
      message: t(writable ? "native.host.share.write" : "native.host.share.read", { name }),
      detail: t("native.host.share.detail") });
    if (answer.response !== 1) return { cancelled: true };
    const currentSession = await auth.readSession();
    if (currentSession?.user_id !== expectedSession.userId ||
        currentSession?.session_generation !== expectedSession.generation) throw new Error("Account changed during approval.");
    const { identity, registry, connector } = ensureServices();
    const { deviceId, accountId } = await identity.register(os.hostname().slice(0, 120), process.platform, expectedSession);
    const registered = await registry.register({ deviceId, rootPath, name, writable, expectedSession });
    await markWorkspaceShared(rootPath, registered.folderId)
      .catch((error) => logger.warn("Unable to mark the folder as shared", error?.message));
    active = { deviceId, accountId };
    if (!await isPaused() && !connector.isActive()) {
      // A transport failure retries in the connector; keep this folder binding.
      await connector.connect(deviceId).catch((error) => logger.warn("Device connection deferred", error?.message));
    }
    return { deviceId, folderId: registered.folderId };
  });

  ipcMain.handle("host:connect", async (_event, expectedSession) => {
    const session = requireSession(expectedSession);
    const current = await auth.readSession();
    if (current?.user_id !== session.userId || current?.session_generation !== session.generation) {
      throw new Error("Account changed before connection.");
    }
    return connectIfShared(session);
  });

  ipcMain.handle("host:status", async () => {
    const connector = services?.connector;
    const folders = active && services ? await services.registry.list(active.accountId, active.deviceId) : [];
    return { ...(connector?.status() ?? { state: "off", deviceId: null, activeRequests: 0, watching: 0, lastAccessAt: null }),
      paused: await isPaused(), folders: folders.map(({ folderId, name, writable }) => ({ folderId, name, writable })) };
  });

  ipcMain.handle("host:set-sharing-paused", async (_event, request) => {
    const session = requireSession(request?.expectedSession);
    await setPaused(request?.paused === true);
    if (paused) services?.connector.stop();
    else await connectIfShared(session).catch((error) => logger.warn("Device connection deferred", error?.message));
    const status = services?.connector.status() ?? { state: "off" };
    broadcast({ ...status, paused });
    return { paused };
  });

  ipcMain.handle("host:update-folder", async (event, request) => {
    const { deviceId, folderId, name, writable, expectedRevision } = request ?? {};
    const session = requireSession(request?.expectedSession);
    if (!UUID.test(deviceId) || !UUID.test(folderId) || typeof name !== "string" || !name.trim() ||
        typeof writable !== "boolean" || !Number.isSafeInteger(expectedRevision)) throw new Error("Invalid folder update.");
    if (writable) {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("Folder update requires a current window.");
      const answer = await dialog.showMessageBox(window, { type: "warning",
        buttons: [t("native.host.cancel"), t("native.host.allow")], defaultId: 0, cancelId: 0,
        title: t("native.host.share.title"), message: t("native.host.share.write", { name: name.trim() }) });
      if (answer.response !== 1) return { cancelled: true };
    }
    const local = active?.deviceId === deviceId && active?.accountId === session.userId ? services?.registry : null;
    // Narrow locally before asking the backend; widen locally only after it agreed.
    if (local && !writable) await local.setAccess({ accountId: session.userId, deviceId, folderId, name, writable });
    const result = await auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), writable, expected_revision: expectedRevision }) }, session);
    if (local && writable) await local.setAccess({ accountId: session.userId, deviceId, folderId, name, writable });
    return result;
  });

  ipcMain.handle("host:remove-folder", async (event, request) => {
    const { deviceId, folderId, expectedSession } = request ?? {};
    if (!UUID.test(deviceId) || !UUID.test(folderId)) throw new Error("Invalid folder removal.");
    const session = requireSession(expectedSession);
    const current = await auth.readSession();
    if (current?.user_id !== session.userId || current?.session_generation !== session.generation) {
      throw new Error("Account changed before removal.");
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Folder removal requires a current window.");
    const answer = await dialog.showMessageBox(window, { type: "warning",
      buttons: [t("native.host.cancel"), t("native.host.remove")],
      defaultId: 0, cancelId: 0, title: t("native.host.remove.title"),
      message: t("native.host.remove.message") });
    if (answer.response !== 1) return { cancelled: true };
    if (active?.deviceId === deviceId && active?.accountId === session.userId && services) {
      services.fileService.forget?.(folderId);
      const local = (await services.registry.list(session.userId, deviceId)).find((row) => row.folderId === folderId);
      const removed = await services.registry.remove(deviceId, folderId);
      if (local) await markWorkspaceShared(local.rootPath, null).catch(() => {});
      if (!await services.registry.hasActive(session.userId, deviceId)) services.connector.stop();
      return { removed };
    }
    return auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}/folders/${folderId}`,
      { method: "DELETE" }, session);
  });

  ipcMain.handle("host:revoke-device", async (event, request) => {
    const { deviceId } = request ?? {};
    if (!UUID.test(deviceId)) throw new Error("Invalid device.");
    const session = requireSession(request?.expectedSession);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Device removal requires a current window.");
    const answer = await dialog.showMessageBox(window, { type: "warning",
      buttons: [t("native.host.cancel"), t("native.host.remove")], defaultId: 0, cancelId: 0,
      title: t("native.host.revoke.title"), message: t("native.host.revoke.message") });
    if (answer.response !== 1) return { cancelled: true };
    return auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}`, { method: "DELETE" }, session);
  });

  ipcMain.handle("host:disconnect", () => {
    services?.connector.stop(); active = null;
    return { disconnected: true };
  });

  // Access side: this window opened another computer's folder.
  ipcMain.handle("host:folder-request", async (_event, request) => {
    const session = requireSession(request?.expectedSession);
    if (!apiBase) return { ok: false, status: 404, code: "folder_unavailable" };
    return remoteClient().request(request?.folderId, request?.operation, session);
  });

  ipcMain.handle("host:folder-watch", async (event, request) => {
    const session = requireSession(request?.expectedSession);
    const owner = event.sender;
    const id = request?.id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || !UUID.test(request?.folderId)) {
      throw new Error("Invalid folder subscription.");
    }
    const key = `${owner.id}:${id}`;
    const mine = [...folderWatches.keys()].filter((item) => item.startsWith(`${owner.id}:`)).length;
    if (folderWatches.has(key) || mine >= MAX_WATCHES_PER_WINDOW) throw new Error("Folder subscription limit reached.");
    const controller = new AbortController();
    const close = () => { controller.abort(); folderWatches.delete(key); owner.removeListener("destroyed", close); };
    folderWatches.set(key, close);
    owner.once("destroyed", close);
    const emit = async (value) => {
      if (controller.signal.aborted || owner.isDestroyed()) return;
      const current = await auth.readSession();
      if (current?.user_id !== session.userId || current?.session_generation !== session.generation) { close(); return; }
      owner.send("host:folder-event", { ...value, id });
    };
    void remoteClient().watch(request.folderId, session, emit, controller.signal)
      .catch((error) => emit({ type: "unavailable", retryable: false, message: error?.message }))
      .finally(close);
    return { id };
  });

  ipcMain.handle("host:folder-watch-stop", (event, request) => {
    folderWatches.get(`${event.sender.id}:${request?.id}`)?.();
  });

  // Recently opened folders on the owner's other computers, and window restore.
  ipcMain.handle("host:recent-folders", async (_event, expectedSession) => {
    if (!apiBase) return { folders: [], lastActive: null };
    const { deployment, accountId } = await currentAccount(requireSession(expectedSession));
    const store = recentFolders();
    return { folders: await store.list(deployment, accountId), lastActive: await store.lastActive(deployment, accountId) };
  });
  ipcMain.handle("host:record-recent-folder", async (_event, request) => {
    const { deployment, accountId } = await currentAccount(requireSession(request?.expectedSession));
    const { deviceId, folderId, name, hostName, writable } = request ?? {};
    return recentFolders().record({ deployment, accountId, deviceId, folderId, name, hostName, writable });
  });
  ipcMain.handle("host:close-recent-folder", async (_event, request) => {
    const { deployment, accountId } = await currentAccount(requireSession(request?.expectedSession));
    return recentFolders().clearLastActive(deployment, accountId);
  });
  ipcMain.handle("host:forget-recent-folder", async (_event, request) => {
    const { deployment, accountId } = await currentAccount(requireSession(request?.expectedSession));
    if (!UUID.test(request?.folderId)) throw new Error("Invalid folder.");
    return recentFolders().forget(deployment, accountId, request.folderId);
  });

  return {
    dispose() {
      powerMonitor?.removeListener("suspend", onSuspend);
      powerMonitor?.removeListener("resume", onResume);
      powerMonitor?.removeListener("unlock-screen", onResume);
      for (const close of [...folderWatches.values()]) close();
      services?.connector.stop();
      services?.fileService.dispose?.();
      active = null;
    },
  };
}
