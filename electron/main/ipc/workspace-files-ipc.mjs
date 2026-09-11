import path from "node:path";
import {
  copyWorkspaceEntry,
  copyWorkspaceEntryBetweenRoots,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  getMimeType,
  getWorkspaceTextVersion,
  importWorkspaceEntries,
  listFolderChildren,
  moveWorkspaceEntry,
  readWorkspaceTextFile,
  renameWorkspaceEntry,
  resolveExistingWorkspaceDisplayPath,
  resolveExistingWorkspacePath,
  resolveWorkspaceNode,
  writeWorkspaceTextFile,
} from "../../../local-api/workspace.mjs";
import { absorbWorkspaceEditReviewPath as updateWorkspaceEditReviewPath } from "../../../local-api/edit-review.mjs";

async function absorbWorkspaceEditReviewPath(rootPath, resource) {
  try { await updateWorkspaceEditReviewPath(rootPath, resource); }
  catch (error) {
    // This records review metadata after a committed filesystem operation.
    // Failure must not misreport that operation as uncommitted and cause a retry.
    console.warn("Unable to reconcile edit review after a workspace mutation:", error);
  }
}
import { isPotentiallyExecutableFile } from "../security.mjs";
import { buildLocalFileCapabilityUrl } from "../local-file-capabilities.mjs";
import { parseLocalFileUrl } from "../local-file-protocol.mjs";
import {
  instantiateWorkspaceTemplate,
  loadBundledSlidesFont,
} from "../../../local-api/workspace-templates.mjs";

const MAX_OFFICE_CONVERSIONS_PER_WINDOW = 2;
const DEFAULT_NATIVE_MESSAGES = Object.freeze({
  "native.executable.open.confirm": "Open",
  "native.executable.open.cancel": "Cancel",
  "native.executable.open.title": "Open executable file?",
  "native.executable.open.detail": "This file type may run code or install software. Only open it if you trust this workspace.",
});

function classifyWorkspaceWriteFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT" || /not found|no such file/i.test(message)) {
    return { ok: false, kind: "not-found", message };
  }
  if (code === "EACCES" || code === "EPERM" || /permission denied/i.test(message)) {
    return { ok: false, kind: "permission-denied", message };
  }
  return { ok: false, kind: "io", message };
}

function defaultTranslate(messageId, values = {}) {
  if (messageId === "native.executable.open.message") {
    return `Open “${values.fileName}” in another app?`;
  }
  return DEFAULT_NATIVE_MESSAGES[messageId] ?? "";
}

