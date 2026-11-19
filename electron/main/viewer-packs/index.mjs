import path from "node:path";
import { fileURLToPath } from "node:url";
import { createViewerPackStore } from "./store.mjs";
import { createViewerPackPackageService } from "./package-service.mjs";
import { createViewerPackRegistryService } from "./registry-service.mjs";
import { createViewerPackCatalogService, createDisabledCatalogTransport } from "./catalog-service.mjs";
import { createViewerPackResourceBroker } from "./resource-broker.mjs";
import { createViewerPackSessionManager } from "./session-manager.mjs";
import { applyPluginSessionSecurity } from "./plugin-session-security.mjs";
import { resolveViewerPackRoute } from "./router.mjs";
import { resolveCoreFormatPolicy } from "./core-format-policy.mjs";
import { getPinnedViewerPackSigners, normalizeTrustedSigners } from "./package-signature.mjs";
import { RESOURCE_PROTOCOL_SCHEME } from "./resource-protocol.mjs";
import { resolveExistingWorkspacePath, statWorkspaceFile } from "../../local-api/workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VIEWER_PACK_APP_IPC_CHANNELS = Object.freeze({
  getSnapshot: "viewer-pack:get-snapshot",
  installLocal: "viewer-pack:install-local",
  disable: "viewer-pack:disable",
  uninstall: "viewer-pack:uninstall",
  activate: "viewer-pack:activate",
  setBounds: "viewer-pack:set-bounds",
  destroySession: "viewer-pack:destroy-session",
});

export const VIEWER_PACK_PLUGIN_IPC_CHANNELS = Object.freeze({
  documentGetMeta: "viewer-pack:document-get-meta",
  resourceOpen: "viewer-pack:resource-open",
  resourceReadRange: "viewer-pack:resource-read-range",
  resourceCreateRangeUrl: "viewer-pack:resource-create-range-url",
  resourceClose: "viewer-pack:resource-close",
  uiSetState: "viewer-pack:ui-set-state",
  uiGetTheme: "viewer-pack:ui-get-theme",
});

export const VIEWER_PACK_APP_EVENTS = Object.freeze({
  sessionState: "viewer-pack:session-state",
});

export function createRangeUrl(handleId) {
  return `${RESOURCE_PROTOCOL_SCHEME}://handle/${encodeURIComponent(handleId)}`;
}

