import os from "node:os";
import path from "node:path";
import { createRemoteHostClient } from "../hosts/remote-host-client.mjs";
import { createHostRecents } from "../hosts/host-recents.mjs";
import { createRemoteExecClient } from "../hosts/remote-exec-client.mjs";
import { isHostServiceRoute } from "../../host-service/service.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WATCHES_PER_WINDOW = 32;
const API_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const OFF = Object.freeze({ state: "off", deviceId: null, activeRequests: 0, watching: 0, lastAccessAt: null,
  running: [], paused: false, active: null });

function requireSession(expectedSession) {
  if (!expectedSession || typeof expectedSession.userId !== "string" ||
      typeof expectedSession.generation !== "string") throw new Error("Session required.");
  return { userId: expectedSession.userId, generation: expectedSession.generation };
}

/**
 * Desktop's half of hosts. Sharing this computer's folders is done by the
 * Puppyone Host service (device key, local roots, connection), reached over its
 * local control channel; Desktop asks the person here for approval, keeps their
 * Cloud credential and runs the few host Cloud calls that need it. Opening
 * another computer's folder stays here. Renderers receive only public IDs,
 * folder names and status; file bytes cross IPC only for a folder a renderer
 * explicitly opened.
 */
export function registerHostIpcHandlers({ ipcMain, app, auth, apiBase, authorizeWorkspaceRoot, dialog,
  BrowserWindow, t, hostService = null, markWorkspaceShared = async () => {}, logger = console }) {
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
  const folderWatches = new Map();

  function broadcast(status) {
    for (const window of BrowserWindow.getAllWindows?.() ?? []) {
      if (!window.isDestroyed()) window.webContents.send("host:status-changed", status);
    }
  }

  // What the host service may ask of Desktop: who is signed in (never a
  // credential), and the host routes that need that person, run here.
  const desktopHandlers = Object.freeze({
    async session() {
      const session = await auth.readSession();
      return session ? { user_id: session.user_id, session_generation: session.session_generation,
        api_base_url: session.api_base_url } : null;
    },
    async api({ base, route, init, expectedSession }) {
      if (base !== apiBase || !isHostServiceRoute(route) || !API_METHODS.has(init?.method)) {
        throw new Error("This request is not available to the host service.");
      }
      return auth.requestSessionApi(apiBase, route, { method: init.method,
        ...(init.headers ? { headers: init.headers } : {}), ...(init.body != null ? { body: init.body } : {}) },
      expectedSession ?? null);
    },
  });

  function onHostEvent(event, data) {
    if (event === "status") broadcast(data);
    else if (event === "revoked") {
      for (const root of data?.roots ?? []) void markWorkspaceShared(root, null).catch(() => {});
    }
  }

  let peer = null;
  let connecting = null;
  async function open(start) {
    if (!apiBase || !hostService) return null;
    const holder = {};
    const options = { handlers: desktopHandlers, onEvent: onHostEvent,
      onClose: () => { if (peer === holder.peer) peer = null; } };
    const next = start ? await hostService.ensure(options) : await hostService.tryConnect(options);
    if (!next) return null;
    holder.peer = next;
    await next.call("configure", { apiBase });
    peer = next;
    return next;
  }
  /** The host service; started only when asked to (`start`), never just to show status. */
  async function host({ start = true } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (peer && !peer.isClosed()) return peer;
      connecting ??= open(start).finally(() => { connecting = null; });
      const result = await connecting;
      if (result || !start) return result;
    }
    throw new Error("PuppyOne Host is unavailable.");
  }
  async function hostStatus({ start = false } = {}) {
    const running = await host({ start }).catch(() => null);
    return running ? running.call("status") : null;
  }
  const sharesHere = async () => Boolean(hostService && await hostService.hasState());

  async function connectIfShared(expectedSession) {
    if (!await sharesHere()) return { deviceId: null };
    const running = await host();
    const existing = await running.call("identityExisting", { accountId: expectedSession.userId });
    const latest = await auth.readSession();
    if (latest?.user_id !== expectedSession.userId || latest?.session_generation !== expectedSession.generation) {
      throw new Error("Account changed during connection.");
    }
    if (!existing || !await running.call("registryHasActive", existing)) return { deviceId: null };
    return running.call("connect", existing);
  }

  // The host service keeps sharing after Desktop quits. While Desktop runs,
  // sharing follows the person signed in here: signing out or switching
  // accounts stops it; a new session for the same person does not.
  let lastUser;
  void auth.readSession().then((session) => { lastUser ??= session?.user_id ?? null; }).catch(() => {});
  async function followSignedInAccount() {
    let session = null;
    try { session = await auth.readSession(); } catch { return; }
    const user = session?.api_base_url === apiBase ? session?.user_id ?? null : null;
    const previous = lastUser;
    lastUser = user;
    if (previous === undefined || previous === user) return;
    const running = await host({ start: false }).catch(() => null);
    const status = await running?.call("status").catch(() => null);
    if (status?.active && status.active.accountId !== user) await running.call("stopSharing").catch(() => {});
  }
  const unsubscribeAuth = auth.subscribe?.(() => { void followSignedInAccount(); }) ?? null;

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
      detail: `${t("native.host.share.detail")}\n\n${t("native.host.share.background")}` });
    if (answer.response !== 1) return { cancelled: true };
    const currentSession = await auth.readSession();
    if (currentSession?.user_id !== expectedSession.userId ||
        currentSession?.session_generation !== expectedSession.generation) throw new Error("Account changed during approval.");
    const running = await host();
    const { deviceId, accountId } = await running.call("identityRegister",
      { name: os.hostname().slice(0, 120), platform: process.platform, expectedSession });
    const registered = await running.call("registryRegister", { deviceId, rootPath, name, writable, expectedSession });
    await markWorkspaceShared(rootPath, registered.folderId)
      .catch((error) => logger.warn("Unable to mark the folder as shared", error?.message));
    // A transport failure retries inside the host service; keep this folder binding.
    await running.call("connect", { accountId, deviceId })
      .catch((error) => logger.warn("Device connection deferred", error?.message));
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
    // A computer that shares something restarts its host service when the App opens.
    const status = await hostStatus({ start: await sharesHere() });
    if (!status) return { ...OFF, folders: [] };
    return { ...status, folders: (status.folders ?? []).map(({ folderId, name, writable }) => ({ folderId, name, writable })) };
  });

  ipcMain.handle("host:set-sharing-paused", async (_event, request) => {
    const session = requireSession(request?.expectedSession);
    const running = await host();
    const result = await running.call("setPaused", { paused: request?.paused === true });
    if (!result.paused) await connectIfShared(session).catch((error) => logger.warn("Device connection deferred", error?.message));
    return { paused: result.paused };
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
    const status = await hostStatus();
    const local = status?.active?.deviceId === deviceId && status?.active?.accountId === session.userId;
    const running = local ? await host({ start: false }) : null;
    // Keep what this computer allows to run; view-only ends all of it.
    const current = local ? status.folders.find((row) => row.folderId === folderId) : null;
    const execution = writable && current ? current.execution : { terminal: false, git: false, agent: false };
    // Narrow locally before asking the backend; widen locally only after it agreed.
    const access = { accountId: session.userId, deviceId, folderId, name, writable };
    if (running && !writable) await running.call("registrySetAccess", access);
    const result = await auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), writable, expected_revision: expectedRevision, ...execution }) }, session);
    if (running && writable) await running.call("registrySetAccess", access);
    return result;
  });

  // Running things in a shared folder: only from this computer, per folder,
  // with an explicit confirmation to turn anything on.
  ipcMain.handle("host:set-execution", async (event, request) => {
    const { deviceId, folderId, expectedRevision } = request ?? {};
    const session = requireSession(request?.expectedSession);
    const wanted = { terminal: request?.terminal === true, git: request?.git === true, agent: request?.agent === true };
    if (!UUID.test(deviceId) || !UUID.test(folderId) || !Number.isSafeInteger(expectedRevision)) {
      throw new Error("Invalid execution setting.");
    }
    const status = await hostStatus();
    if (status?.active?.deviceId !== deviceId || status?.active?.accountId !== session.userId) {
      throw new Error("Change this on the computer that shares the folder.");
    }
    const running = await host({ start: false });
    const row = status.folders.find((item) => item.folderId === folderId);
    if (!row || !running) throw new Error("This folder is not shared from this computer.");
    const widening = (wanted.terminal && !row.execution.terminal) || (wanted.git && !row.execution.git) ||
      (wanted.agent && !row.execution.agent);
    if (widening) {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("This change requires a current window.");
      // Without a sandbox nothing can run here for other computers.
      if (!status.sandbox) {
        await dialog.showMessageBox(window, { type: "info", buttons: [t("native.host.ok")], defaultId: 0,
          title: t("native.host.execution.title"), message: t("native.host.execution.unavailable", { name: row.name }) });
        return { cancelled: true, reason: "sandbox_unavailable" };
      }
      const answer = await dialog.showMessageBox(window, { type: "warning",
        buttons: [t("native.host.cancel"), t("native.host.allow")], defaultId: 0, cancelId: 0,
        title: t("native.host.execution.title"),
        message: t("native.host.execution.sandboxed", { name: row.name }),
        detail: t("native.host.execution.sandboxedDetail") });
      if (answer.response !== 1) return { cancelled: true };
    }
    const update = (body) => auth.requestSessionApi(apiBase, `/hosts/devices/${deviceId}/folders/${folderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: row.name, writable: row.writable, expected_revision: expectedRevision, ...body }) },
      session);
    const local = { accountId: session.userId, deviceId, folderId, ...wanted };
    if (widening) {
      // The Cloud grant first: if it is refused, nothing was allowed here either.
      const result = await update(wanted);
      await running.call("registrySetExecution", local);
      return result;
    }
    await running.call("registrySetExecution", local);
    return update(wanted);
  });

  ipcMain.handle("host:stop-remote-sessions", async () => {
    const running = await host({ start: false }).catch(() => null);
    await running?.call("execStopAll");
    return { stopped: true };
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
    const status = await hostStatus();
    if (status?.active?.deviceId === deviceId && status?.active?.accountId === session.userId) {
      const running = await host({ start: false });
      const local = status.folders.find((row) => row.folderId === folderId);
      const removed = await running.call("registryRemove", { deviceId, folderId });
      if (local) await markWorkspaceShared(local.rootPath, null).catch(() => {});
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

  ipcMain.handle("host:disconnect", async () => {
    const running = await host({ start: false }).catch(() => null);
    await running?.call("stopSharing");
    return { disconnected: true };
  });

  // Opening another computer's folder needs no device key: it works even where
  // this computer cannot store one (and so cannot share its own folders).
  let remote = null;
  function remoteClient() {
    if (!apiBase) throw new Error("Cloud is not configured.");
    remote ??= createRemoteHostClient({ auth, apiBase });
    return remote;
  }

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

  // Access side: a terminal, an Agent or Git in another computer's folder.
  let remoteExec = null;
  const remoteTerminals = new Map();
  function remoteExecClient() {
    if (!apiBase) throw new Error("Cloud is not configured.");
    remoteExec ??= createRemoteExecClient({ auth, apiBase });
    return remoteExec;
  }
  ipcMain.handle("host:exec-open", async (event, request) => {
    const session = requireSession(request?.expectedSession);
    const owner = event.sender;
    const id = request?.id;
    const key = `${owner.id}:${id}`;
    const forget = () => { remoteTerminals.delete(key); owner.removeListener?.("destroyed", closeOnDestroy); };
    const closeOnDestroy = () => { remoteExec?.close(id); forget(); };
    await remoteExecClient().open({ id, folderId: request?.folderId, kind: request?.kind, launcher: request?.launcher,
      cols: request?.cols, rows: request?.rows, expectedSession: session }, (frame) => {
      if (!owner.isDestroyed()) owner.send("host:exec-event", { ...frame, id });
      if (["exit", "error", "closed"].includes(frame.type)) forget();
    });
    remoteTerminals.set(key, id);
    owner.once?.("destroyed", closeOnDestroy);
    return { id };
  });
  const ownedTerminal = (event, request) => remoteTerminals.get(`${event.sender.id}:${request?.id}`) ?? null;
  ipcMain.handle("host:exec-input", (event, request) => {
    const id = ownedTerminal(event, request);
    return id ? remoteExec.input(id, request?.data) : false;
  });
  ipcMain.handle("host:exec-resize", (event, request) => {
    const id = ownedTerminal(event, request);
    return id ? remoteExec.resize(id, request?.cols, request?.rows) : false;
  });
  ipcMain.handle("host:exec-interrupt", (event, request) => {
    const id = ownedTerminal(event, request);
    return id ? remoteExec.interrupt(id) : false;
  });
  ipcMain.handle("host:exec-close", (event, request) => {
    const id = ownedTerminal(event, request);
    return id ? remoteExec.close(id) : false;
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
    /** Desktop quitting leaves the host service sharing; only this App's ties end. */
    dispose() {
      unsubscribeAuth?.();
      remoteExec?.closeAll();
      for (const close of [...folderWatches.values()]) close();
      peer?.close();
      peer = null;
    },
  };
}
