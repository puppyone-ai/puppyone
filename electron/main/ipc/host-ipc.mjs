import os from "node:os";
import path from "node:path";
import { createDeviceIdentityService } from "../hosts/device-identity.mjs";
import { createHostFolderRegistry } from "../hosts/host-folder-registry.mjs";
import { createHostFileService } from "../hosts/host-file-service.mjs";
import { createHostConnector } from "../hosts/host-connector.mjs";

/** Main owns keys and roots; Renderer receives only public IDs and status. */
export function registerHostIpcHandlers({ ipcMain, app, auth, secureStorage, apiBase,
  authorizeWorkspaceRoot, dialog, BrowserWindow, t }) {
  let services = null;
  let active = null;

  function ensureServices() {
    if (!apiBase) throw new Error("Cloud is not configured.");
    if (services) return services;
    const base = app.getPath("userData");
    const identity = createDeviceIdentityService({ filePath: path.join(base, "host-device-identity.json"),
      secureStorage, auth, apiBase });
    const registry = createHostFolderRegistry({ filePath: path.join(base, "host-folder-registry.json"),
      auth, apiBase });
    const fileService = createHostFileService({ resolveFolder: (folderId) => active
      ? registry.resolve(folderId, active.accountId, active.deviceId) : null });
    const connector = createHostConnector({ apiBase, auth, identity, registry, fileService });
    services = { identity, registry, connector };
    return services;
  }

  ipcMain.handle("host:catalog", async (_event, expectedSession) => {
    if (!apiBase) return { devices: [] };
    if (!expectedSession || typeof expectedSession.userId !== "string" ||
        typeof expectedSession.generation !== "string") throw new Error("Session required.");
    return auth.requestSessionApi(apiBase, "/hosts", { method: "GET" }, expectedSession);
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
      message: t(writable ? "native.host.share.write" : "native.host.share.read", { name }) });
    if (answer.response !== 1) return { cancelled: true };
    const currentSession = await auth.readSession();
    if (currentSession?.user_id !== expectedSession.userId ||
        currentSession?.session_generation !== expectedSession.generation) throw new Error("Account changed during approval.");
    const { identity, registry, connector } = ensureServices();
    const { deviceId, accountId } = await identity.register(os.hostname().slice(0, 120), process.platform, expectedSession);
    const registered = await registry.register({ deviceId, rootPath, name, writable, expectedSession });
    const alreadyConnected = active?.deviceId === deviceId && active?.accountId === accountId && connector.isActive();
    active = { deviceId, accountId };
    if (!alreadyConnected) {
      // A transport failure retries in the connector; keep this folder binding.
      await connector.connect(deviceId);
    }
    return { deviceId, folderId: registered.folderId };
  });
  ipcMain.handle("host:connect", async (_event, expectedSession) => {
    if (!expectedSession || typeof expectedSession.userId !== "string" ||
        typeof expectedSession.generation !== "string") throw new Error("Session required.");
    const current = await auth.readSession();
    if (current?.user_id !== expectedSession.userId || current?.session_generation !== expectedSession.generation) {
      throw new Error("Account changed before connection.");
    }
    const { identity, registry, connector } = ensureServices();
    const existing = await identity.existingForCurrentAccount();
    const latest = await auth.readSession();
    if (latest?.user_id !== expectedSession.userId || latest?.session_generation !== expectedSession.generation) {
      throw new Error("Account changed during connection.");
    }
    if (!existing || existing.accountId !== expectedSession.userId ||
        !await registry.hasActive(existing.accountId, existing.deviceId)) return { deviceId: null };
    const { deviceId, accountId } = existing;
    if (active?.deviceId === deviceId && active?.accountId === accountId && connector.isActive()) return { deviceId };
    active = { deviceId, accountId };
    await connector.connect(deviceId);
    return { deviceId };
  });
  ipcMain.handle("host:remove-folder", async (event, request) => {
    const { deviceId, folderId, expectedSession } = request ?? {};
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(deviceId) || !uuid.test(folderId) ||
        typeof expectedSession?.userId !== "string" || typeof expectedSession?.generation !== "string") {
      throw new Error("Invalid folder removal.");
    }
    const current = await auth.readSession();
    if (current?.user_id !== expectedSession.userId || current?.session_generation !== expectedSession.generation) {
      throw new Error("Account changed before removal.");
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Folder removal requires a current window.");
    const answer = await dialog.showMessageBox(window, { type: "warning",
      buttons: [t("native.host.cancel"), t("native.host.remove")],
      defaultId: 0, cancelId: 0, title: t("native.host.remove.title"),
      message: t("native.host.remove.message") });
    if (answer.response !== 1) return { cancelled: true };
    if (active?.deviceId === deviceId && active?.accountId === expectedSession.userId) {
      const removed = await services.registry.remove(deviceId, folderId);
      return { removed };
    }
    return auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}/folders/${folderId}`,
      { method: "DELETE" }, expectedSession);
  });
  ipcMain.handle("host:disconnect", () => {
    services?.connector.stop(); active = null;
    return { disconnected: true };
  });
  return { dispose() { services?.connector.stop(); active = null; } };
}
