/**
 * Puppyone Host: the one process on this computer that serves its shared
 * folders to the owner's other computers.
 *
 * It owns the device key, the folder registry (folder ID -> local root, kept
 * only here), the file service, remote execution and the outbound device
 * connection. It runs without windows and keeps sharing after Desktop quits.
 * Desktop drives it over the control channel and lends it the signed-in
 * person only for the Cloud calls that need one (registering this device or a
 * folder, changing a folder): those requests are executed by Desktop, so the
 * person's credential never enters this process.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createDeviceIdentityService } from "../main/hosts/device-identity.mjs";
import { createHostFolderRegistry } from "../main/hosts/host-folder-registry.mjs";
import { createHostFileService } from "../main/hosts/host-file-service.mjs";
import { createHostFileProcess } from "../main/hosts/host-file-process.mjs";
import { createHostConnector } from "../main/hosts/host-connector.mjs";
import { createHostExecService } from "../main/hosts/host-exec-service.mjs";
import { createHostGitService } from "../main/hosts/host-git-service.mjs";
import { createUtilityTerminals } from "../main/hosts/host-exec-process.mjs";
import { resolveCloudApiBaseUrl } from "../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The only Cloud routes this process may ask Desktop to call for the signed-in person. */
const HOST_ROUTE = /^\/hosts\/devices(\/[0-9a-f-]{36}(\/folders(\/[0-9a-f-]{36})?)?)?$/i;

export function isHostServiceRoute(route) {
  return typeof route === "string" && HOST_ROUTE.test(route);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await fs.rename(temp, file);
}

/**
 * `desktop()` returns the connected Desktop peer or null. Everything that
 * needs the signed-in person fails with a clear message when Desktop is not
 * running; serving already shared folders never needs it.
 */