export function createViewerPackHost({
  WebContentsView,
  sessionFromPartition,
  getOwnerWindow,
  userDataPath,
  appVersion,
  isPackaged = true,
  trustedSigners = null,
  allowTestKeys = false,
  getMimeType = null,
  getThemeSnapshot = () => ({ mode: "light", tokens: {} }),
  allowFileFallback = false,
  nativeSurfaceOcclusion = null,
  nativeSurfacePointerPassthrough = null,
}) {
  if (typeof userDataPath !== "string" || !userDataPath.trim()) {
    throw new TypeError("userDataPath is required for createViewerPackHost.");
  }
  if (typeof appVersion !== "string" || !appVersion.trim()) {
    throw new TypeError("appVersion is required for createViewerPackHost.");
  }
  if (isPackaged && allowTestKeys) {
    throw new Error("Packaged builds cannot enable Viewer Pack test signing keys.");
  }

  const getTrustedSigners = () => trustedSigners == null
    ? getPinnedViewerPackSigners({ allowTestKeys, isPackaged })
    : normalizeTrustedSigners(trustedSigners);
  const store = createViewerPackStore({ userDataPath });
  const registry = createViewerPackRegistryService({
    store,
    hostVersion: appVersion,
    getTrustedSigners,
  });
  const packages = createViewerPackPackageService({
    store,
    hostVersion: appVersion,
    getTrustedSigners,
  });
  const catalog = createViewerPackCatalogService({ transport: createDisabledCatalogTransport() });

  const resourceBroker = createViewerPackResourceBroker({
    resolveAuthorizedFilePath: async ({ rootPath, relativePath }) => {
      const absolutePath = await resolveExistingWorkspacePath(rootPath, relativePath);
      return { absolutePath, rootPath, relativePath };
    },
  });
  const sessions = createViewerPackSessionManager({
    WebContentsView,
    sessionFromPartition,
    getOwnerWindow,
    pluginPreloadPath: path.join(__dirname, "../../plugin-preload.cjs"),
    store,
    registryService: registry,
    resourceBroker,
    applyPluginSessionSecurity,
    getMimeType,
    allowFileFallback,
    nativeSurfaceOcclusion,
    nativeSurfacePointerPassthrough,
  });

  function getSessionIdForSender(sender) {
    const senderId = typeof sender?.id === "number" ? sender.id : null;
    if (senderId === null) return null;
    for (const session of sessions.values()) {
      try {
        if (session.view?.webContents?.id === senderId) return session.sessionId;
      } catch {
        // A destroyed WebContents is never authoritative.
      }
    }
    return null;
  }

  function requireSessionForSender(sender) {
    const sessionId = getSessionIdForSender(sender);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) throw new Error("No active Viewer Pack session for sender.");
    return session;
  }

  function requireCurrentDocumentPermission(session, permission) {
    if (!session.permissions?.currentDocument?.includes(permission)) {
      throw new Error(`Viewer Pack did not declare currentDocument.${permission}.`);
    }
  }

  const host = {
    store,
    registry,
    packages,
    catalog,
    resourceBroker,
    sessions,
    resolveRoute: resolveViewerPackRoute,
    getSessionIdForSender,
    requireSessionForSender,
    requireCurrentDocumentPermission,
    getThemeSnapshot,
    publishUiState(session, state) {
      const ownerWebContents = session.window?.webContents;
      if (!ownerWebContents || session.window?.isDestroyed?.() || ownerWebContents.isDestroyed?.()) return;
      ownerWebContents.send?.(VIEWER_PACK_APP_EVENTS.sessionState, {
        sessionId: session.sessionId,
        state,
      });
    },
    async getSnapshot() {
      return registry.getContributionSnapshot();
    },
    async installLocalPackageFromFiles(request) {
      const result = await packages.installFromFiles(request);
      registry.invalidate();
      sessions.destroyForPlugin(result.pluginId);
      return result;
    },
    async installLocalPackageBytesForTest(request) {
      const result = await packages.installFromBytes(request);
      registry.invalidate();
      sessions.destroyForPlugin(result.pluginId);
      return result;
    },
    async disablePack(pluginId) {
      sessions.destroyForPlugin(pluginId);
      const result = await packages.disable(pluginId);
      registry.invalidate();
      return result;
    },
    async uninstallPack(pluginId) {
      sessions.destroyForPlugin(pluginId);
      const result = await packages.uninstall(pluginId);
      registry.invalidate();
      return result;
    },
    async activateDocumentSession({
      pluginId,
      rootPath,
      relativePath,
      ownerWebContentsId,
      bounds,
    }) {
      const meta = await statWorkspaceFile(rootPath, relativePath);
      const core = resolveCoreFormatPolicy({ name: meta.name, mimeType: meta.mimeType });
      const snapshot = await registry.getContributionSnapshot();
      const route = resolveViewerPackRoute({
        name: meta.name,
        mimeType: meta.mimeType,
        sourceKind: "local",
        coreViewerCapability: core.capability,
        coreViewerId: core.viewerId,
        snapshot,
        preferredPluginId: pluginId,
      });
      if (route.kind === "core") {
        throw new Error(`The built-in ${route.viewerId ?? "core"} viewer owns this file type.`);
      }
      if (route.kind !== "plugin" || route.pluginId !== pluginId) {
        throw new Error("Selected Viewer Pack is not an enabled match for this local document.");
      }
      const contribution = route.contribution;
      return sessions.activate({
        pluginId: contribution.pluginId,
        version: contribution.version,
        contentHash: contribution.contentHash,
        entry: contribution.viewer.entry,
        permissions: contribution.permissions,
        runtime: contribution.viewer.runtime,
        documentPath: meta.path,
        documentName: meta.name,
        documentMimeType: meta.mimeType,
        documentRevision: meta.revision,
        rootPath,
        relativePath: meta.path,
        ownerWebContentsId,
        bounds,
      });
    },
    async getDocumentMetaForSession(session) {
      requireCurrentDocumentPermission(session, "metadata");
      const meta = await statWorkspaceFile(session.rootPath, session.relativePath);
      if (meta.revision !== session.documentRevision) {
        sessions.destroy(session.sessionId, session.ownerWebContentsId);
        throw new Error("Document changed; reopen it to create a new Viewer Pack session.");
      }
      return {
        id: session.documentPath,
        name: session.documentName ?? meta.name,
        mimeType: session.documentMimeType ?? meta.mimeType,
        sizeBytes: meta.size,
        revision: meta.revision,
      };
    },
    async openResourceForSession(session) {
      requireCurrentDocumentPermission(session, "readRange");
      return resourceBroker.openForDocument({
        pluginId: session.pluginId,
        instanceId: session.instanceId,
        ownerWebContentsId: session.ownerWebContentsId,
        documentPath: session.documentPath,
        documentRevision: session.documentRevision,
        rootPath: session.rootPath,
        relativePath: session.relativePath,
      });
    },
    async readResourceRange(session, request = {}) {
      requireCurrentDocumentPermission(session, "readRange");
      return resourceBroker.readRange({
        handle: request.handle,
        offset: request.offset,
        length: request.length,
        pluginId: session.pluginId,
        instanceId: session.instanceId,
        ownerWebContentsId: session.ownerWebContentsId,
      });
    },
    createRangeUrlForSession(session, handle) {
      requireCurrentDocumentPermission(session, "readRange");
      const entry = resourceBroker.getHandle(handle);
      if (!entry) throw new Error("Unknown or revoked resource handle.");
      if (
        entry.pluginId !== session.pluginId ||
        entry.instanceId !== session.instanceId ||
        entry.ownerWebContentsId !== session.ownerWebContentsId
      ) {
        throw new Error("Resource handle audience mismatch.");
      }
      return createRangeUrl(handle);
    },
    destroyAllSessions() {
      sessions.destroyAll();
    },
    destroySessionsForOwner(ownerWebContentsId) {
      sessions.destroyForOwner(ownerWebContentsId);
    },
  };
  return host;
}

