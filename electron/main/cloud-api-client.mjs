import {
  cloudApiBaseUrlFromRemote,
  normalizeCloudApiBaseUrl,
} from "../../shared/cloudEndpoint.js";
import { readCloudWorkspaceEvents } from "./cloud-workspace-events.mjs";
import { readCloudAgentEventBatch } from "./cloud-agent-event-reader.mjs";

export function buildCloudApiBaseCandidates(remoteUrl, apiBaseUrl) {
  const candidates = [];
  addUniqueCloudApiBase(candidates, cloudApiBaseFromRemote(remoteUrl));
  addUniqueCloudApiBase(candidates, normalizeCloudApiBase(apiBaseUrl));
  return candidates;
}

export function normalizeCloudApiBase(apiBaseUrl) {
  return normalizeCloudApiBaseUrl(apiBaseUrl);
}

export async function fetchCloudAccessPointDirectory({ accessKey, path: relPath, userEmail, apiBases }) {
  if (apiBases.length === 0) {
    throw new Error("Cloud API host is unavailable for this Git remote.");
  }

  const query = new URLSearchParams({
    path: relPath,
    include_hidden: "true",
    include_size: "true",
  });
  const headers = {
    "Content-Type": "application/json",
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  const errors = [];
  for (const apiBase of apiBases) {
    try {
      return await requestCloudApi(apiBase, `/ap-fs/ls?${query.toString()}`, {
        method: "GET",
        headers,
      });
    } catch (error) {
      errors.push(`${apiBase}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to load Cloud contents from the Git remote. Tried ${errors.join(" ; ")}`);
}

export async function fetchCloudAccessPointSemantics({ accessKey, userEmail, apiBases }) {
  if (apiBases.length === 0) {
    throw new Error("Cloud API host is unavailable for this Git remote.");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Access-Key": accessKey,
    "X-Puppy-Client": "cli",
  };
  if (userEmail) headers["X-PuppyOne-User"] = userEmail;

  const errors = [];
  for (const apiBase of apiBases) {
    try {
      return await requestCloudApi(apiBase, "/ap-fs/semantics", {
        method: "GET",
        headers,
      });
    } catch (error) {
      errors.push(`${apiBase}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to resolve Cloud project metadata from the Git remote. Tried ${errors.join(" ; ")}`);
}

export async function requestCloudApi(apiBase, apiPath, init) {
  const responseType = init?.responseType;
  const fetchInit = { ...init };
  delete fetchInit.responseType;
  delete fetchInit.onWorkspaceEvent;
  let response;
  try {
    response = await fetch(`${apiBase}${apiPath}`, fetchInit);
  } catch (error) {
    throw cloudTransportError(error, apiBase, fetchInit.signal);
  }

  if (response.ok && responseType === "bytes") {
    return new Uint8Array(await response.arrayBuffer());
  }
  if (response.ok && responseType === "workspace-events") return readCloudWorkspaceEvents(response, init.onWorkspaceEvent);
  if (response.ok && responseType === "agent-events") {
    return readCloudAgentEventBatch(response);
  }

  let payload = null;
  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    throw cloudTransportError(error, apiBase, fetchInit.signal);
  }
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // Electron's invoke bridge serializes Error.message but drops custom
    // properties such as `error.status`. Keep the status in a stable transport
    // prefix as well so the renderer can recover HTTP semantics after IPC.
    const detail = getCloudApiErrorMessage(payload, "Cloud request failed.");
    const error = new Error(`Request failed (${response.status}): ${detail}`);
    error.status = response.status;
    const businessCode = getCloudApiBusinessErrorCode(payload);
    if (businessCode) error.code = businessCode;
    throw error;
  }

  return payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
}

function cloudTransportError(cause, apiBase, signal) {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`Unable to reach Cloud API at ${apiBase}. ${reason}`);
  error.code = "CLOUD_TRANSPORT_UNAVAILABLE";
  if (cause?.name === "AbortError") error.code = "CLOUD_REQUEST_CANCELLED";
  if (cause?.name === "TimeoutError" || signal?.reason?.name === "TimeoutError") error.code = "CLOUD_REQUEST_TIMEOUT";
  return error;
}

export function getCloudApiBusinessErrorCode(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [payload?.data?.code, payload?.detail?.code];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string"
      && /^[a-z][a-z0-9_.-]{0,99}$/i.test(candidate)
    ) return candidate;
  }
  return null;
}

export function getCloudApiErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
    if (typeof detail.detail === "string" && detail.detail.trim()) return detail.detail;
  }
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return fallback;
}

function addUniqueCloudApiBase(candidates, apiBase) {
  if (!apiBase || candidates.includes(apiBase)) return;
  candidates.push(apiBase);
}

function cloudApiBaseFromRemote(remoteUrl) {
  return cloudApiBaseUrlFromRemote(remoteUrl);
}
