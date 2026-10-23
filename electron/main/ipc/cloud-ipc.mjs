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

export function registerCloudIpcHandlers({ ipcMain, cloudAuthService }) {
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
      return await cloudAuthService.requestSessionApi(apiBase, apiPath, {
        method,
        headers,
        ...sessionReadOptions(method, apiPath, owned?.signal),
        ...(body === undefined ? {} : { body }),
      }, expectedSession);
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