export function registerViewerPackAppIpcHandlers({
  ipcMain,
  host,
  authorizeWorkspaceRoot,
  dialog,
  getDialogOwnerWindow = () => undefined,
  t = defaultTranslate,
}) {
  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.getSnapshot, async () => host.getSnapshot());

  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.installLocal, async (event) => {
    if (!dialog?.showOpenDialog) throw new Error("Viewer Pack file picker is unavailable.");
    const owner = getDialogOwnerWindow(event.sender);
    const options = {
      title: t("native.viewerPack.install.title"),
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: t("native.viewerPack.install.filter"),
        extensions: ["puppyplugin", "sig"],
      }],
    };
    const selected = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selected.canceled) return { canceled: true };
    const archivePaths = selected.filePaths.filter((item) => item.toLowerCase().endsWith(".puppyplugin"));
    const signaturePaths = selected.filePaths.filter((item) => item.toLowerCase().endsWith(".sig"));
    if (archivePaths.length !== 1 || signaturePaths.length !== 1 || selected.filePaths.length !== 2) {
      throw new Error("Select exactly one .puppyplugin file and its .sig envelope.");
    }
    const result = await host.installLocalPackageFromFiles({
      archivePath: archivePaths[0],
      signaturePath: signaturePaths[0],
      sourceLabel: path.basename(archivePaths[0]),
    });
    return { canceled: false, ...result };
  });

  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.disable, async (_event, request) =>
    host.disablePack(request?.pluginId));
  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.uninstall, async (event, request) => {
    if (!dialog?.showMessageBox) throw new Error("Viewer Pack uninstall confirmation is unavailable.");
    const owner = getDialogOwnerWindow(event.sender);
    const options = {
      type: "warning",
      buttons: [
        t("native.viewerPack.uninstall.confirm"),
        t("native.viewerPack.uninstall.cancel"),
      ],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: t("native.viewerPack.uninstall.title"),
      message: t("native.viewerPack.uninstall.message"),
      detail: t("native.viewerPack.uninstall.detail"),
    };
    const decision = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (decision.response !== 0) return { ok: false, canceled: true };
    return host.uninstallPack(request?.pluginId);
  });

  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.activate, async (event, request) => {
    if (typeof authorizeWorkspaceRoot !== "function") {
      throw new Error("Viewer Pack workspace authorization is unavailable.");
    }
    const canonicalRoot = await authorizeWorkspaceRoot(event, request?.rootPath);
    return host.activateDocumentSession({
      pluginId: request?.pluginId,
      rootPath: canonicalRoot,
      relativePath: request?.relativePath,
      ownerWebContentsId: event.sender.id,
      bounds: request?.bounds,
    });
  });

  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.setBounds, async (event, request) =>
    host.sessions.setBounds(request?.sessionId, request?.bounds, event.sender.id));
  ipcMain.handle(VIEWER_PACK_APP_IPC_CHANNELS.destroySession, async (event, request) =>
    host.sessions.destroy(request?.sessionId, event.sender.id));
}