export function createHostService({ stateDir, secureStorage, desktop = () => null, utilityProcess = null,
  fileServiceModulePath = null, hostExecModulePath = null, createTerminals = null, appVersion = "unknown",
  logger = console, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch, onStatus = () => {},
  onRevoked = () => {} }) {
  const sharingPath = path.join(stateDir, "host-sharing.json");
  // One per service launch: lets the Cloud tell a restarted host from a reconnect.
  const bootId = crypto.randomUUID();
  let state = null;
  let services = null;
  let queue = Promise.resolve();

  /** Serializes changes to sharing so a stop never races a connect. */
  function serial(work) {
    const result = queue.catch(() => {}).then(work);
    queue = result;
    return result;
  }

  async function loadState() {
    if (state) return state;
    const saved = await readJson(sharingPath, {});
    state = {
      deployment: typeof saved.deployment === "string" ? saved.deployment : null,
      paused: saved.paused === true,
      active: UUID.test(saved.active?.accountId) && UUID.test(saved.active?.deviceId)
        ? { accountId: saved.active.accountId, deviceId: saved.active.deviceId } : null,
    };
    return state;
  }

  async function saveState() {
    await writeJson(sharingPath, state);
  }

  const auth = Object.freeze({
    async readSession() {
      const peer = desktop();
      if (!peer) return null;
      return peer.call("session", {});
    },
    async requestSessionApi(base, route, init = {}, expectedSession = null) {
      if (!isHostServiceRoute(route)) throw new Error("This route is not available to the host service.");
      const peer = desktop();
      if (!peer) throw new Error("Open PuppyOne and sign in to change what this computer shares.");
      return peer.call("api", { base, route, expectedSession,
        init: { method: init.method ?? "GET", headers: init.headers ?? null, body: init.body ?? null } });
    },
    subscribe: () => () => {},
  });

  function status() {
    const connection = services?.connector.status() ?? { state: "off", deviceId: null, activeRequests: 0,
      watching: 0, lastAccessAt: null, running: [] };
    return { ...connection, paused: state?.paused === true, active: state?.active ?? null,
      deployment: state?.deployment ?? null };
  }

  function notify() {
    try { onStatus(status()); } catch { /* observers never control sharing */ }
  }

  function build(deployment) {
    const identity = createDeviceIdentityService({ filePath: path.join(stateDir, "host-device-identity.json"),
      secureStorage, auth, apiBase: deployment });
    const registry = createHostFolderRegistry({ filePath: path.join(stateDir, "host-folder-registry.json"),
      auth, apiBase: deployment });
    const resolveFolder = (folderId) => state?.active
      ? registry.resolve(folderId, state.active.accountId, state.active.deviceId) : null;
    const fileService = utilityProcess && fileServiceModulePath
      ? createHostFileProcess({ utilityProcess, modulePath: fileServiceModulePath, resolveFolder, logger })
      : createHostFileService({ resolveFolder });
    const terminalFactory = createTerminals ?? (utilityProcess && hostExecModulePath
      ? (options) => createUtilityTerminals({ utilityProcess, modulePath: hostExecModulePath, appVersion, logger, ...options })
      : null);
    const execService = terminalFactory ? createHostExecService({ resolveFolder, logger,
      createTerminalService: terminalFactory, onChange: () => notify() }) : null;
    const gitService = createHostGitService({ resolveFolder });
    const connector = createHostConnector({ apiBase: deployment, identity, registry, fileService, logger,
      WebSocketImpl, fetchImpl, gitService, execService, appVersion, bootId,
      onStatus: () => notify(),
      onRevoked: (lost) => { void forgetRevoked(lost); } });
    return { deployment, identity, registry, fileService, execService, gitService, connector };
  }

  async function forgetRevoked(lost) {
    try {
      await serial(async () => {
        if (state.active?.deviceId === lost.deviceId && state.active?.accountId === lost.accountId) {
          state.active = null;
          await saveState();
        }
        // Deny locally first, then drop the key; a later share registers a new device.
        const shared = await services.registry.list(lost.accountId, lost.deviceId);
        await services.registry.forgetDevice(lost);
        await services.identity.forget(lost);
        onRevoked({ ...lost, roots: shared.map((row) => row.rootPath) });
      });
    } catch (error) {
      logger.warn?.("Revoked device cleanup failed", error?.message);
    }
    notify();
  }

  function ready() {
    if (!services) throw new Error("PuppyOne Host is not configured for a Cloud deployment.");
    return services;
  }

  function dispose() {
    void services?.execService?.stopAll().catch(() => {});
    services?.connector.stop();
    services?.fileService.dispose?.();
    services = null;
  }

  async function connectActive() {
    const { connector, registry } = ready();
    const active = state.active;
    if (!active || state.paused || connector.isActive()) return;
    if (!await registry.hasActive(active.accountId, active.deviceId)) return;
    // A transport failure keeps retrying inside the connector with the same identity.
    await connector.connect(active.deviceId, active.accountId)
      .catch((error) => logger.warn?.("Device connection deferred", error?.message));
  }

  async function configure(apiBase) {
    const deployment = resolveCloudApiBaseUrl(apiBase);
    if (services?.deployment === deployment) return;
    dispose();
    if (state.deployment !== deployment) {
      // Another deployment never inherits the previous one's sharing.
      state.deployment = deployment;
      state.active = null;
      await saveState();
    }
    services = build(deployment);
  }

  const methods = {
    /** Desktop tells the host service which Cloud it belongs to. */
    configure: ({ apiBase }) => serial(async () => {
      await loadState();
      await configure(apiBase);
      await connectActive();
      return status();
    }),
    status: async () => {
      const current = status();
      const folders = services && state.active
        ? await services.registry.list(state.active.accountId, state.active.deviceId) : [];
      return { ...current, folders: folders.map(({ folderId, name, writable, rootPath, execution }) =>
        ({ folderId, name, writable, rootPath, execution })) };
    },
    identityExisting: async ({ accountId }) => {
      if (!UUID.test(accountId)) return null;
      return ready().identity.existingFor(accountId);
    },
    identityRegister: ({ name, platform, expectedSession }) =>
      ready().identity.register(String(name).slice(0, 120), platform, expectedSession),
    registryList: ({ accountId, deviceId }) => ready().registry.list(accountId, deviceId),
    registryHasActive: ({ accountId, deviceId }) => ready().registry.hasActive(accountId, deviceId),
    registryRegister: (request) => ready().registry.register(request),
    registrySetAccess: async (request) => {
      await ready().registry.setAccess(request);
      // Narrowing to view-only ends everything that may run there.
      if (!request.writable) await services.execService?.enforce(request.folderId);
      return true;
    },
    registrySetExecution: async (request) => {
      await ready().registry.setExecution(request);
      await services.execService?.enforce(request.folderId);
      return true;
    },
    registryRemove: ({ deviceId, folderId }) => serial(async () => {
      const { registry, fileService, connector } = ready();
      fileService.forget?.(folderId);
      const removed = await registry.remove(deviceId, folderId);
      if (state.active?.deviceId === deviceId && !await registry.hasActive(state.active.accountId, deviceId)) {
        connector.stop();
      }
      notify();
      return removed;
    }),
    /** Start (or resume) sharing for this account's registered device. */
    connect: ({ accountId, deviceId }) => serial(async () => {
      if (!UUID.test(accountId) || !UUID.test(deviceId)) throw new Error("Invalid device.");
      const { connector } = ready();
      if (state.active?.accountId !== accountId || state.active?.deviceId !== deviceId) {
        connector.stop();
        state.active = { accountId, deviceId };
        await saveState();
      }
      if (state.paused) { notify(); return { deviceId, paused: true }; }
      await connectActive();
      return { deviceId };
    }),
    /** The person here signed out or switched accounts: stop until they come back. */
    stopSharing: () => serial(async () => {
      services?.connector.stop();
      void services?.execService?.stopAll().catch(() => {});
      state.active = null;
      await saveState();
      notify();
      return true;
    }),
    setPaused: ({ paused }) => serial(async () => {
      state.paused = paused === true;
      await saveState();
      if (state.paused) services?.connector.stop();
      else if (services) await connectActive();
      notify();
      return { paused: state.paused };
    }),
    execEnforce: async ({ folderId }) => { await services?.execService?.enforce(folderId); return true; },
    execStopAll: async () => { await services?.execService?.stopAll(); return true; },
  };

  return Object.freeze({
    methods,
    status,
    /** On launch: resume sharing on its own if it was sharing and not paused. */
    start: () => serial(async () => {
      await loadState();
      if (state.deployment) {
        services ??= build(state.deployment);
        await connectActive();
      }
      notify();
      return status();
    }),
    suspend: () => services?.connector.suspend(),
    wake: () => services?.connector.wake(),
    dispose,
  });
}