export function registerWorkspaceFileIpcHandlers({
  app,
  ipcMain,
  BrowserWindow,
  dialog,
  fs,
  shell,
  authorizeWorkspaceRoot,
  localFileCapabilities,
  workspaceWatchService = null,
  workspaceMutationTracker = null,
  gitMetadataWatchService = null,
  convertOfficeDocument = unsupportedOfficeDocumentConverter,
  retireEditorSurfacesForResource = null,
  t = defaultTranslate,
}) {
  const officeConversionSessionsBySender = new Map();
  const runWorkspaceMutation = (rootPath, operation) => (
    workspaceMutationTracker?.run
      ? workspaceMutationTracker.run(rootPath, operation)
      : operation()
  );

  ipcMain.handle("workspace:list-folder-children", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const folderPath = request?.folderPath ?? null;
    return listFolderChildren(rootPath, folderPath);
  });

  ipcMain.handle("workspace:resolve-node", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return resolveWorkspaceNode(rootPath, request?.path);
  });

  ipcMain.handle("workspace:read-file", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const filePath = request?.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    return readWorkspaceTextFile(rootPath, filePath);
  });

  ipcMain.handle("workspace:get-file-url", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const filePath = request?.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    const purpose = requireLocalFileCapabilityPurpose(request?.purpose);
    const canonicalFilePath = purpose === "markdown-asset"
      ? await resolveExistingWorkspaceDisplayPath(rootPath, filePath)
      : await resolveExistingWorkspacePath(rootPath, filePath);
    const metadata = await fs.promises.stat(canonicalFilePath).catch((error) => {
      throw new Error(`Unable to resolve local file resource: ${error.message}`);
    });
    if (!metadata.isFile()) throw new Error("Local file resource must be a regular file.");

    const relativePath = path.relative(rootPath, canonicalFilePath).split(path.sep).join("/");
    let snapshot;
    if (request.expectedVersion !== undefined) {
      if (typeof request.expectedVersion !== "string" || request.expectedVersion.length > 256) throw new Error("Invalid resource version.");
      if (purpose !== "file-preview" || metadata.size > 4 * 1024 * 1024) throw new Error("Versioned preview input exceeds its supported scope or size.");
      // Bound the allocation even if the file grows between stat and read.
      const handle = await fs.promises.open(canonicalFilePath, "r");
      let bytes;
      try {
        const buffer = Buffer.alloc(Math.min(metadata.size + 1, 4 * 1024 * 1024 + 1));
        let offset = 0;
        while (offset < buffer.length) {
          const result = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        bytes = buffer.subarray(0, offset);
      } finally { await handle.close(); }
      if (bytes.length > 4 * 1024 * 1024 || getWorkspaceTextVersion(bytes) !== request.expectedVersion) throw new Error("Resource version changed while preparing preview input.");
      snapshot = { bytes, version: request.expectedVersion, relativePath };
    }
    const scope = purpose === "file-preview" && getMimeType(canonicalFilePath)?.toLowerCase().startsWith("text/html")
      ? "directory"
      : "exact";
    const token = localFileCapabilities.issue({
      senderId: requireIpcSenderId(event),
      rootPath,
      relativePath,
      scope,
      purpose,
      reuse: false,
      snapshot,
    });
    return {
      url: buildLocalFileCapabilityUrl({ rootPath, relativePath, token, purpose }),
    };
  });

  ipcMain.handle("workspace:revoke-file-url", async (event, request) => {
    if (typeof request?.url !== "string" || request.url.length > 16_384) {
      return { revoked: false };
    }
    let parsed;
    try {
      parsed = parseLocalFileUrl(request.url);
    } catch {
      return { revoked: false };
    }
    return {
      revoked: localFileCapabilities.revoke({
        token: parsed.token,
        senderId: requireIpcSenderId(event),
      }),
    };
  });

  ipcMain.handle("workspace:convert-office-docx", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const filePath = request?.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("File path is required.");
    }
    const requestId = requireOfficeConversionRequestId(request?.requestId);
    const senderId = requireIpcSenderId(event);
    let senderSessions = officeConversionSessionsBySender.get(senderId);
    if (!senderSessions) {
      senderSessions = new Map();
      officeConversionSessionsBySender.set(senderId, senderSessions);
    }
    if (senderSessions.has(requestId)) {
      throw new Error("An Office conversion with this request id is already running.");
    }
    if (senderSessions.size >= MAX_OFFICE_CONVERSIONS_PER_WINDOW) {
      throw new Error(`Only ${MAX_OFFICE_CONVERSIONS_PER_WINDOW} Office conversions may run in one window at a time.`);
    }

    const controller = new AbortController();
    const session = { controller, requestId };
    const abortWhenSenderCloses = () => controller.abort();
    event.sender.once?.("destroyed", abortWhenSenderCloses);
    senderSessions.set(requestId, session);

    try {
      return await convertOfficeDocument(rootPath, filePath, { signal: controller.signal });
    } finally {
      event.sender.removeListener?.("destroyed", abortWhenSenderCloses);
      if (senderSessions.get(requestId) === session) {
        senderSessions.delete(requestId);
      }
      if (senderSessions.size === 0 && officeConversionSessionsBySender.get(senderId) === senderSessions) {
        officeConversionSessionsBySender.delete(senderId);
      }
    }
  });

  ipcMain.handle("workspace:convert-office-docx-cancel", async (event, request) => {
    const requestId = requireOfficeConversionRequestId(request?.requestId);
    const senderId = requireIpcSenderId(event);
    const session = officeConversionSessionsBySender.get(senderId)?.get(requestId) ?? null;
    if (!session) return { cancelled: false };

    session.controller.abort();
    return { cancelled: true };
  });

  ipcMain.handle("workspace:write-file", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const filePath = request?.path;
      const content = request?.content;
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        throw new Error("File path is required.");
      }
      const senderId = requireIpcSenderId(event);
      let result;
      try {
        result = await writeWorkspaceTextFile(rootPath, filePath, content, {
          expectedVersion: request?.expectedVersion ?? null,
        });
      } catch (error) {
        if (error?.code === "WORKSPACE_VERSION_CONFLICT") {
          const latest = await readWorkspaceTextFile(rootPath, filePath);
          return {
            ok: false,
            kind: "conflict",
            content: latest.content ?? "",
            version: latest.version ?? null,
          };
        }
        return classifyWorkspaceWriteFailure(error);
      }
      try {
        workspaceWatchService?.noteInternalWrite?.({
          rootPath,
          path: filePath,
          senderId,
          version: result?.version ?? null,
        });
      } catch (error) {
        // Watcher-loop suppression is an optimization. Once the atomic write
        // succeeds, attribution bookkeeping must never turn that durability
        // acknowledgement into a failed save.
        console.warn("Unable to attribute internal workspace write:", error);
      }
      try {
        gitMetadataWatchService?.invalidateWorkingTree?.(rootPath);
      } catch (error) {
        // Git invalidation is a reconciliation hint. A durable file save must
        // remain successful even if no repository watcher is currently active.
        console.warn("Unable to invalidate Git after workspace write:", error);
      }
      await absorbWorkspaceEditReviewPath(rootPath, filePath);
      return { ok: true, version: result?.version ?? null };
    });
  });

  ipcMain.handle("workspace:create-entry", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const result = await createWorkspaceEntry(rootPath, request);
      await absorbWorkspaceEditReviewPath(rootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:instantiate-template", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const fontBytes = await loadBundledSlidesFont(app.getAppPath());
      const result = await instantiateWorkspaceTemplate(rootPath, request, { fontBytes });
      await Promise.all(result.createdPaths.map((createdPath) => (
        absorbWorkspaceEditReviewPath(rootPath, createdPath)
      )));
      return result;
    });
  });

  ipcMain.handle("workspace:rename-entry", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const previousPath = request?.path;
      if (retireEditorSurfacesForResource) await retireEditorSurfacesForResource(requireIpcSenderId(event), await resolveExistingWorkspacePath(rootPath, previousPath));
      const result = await renameWorkspaceEntry(rootPath, request);
      await absorbWorkspaceEditReviewPath(rootPath, previousPath);
      await absorbWorkspaceEditReviewPath(rootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:move-entry", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const previousPath = request?.fromPath;
      if (retireEditorSurfacesForResource) await retireEditorSurfacesForResource(requireIpcSenderId(event), await resolveExistingWorkspacePath(rootPath, previousPath));
      const result = await moveWorkspaceEntry(rootPath, request);
      await absorbWorkspaceEditReviewPath(rootPath, previousPath);
      await absorbWorkspaceEditReviewPath(rootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:copy-entry", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const result = await copyWorkspaceEntry(rootPath, request);
      await absorbWorkspaceEditReviewPath(rootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:copy-entry-between-roots", async (event, request) => {
    const sourceRootPath = await authorizeWorkspaceRoot(event, request?.sourceRootPath);
    const targetRootPath = await authorizeWorkspaceRoot(event, request?.targetRootPath);
    return runWorkspaceMutation(targetRootPath, async () => {
      const result = await copyWorkspaceEntryBetweenRoots(sourceRootPath, targetRootPath, request);
      await absorbWorkspaceEditReviewPath(targetRootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:import-entries", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      const result = await importWorkspaceEntries(rootPath, request);
      await Promise.all(result.paths.map((importedPath) => absorbWorkspaceEditReviewPath(rootPath, importedPath)));
      return result;
    });
  });

  ipcMain.handle("workspace:delete-entry", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    return runWorkspaceMutation(rootPath, async () => {
      if (retireEditorSurfacesForResource) await retireEditorSurfacesForResource(requireIpcSenderId(event), await resolveExistingWorkspacePath(rootPath, request?.path));
      const result = await deleteWorkspaceEntry(rootPath, request);
      await absorbWorkspaceEditReviewPath(rootPath, result.path);
      return result;
    });
  });

  ipcMain.handle("workspace:reveal-entry-in-finder", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const entryPath = request?.path;
    if (typeof entryPath !== "string" || entryPath.trim().length === 0) {
      throw new Error("Entry path is required.");
    }
    if (request?.strategy && request.strategy !== "system") {
      throw new Error("Unsupported external app opening strategy.");
    }

    const targetPath = await resolveExistingWorkspacePath(rootPath, entryPath);
    await fs.promises.stat(targetPath).catch((error) => {
      throw new Error(`Unable to reveal entry in Finder: ${error.message}`);
    });
    shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  ipcMain.handle("workspace:open-entry-external", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const entryPath = request?.path;
    if (typeof entryPath !== "string" || entryPath.trim().length === 0) {
      throw new Error("Entry path is required.");
    }

    let targetPath = await resolveExistingWorkspacePath(rootPath, entryPath);
    let stats = await fs.promises.stat(targetPath).catch((error) => {
      throw new Error(`Unable to open entry: ${error.message}`);
    });
    if (!stats.isFile()) {
      throw new Error("Only files can be opened in another app.");
    }

    if (isPotentiallyExecutableFile(targetPath, stats)) {
      const window = BrowserWindow.fromWebContents(event.sender);
      const confirmOptions = {
        type: "warning",
        buttons: [
          t("native.executable.open.confirm"),
          t("native.executable.open.cancel"),
        ],
        defaultId: 1,
        cancelId: 1,
        title: t("native.executable.open.title"),
        message: t("native.executable.open.message", { fileName: path.basename(targetPath) }),
        detail: t("native.executable.open.detail"),
      };
      const result = window
        ? await dialog.showMessageBox(window, confirmOptions)
        : await dialog.showMessageBox(confirmOptions);
      if (result.response !== 0) return { ok: false, cancelled: true };
    }

    // The user may spend an arbitrary amount of time in the confirmation
    // dialog. Resolve and stat again so a swapped symlink/path is not opened.
    targetPath = await resolveExistingWorkspacePath(rootPath, entryPath);
    stats = await fs.promises.stat(targetPath).catch((error) => {
      throw new Error(`Unable to revalidate entry before opening: ${error.message}`);
    });
    if (!stats.isFile()) {
      throw new Error("Only files can be opened in another app.");
    }

    const openError = await shell.openPath(targetPath);
    if (openError) {
      throw new Error(openError);
    }
    return { ok: true };
  });

}

async function unsupportedOfficeDocumentConverter() {
  throw new Error("Desktop Office conversion is unavailable on this platform.");
}

function requireOfficeConversionRequestId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error("Office conversion request id is invalid.");
  }
  return value;
}

function requireIpcSenderId(event) {
  const senderId = event?.sender?.id;
  if (!Number.isSafeInteger(senderId) || senderId <= 0) {
    throw new Error("Office conversion sender is invalid.");
  }
  return senderId;
}

function requireLocalFileCapabilityPurpose(value) {
  if (value === undefined || value === "file-preview") return "file-preview";
  if (value === "markdown-asset") return value;
  throw new Error("Local file capability purpose is invalid.");
}