function defaultTranslate(messageId) {
  const messages = {
    "native.viewerPack.install.title": "Install local Viewer Pack",
    "native.viewerPack.install.filter": "Viewer Pack and signature",
    "native.viewerPack.uninstall.confirm": "Uninstall",
    "native.viewerPack.uninstall.cancel": "Cancel",
    "native.viewerPack.uninstall.title": "Uninstall Viewer Pack",
    "native.viewerPack.uninstall.message": "Uninstall this Viewer Pack?",
    "native.viewerPack.uninstall.detail": "The pack will be removed from this computer. Your workspace files are not changed.",
  };
  return messages[messageId] ?? "";
}

export function registerViewerPackPluginIpcHandlers({
  ipcMain,
  host,
  getSessionIdForSender = host.getSessionIdForSender,
}) {
  const requireSession = (sender) => {
    const sessionId = getSessionIdForSender(sender);
    const session = sessionId ? host.sessions.get(sessionId) : null;
    if (!session) throw new Error("No active Viewer Pack session for sender.");
    return session;
  };

  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.documentGetMeta, async (event) =>
    host.getDocumentMetaForSession(requireSession(event.sender)));
  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.resourceOpen, async (event) =>
    host.openResourceForSession(requireSession(event.sender)));
  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.resourceReadRange, async (event, request) => {
    const result = await host.readResourceRange(requireSession(event.sender), request);
    return result.bytes;
  });
  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.resourceCreateRangeUrl, async (event, request) =>
    host.createRangeUrlForSession(requireSession(event.sender), request?.handle));
  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.resourceClose, async (event, request) => {
    const session = requireSession(event.sender);
    host.requireCurrentDocumentPermission(session, "readRange");
    return {
      ok: host.resourceBroker.close(request?.handle, {
        pluginId: session.pluginId,
        instanceId: session.instanceId,
        ownerWebContentsId: session.ownerWebContentsId,
      }),
    };
  });
  ipcMain.handle(VIEWER_PACK_PLUGIN_IPC_CHANNELS.uiGetTheme, async (event) => {
    requireSession(event.sender);
    return host.getThemeSnapshot();
  });

  if (typeof ipcMain.on === "function") {
    ipcMain.on(VIEWER_PACK_PLUGIN_IPC_CHANNELS.uiSetState, (event, state) => {
      try {
        const session = requireSession(event.sender);
        const normalized = normalizeUiState(state);
        if (normalized) host.publishUiState(session, normalized);
      } catch {
        // Ignore advisory UI state from a sender with no current session.
      }
    });
  }
}

function normalizeUiState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  if (!new Set(["loading", "ready", "error"]).has(state.status)) return null;
  const message = typeof state.message === "string"
    ? state.message.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512)
    : undefined;
  const progress = Number.isFinite(state.progress)
    ? Math.min(1, Math.max(0, Number(state.progress)))
    : undefined;
  return {
    status: state.status,
    ...(message ? { message } : {}),
    ...(progress !== undefined ? { progress } : {}),
  };
}
