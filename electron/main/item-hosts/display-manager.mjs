import { randomUUID } from "node:crypto";
import { hostError } from "../../../shared/item-host-contract/rpc.mjs";
import { attachNativeSurfaceView } from "../native-surfaces/view-attachment.mjs";

const MAX_CONFIGURATION_BYTES = 128 * 1024;
const DEADLINE_MS = 30_000;
const keyFor = (ownerId, itemId) => `${ownerId}:${itemId}`;
const bounded = (value, maximum = MAX_CONFIGURATION_BYTES) => {
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > maximum) throw hostError("HOST_MESSAGE_BUDGET", "Item metadata exceeds its budget.");
  return structuredClone(value);
};
const deadline = async (promise, message, milliseconds = DEADLINE_MS) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(hostError("HOST_TIMEOUT", message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const processAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};

export function createItemDisplayManager({ WebContentsView, electronSession, MessageChannelMain, authority, budget,
  getOwnerWindow, projectSessions, terminalService, agentService, attachmentStore, applicationUrl, preloadPath,
  configureSession = () => {}, nativeSurfaceOcclusion, nativeSurfacePointerPassthrough }) {
  const entries = new Map();
  const shellRequests = new Map();
  const requireEntry = (sender, request, allowClosing = false) => {
    projectSessions.require(sender.id, request.projectContext, { allowClosing });
    const entry = entries.get(keyFor(sender.id, request.itemId));
    if (!entry || entry.closed || entry.projectContext.generation !== request.projectContext.generation) throw hostError("HOST_STALE", "This item host no longer belongs to the project.");
    return entry;
  };
  const state = (entry) => ({ itemId: entry.itemId, generation: entry.generation, display: entry.display,
    execution: entry.execution, message: entry.message, processId: entry.view && !entry.view.webContents.isDestroyed() ? entry.view.webContents.getOSProcessId() : null });
  const publish = (entry) => {
    if (!entry.owner.isDestroyed()) entry.owner.send("item-host:state", state(entry));
  };
  const fail = (entry, message, display = "crashed") => {
    if (entry.closed) return;
    entry.display = display;
    entry.message = message;
    entry.attachment?.healthy(false);
    entry.rejectReady?.(hostError("HOST_DISPLAY_FAILED", message));
    publish(entry);
  };
  const destroyDisplay = async (entry) => {
    if (entry.destroying) return entry.destroying;
    if (!entry.view) {
      entry.displayLease?.release();
      entry.displayLease = null;
      return;
    }
    entry.destroying = (async () => {
    const view = entry.view;
    const wc = view.webContents;
    const pid = entry.displayPid || (!wc.isDestroyed() ? wc.getOSProcessId() : 0);
    entry.rejectReady?.(hostError("HOST_DISPLAY_DETACHED", "The item display was detached."));
    entry.attachment?.dispose();
    entry.attachment = null;
    authority.unregister(entry);
    clearInterval(entry.watchdog);
    const destroyed = wc.isDestroyed() ? Promise.resolve() : new Promise((resolve) => wc.once("destroyed", resolve));
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
    await deadline(destroyed, "Display process destruction is not confirmed.", 10_000);
    const exitDeadline = Date.now() + 10_000;
    while (!entry.processExited && processAlive(pid)) {
      if (Date.now() >= exitDeadline) throw hostError("HOST_CLOSE_UNCONFIRMED", "Display process exit is not confirmed; its lease is retained.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    entry.displayLease.release();
    entry.displayLease = null;
    entry.view = null;
    })().finally(() => { entry.destroying = null; });
    return entry.destroying;
  };
  function reserveDisplay(entry) {
    const generation = randomUUID();
    const lease = budget.reserve({ key: `renderer:${entry.owner.id}:${entry.itemId}:${generation}`, ownerId: entry.owner.id,
      projectId: entry.projectContext.projectId, kind: entry.kind });
    entry.generation = generation;
    entry.displayLease = lease;
  }
  async function launch(entry) {
    if (!entry.displayLease) reserveDisplay(entry);
    const { generation, displayLease: lease } = entry;
    entry.display = "starting";
    entry.message = undefined;
    entry.geometryRevision = -1;
    const url = new URL("item-host.html", applicationUrl);
    url.hash = generation;
    entry.url = url.href;
    const session = electronSession.fromPartition(`puppyone-item-${entry.owner.id}-${entry.itemId}`, { cache: false });
    session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    configureSession(session);
    let view;
    try {
      view = new WebContentsView({ webPreferences: { session, preload: preloadPath,
        sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, spellcheck: false,
        backgroundThrottling: false, additionalArguments: [`--puppyone-item-generation=${generation}`] } });
    } catch (error) { lease.release(); entry.displayLease = null; throw error; }
    entry.view = view;
    entry.displayLease = lease;
    entry.displayPid = 0;
    entry.processExited = false;
    entry.lastHeartbeat = Date.now();
    const wc = view.webContents;
    const ready = new Promise((resolve, reject) => { entry.resolveReady = resolve; entry.rejectReady = reject; });
    void ready.catch(() => {});
    authority.register(entry);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, target) => { if (target !== entry.url) event.preventDefault(); });
    wc.on("will-redirect", (event) => event.preventDefault());
    wc.on("render-process-gone", () => {
      if (entry.view !== view) return;
      entry.processExited = true;
      fail(entry, "The item display process exited.");
    });
    wc.on("unresponsive", () => { if (entry.view === view) fail(entry, "The item display stopped responding.", "unresponsive"); });
    wc.on("responsive", () => {
      if (entry.view !== view || entry.display !== "unresponsive" || entry.execution === "interrupted") return;
      entry.display = "ready"; entry.message = undefined; entry.attachment.healthy(true); publish(entry);
    });
    entry.attachment = attachNativeSurfaceView({ window: entry.window, view, nativeSurfaceOcclusion, nativeSurfacePointerPassthrough });
    entry.watchdog = setInterval(() => {
      if (entry.display === "ready" && Date.now() - entry.lastHeartbeat > 15_000) fail(entry, "The item display heartbeat expired.", "unresponsive");
    }, 2_000);
    entry.watchdog.unref?.();
    publish(entry);
    try {
      await deadline(wc.loadURL(entry.url), "The item display did not load.");
      const pid = wc.getOSProcessId();
      entry.displayPid = pid;
      if (!pid || pid === entry.owner.getOSProcessId() || [...entries.values()].some((other) => other !== entry && other.view?.webContents.getOSProcessId() === pid)) {
        throw hostError("HOST_PROCESS_SHARED", "The item display did not receive an independent Renderer process.");
      }
      lease.bindProcess(pid, "renderer", (error) => {
        if (entry.view !== view) return;
        fail(entry, error.message);
        void destroyDisplay(entry).catch(() => {});
      });
      await deadline(ready, "The item display did not become ready.");
      lease.ready();
      return state(entry);
    } catch (error) {
      fail(entry, error.message);
      await destroyDisplay(entry);
      throw error;
    }
  }
  async function closeEntry(entry) {
    if (entry.closed) return;
    if (entry.closing) return entry.closing;
    entry.closeRequested = true;
    entry.closing = (async () => {
      await deadline(Promise.allSettled([...entry.operations]), "Item operations have not settled before close.", 10_000);
      if (entry.kind === "terminal" && !entry.terminalReceipt) await terminalService.cancelCreation(entry.owner, entry.itemId);
      await entry.startingTerminal?.catch(() => {});
      if (entry.kind === "terminal" && entry.terminalReceipt) await terminalService.close(entry.owner, entry.terminalReceipt);
      else if (entry.kind === "agent") await agentService.closeItem(entry.owner.id, entry.itemId);
      if (entry.referenceTokens.size) await attachmentStore.revoke({ ownerId: entry.owner.id, workspaceRoot: entry.projectContext.rootPath, tokens: [...entry.referenceTokens] });
      await destroyDisplay(entry);
      entry.closed = true;
      entries.delete(keyFor(entry.owner.id, entry.itemId));
      entry.display = "closed";
      publish(entry);
    })().finally(() => { entry.closing = null; });
    return entry.closing;
  }
  return {
    async create(sender, request) {
      const project = projectSessions.require(sender.id, request.projectContext);
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(request.itemId ?? "") || !["terminal", "agent"].includes(request.kind)) throw hostError("HOST_PAYLOAD", "Invalid workbench item.");
      if (request.kind === "terminal" && !/^[A-Za-z0-9_-]{8,80}$/.test(request.itemId)) throw hostError("HOST_PAYLOAD", "Invalid terminal item identity.");
      if (entries.has(keyFor(sender.id, request.itemId))) throw hostError("HOST_DUPLICATE", "This item already has a display host.");
      const window = getOwnerWindow(sender.id);
      if (!window || window.isDestroyed()) throw hostError("HOST_OWNER_CLOSED", "The item owner window is closed.");
      const entry = { ...bounded(request), owner: sender, window, projectContext: { projectId: project.projectId, generation: project.generation, rootPath: project.rootPath },
        generation: "", display: "starting", execution: "idle", view: null, closed: false, closeRequested: false,
        operations: new Set(), referenceTokens: new Set(), draft: null, recoveries: [], configuration: bounded({ appearance: request.appearance, settings: request.settings }) };
      entries.set(keyFor(sender.id, request.itemId), entry);
      try {
        // Both display and execution admission precede the first PTY side effect.
        reserveDisplay(entry);
        if (entry.kind === "terminal") {
          entry.startingTerminal = projectSessions.run(sender.id, request.projectContext, (operation) => terminalService.create(sender, {
            id: entry.itemId, launcherId: request.recipeId ?? "shell", cwd: project.rootPath, cols: 80, rows: 24,
            projectContext: entry.projectContext, defaultColors: request.settings?.defaultColors,
          }, project.rootPath, operation)).then((receipt) => { entry.terminalReceipt = receipt; return receipt; });
          await entry.startingTerminal;
          entry.execution = "ready";
        }
        if (entry.closeRequested) throw hostError("HOST_CLOSING", "This item was closed during startup.");
        return await launch(entry);
      } catch (error) { await closeEntry(entry).catch(() => {}); throw error; }
    },
    configure(sender, request) {
      const entry = requireEntry(sender, request);
      entry.configuration = { ...entry.configuration, ...bounded({ appearance: request.appearance, settings: request.settings,
        presented: request.presented, commandTarget: request.commandTarget }) };
      if (entry.view && !entry.view.webContents.isDestroyed()) entry.view.webContents.send("item-host:configuration", entry.configuration);
    },
    geometry(sender, request) { requireEntry(sender, request).attachment?.geometry(request); },
    focus(sender, request) { requireEntry(sender, request).view?.webContents.focus(); },
    close: (sender, request) => closeEntry(requireEntry(sender, request, true)),
    async recover(sender, request) {
      const entry = requireEntry(sender, request);
      if (entry.closeRequested) throw hostError("HOST_CLOSING", "The item is closing.");
      if (entry.recovering) return entry.recovering;
      entry.recoveries = entry.recoveries.filter((time) => Date.now() - time < 60_000);
      if (entry.recoveries.length >= 3) throw hostError("HOST_RECOVERY_BUDGET", "This display has reached its recovery limit. Try again after one minute.");
      entry.recoveries.push(Date.now());
      entry.recovering = (async () => {
        await destroyDisplay(entry);
        if (entry.closeRequested) throw hostError("HOST_CLOSING", "The item closed during display recovery.");
        return launch(entry);
      })().finally(() => { entry.recovering = null; });
      return entry.recovering;
    },
    bootstrap(entry) {
      return { itemId: entry.itemId, kind: entry.kind, projectContext: entry.projectContext, generation: entry.generation,
        recipeId: entry.recipeId, historyTarget: entry.historyTarget, ...entry.configuration, draft: entry.draft,
        session: entry.kind === "agent" ? agentService.findItemSession(entry.owner.id, entry.itemId) : null };
    },
    ready(entry) { entry.display = "ready"; entry.attachment.healthy(entry.execution !== "interrupted"); entry.resolveReady?.(); publish(entry); },
    heartbeat(entry) { entry.lastHeartbeat = Date.now(); },
    async connect(entry, request = {}) {
      const view = entry.view;
      const { port1, port2 } = new MessageChannelMain();
      const binding = { connection: randomUUID(), root: entry.projectContext.rootPath };
      try {
        const result = entry.kind === "terminal"
          ? await terminalService.attachDisplay(entry.owner, entry.terminalReceipt, port1, binding)
          : await agentService.attachDisplay({ id: entry.owner.id, hostItemId: entry.itemId }, request, port1, binding);
        const connection = { ...binding, hostGeneration: result.hostGeneration };
        if (entry.closeRequested || entry.view !== view || view.webContents.isDestroyed()) throw hostError("HOST_STALE", "The display detached during connection setup.");
        view.webContents.postMessage("item-host:port", connection, [port2]);
        return { ...result, ...connection };
      } catch (error) { port1.close(); port2.close(); throw error; }
    },
    saveDraft(entry, request) {
      if (!Number.isSafeInteger(request?.revision) || request.revision < 1 || typeof request.text !== "string") throw hostError("HOST_DRAFT", "Invalid draft revision.");
      if (entry.kind !== "agent" || Buffer.byteLength(request.text) > 64 * 1024
        || !Array.isArray(request.references) || request.references.length > 32
        || !Array.isArray(request.mentions) || request.mentions.length > 128
        || typeof request.referenceEpoch !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(request.referenceEpoch)
        || request.references.some((reference) => reference.kind === "staged-attachment" && !entry.referenceTokens.has(reference.token))) {
        throw hostError("HOST_DRAFT", "The retained draft exceeds its budget or attachment ownership.");
      }
      if (entry.draft && request.revision <= entry.draft.revision) return { revision: entry.draft.revision };
      entry.draft = bounded(request, 128 * 1024);
      return { revision: request.revision };
    },
    publish(entry, type, payload) {
      if (!["summary", "open-file", "preferred-model", "preferred-route", "preferred-runtime", "minimum-size", "display-error"].includes(type)) throw hostError("HOST_EVENT", "Unsupported item event.");
      const safe = bounded(payload, 8 * 1024);
      if (type === "display-error") { fail(entry, String(payload).slice(0, 2000)); return; }
      if (type === "summary" && payload?.snapshot?.resourceId && entry.execution !== "interrupted") entry.execution = "ready";
      entry.owner.send("item-host:event", { itemId: entry.itemId, generation: entry.generation, type, payload: safe });
    },
    request(entry, type, payload) {
      if (type !== "resolve-reference" || shellRequests.size >= 32) throw hostError("HOST_BUSY", "Item request is unavailable.");
      const requestId = randomUUID();
      const result = new Promise((resolve, reject) => shellRequests.set(requestId, { entry, resolve, reject }));
      entry.owner.send("item-host:event", { itemId: entry.itemId, generation: entry.generation, type,
        payload: { requestId, value: bounded(payload, 8 * 1024) } });
      return deadline(result, "The workspace reference request timed out.", 10_000).finally(() => shellRequests.delete(requestId));
    },
    respond(sender, request) {
      const pending = shellRequests.get(request.requestId);
      if (!pending || pending.entry.owner.id !== sender.id || pending.entry.itemId !== request.itemId) return;
      if (request.error) pending.reject(new Error(String(request.error).slice(0, 1000)));
      else pending.resolve(bounded(request.value));
    },
    hostEvent(record, event) {
      const entry = entries.get(keyFor(record.ownerId, record.itemId ?? record.id));
      if (!entry) return;
      if (["host-failed", "stream-failed", "control-failed"].includes(event.type) || (event.type === "host-exited" && !event.expected)) {
        entry.execution = "interrupted"; entry.message = event.message ?? "The execution process exited; the task was not restarted."; publish(entry);
        entry.attachment?.healthy(false);
      }
    },
    closeProject: (ownerId, root) => Promise.all([...entries.values()].filter((entry) => entry.owner.id === ownerId && entry.projectContext.rootPath === root).map(closeEntry)),
    closeOwner: (ownerId) => Promise.all([...entries.values()].filter((entry) => entry.owner.id === ownerId).map(closeEntry)),
    closeAll: () => Promise.all([...entries.values()].map(closeEntry)),
    values: () => [...entries.values()],
  };
}
