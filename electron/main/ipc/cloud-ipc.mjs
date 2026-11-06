import { createCloudReadRequests } from "../cloud-read-requests.mjs";
import { registerCloudWorkspaceEvents } from "../cloud-workspace-events.mjs";
import {
  buildCloudApiBaseCandidates,
  fetchCloudAccessPointDirectory,
  fetchCloudAccessPointSemantics,
  normalizeCloudApiBase,
  requestCloudApi,
} from "../cloud-api-client.mjs";
import {
  normalizeCloudRequestHeaders,
  requireCloudApiPath,
  requireNonEmptyString,
} from "../security.mjs";

/**
 * The requests that open a Cloud Computer: status (GET), open (POST) and the
 * first file listing. Edits, sync and publish are not part of opening.
 */
export function cloudOpeningStage(method, apiPath) {
  const match = /^\/projects\/[^/?]+\/workbench(\/files)?(?:\?|$)/.exec(apiPath);
  if (!match) return null;
  if (match[1]) return method === "GET" ? "files" : null;
  if (method === "GET") return "status";
  return method === "POST" ? "open" : null;
}

/**
 * One local line per failed opening request, written to the app's log file so
 * a report can be matched to the server's log by request id. It names no
 * project, path, file or credential and is never sent anywhere.
 */
function recordOpeningFailure(diagnostics, stage, method, error, startedAt) {
  try {
    diagnostics?.warn?.("[cloud-opening] request failed", {
      stage,
      method,
      status: Number.isFinite(error?.status) ? Number(error.status) : null,
      code: typeof error?.code === "string" ? error.code : null,
      retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
      request_id: typeof error?.requestId === "string" ? error.requestId : null,
      duration_ms: Math.max(0, Date.now() - startedAt),
    });
  } catch {
    // A diagnostic line can never change the request's own outcome.
  }
}

export function registerCloudIpcHandlers({ ipcMain, cloudAuthService, diagnostics = null }) {
  registerCloudWorkspaceEvents(ipcMain, cloudAuthService);
  const reads = createCloudReadRequests();
  ipcMain.handle("cloud:session-api-cancel", (event, requestId) => {
    reads.cancel(event.sender, requestId);
  });
  ipcMain.handle("cloud-session:read", async () => {
    return cloudAuthService.readSession();
  });

  ipcMain.handle("cloud-auth:read-state", async () => {
    return cloudAuthService.readState();
  });

  ipcMain.handle("cloud-session:restore", async (_event, request) => {
    const apiBase = normalizeCloudApiBase(request?.apiBaseUrl);
    return cloudAuthService.restoreSession(apiBase);
  });

  ipcMain.handle("cloud-session:start-oauth", async (_event, request) => {
    const apiBase = normalizeCloudApiBase(request?.apiBaseUrl);
    if (!apiBase) throw new Error("Cloud API base URL is required.");
    return cloudAuthService.startOAuth({ apiBase, provider: request?.provider });
  });

  ipcMain.handle("cloud-session:clear", async () => {
    await cloudAuthService.clearSession();
    return { ok: true };
  });

  ipcMain.handle("cloud:api-request", async (_event, request) => {
    return cloudIpcEnvelope(async () => {
      const apiBase = normalizeCloudApiBase(request?.apiBaseUrl);
      if (!apiBase) throw new Error("Cloud API base URL is required.");
      const apiPath = requireCloudApiPath(request?.path);
      const method = typeof request?.method === "string" && request.method.trim()
        ? request.method.trim().toUpperCase()
        : "GET";
      const headers = normalizeCloudRequestHeaders(request?.headers);
      const body = typeof request?.body === "string" ? request.body : undefined;
      return requestCloudApi(apiBase, apiPath, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    });
  });

  ipcMain.handle("cloud:session-api-request", async (event, request) => {
    return cloudIpcEnvelope(async () => {
      const owned = reads.begin(event?.sender, request);
      try {
      const apiBase = normalizeCloudApiBase(request?.apiBaseUrl);
      if (!apiBase) throw new Error("Cloud API base URL is required.");
      const apiPath = requireCloudApiPath(request?.path);
      const method = typeof request?.method === "string" && request.method.trim()
        ? request.method.trim().toUpperCase()
        : "GET";
      const headers = normalizeCloudRequestHeaders(request?.headers);
      const body = typeof request?.body === "string" ? request.body : undefined;
      const expectedSession = {
        userId: requireNonEmptyString(request?.expectedSession?.userId, "Cloud request account is required."),
        generation: requireNonEmptyString(request?.expectedSession?.generation, "Cloud request session generation is required."),
      };
      const openingStage = cloudOpeningStage(method, apiPath);
      const startedAt = Date.now();
      try {
        return await cloudAuthService.requestSessionApi(apiBase, apiPath, {
          method,
          headers,
          ...sessionReadOptions(method, apiPath, owned?.signal),
          ...(body === undefined ? {} : { body }),
        }, expectedSession);
      } catch (error) {
        if (openingStage && error?.code !== "CLOUD_REQUEST_CANCELLED") {
          recordOpeningFailure(diagnostics, openingStage, method, error, startedAt);
        }
        throw error;
      }
      } finally { owned?.close(); }
    });
  });

  ipcMain.handle("cloud:access-point-list-directory", async (_event, request) => {
    const accessKey = requireNonEmptyString(request?.accessKey, "Access point key is required.");
    const relPath = typeof request?.path === "string" ? request.path.replace(/^\/+/, "") : "";
    const userEmail = typeof request?.userEmail === "string" && request.userEmail.trim()
      ? request.userEmail.trim()
      : null;
    const apiBases = buildCloudApiBaseCandidates(request?.remoteUrl, request?.apiBaseUrl);
    return fetchCloudAccessPointDirectory({
      accessKey,
      path: relPath,
      userEmail,
      apiBases,
    });
  });

  ipcMain.handle("cloud:access-point-semantics", async (_event, request) => {
    const accessKey = requireNonEmptyString(request?.accessKey, "Access point key is required.");
    const userEmail = typeof request?.userEmail === "string" && request.userEmail.trim()
      ? request.userEmail.trim()
      : null;
    const apiBases = buildCloudApiBaseCandidates(request?.remoteUrl, request?.apiBaseUrl);
    return fetchCloudAccessPointSemantics({
      accessKey,
      userEmail,
      apiBases,
    });
  });
}

async function cloudIpcEnvelope(operation) {
  try {
    return {
      transport: "puppyone-cloud-ipc-v1",
      ok: true,
      data: await operation(),
    };
  } catch (error) {
    return {
      transport: "puppyone-cloud-ipc-v1",
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(Number.isFinite(error?.status) ? { status: Number(error.status) } : {}),
        ...(typeof error?.code === "string" && error.code ? { code: error.code } : {}),
        ...(typeof error?.retryable === "boolean" ? { retryable: error.retryable } : {}),
        ...(typeof error?.requestId === "string" && error.requestId ? { requestId: error.requestId } : {}),
      },
    };
  }
}

function sessionReadOptions(method, path, signal) {
  const events = method === "GET" && /^\/agents\/runs\/[0-9a-f-]{36}\/events\?after=\d{1,15}$/i.test(path);
  const context = method === "POST" && /^\/projects\/[^/?]+\/repository-context$/.test(path);
  if (events || context) {
    const timeout = AbortSignal.timeout(15_000);
    return { ...(events ? { responseType: "agent-events" } : {}),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout };
  }
  return signal ? { signal } : {};
}
