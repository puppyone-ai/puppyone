import { setTimeout as delay } from "node:timers/promises";
import { resolveCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_ACTIONS = new Set(["list", "read"]);
const ACTIONS = new Set(["list", "read", "write", "mkdir", "move", "remove", "git"]);
const GIT_READS = new Set(["status", "graph", "commit_detail", "file_diff"]);
const GIT_FIELDS = ["op", "paths", "path", "scope", "commit", "message"];
const MAX_EVENT_BUFFER = 64 * 1024;

/** Structured failure that survives Electron IPC (custom Error fields do not). */
function failure(error) {
  const status = Number.isFinite(error?.status) ? error.status
    : Number(/Request failed \((\d{3})\)/.exec(String(error?.message ?? ""))?.[1]) || 0;
  const text = String(error?.message ?? "");
  const fallback = { 0: "network_unavailable", 403: "folder_unavailable" }[status] ?? "file_operation_failed";
  const code = /"code":\s*"([a-z_]+)"/.exec(text)?.[1] ?? fallback;
  return { ok: false, status, code, outcomeUnknown: /"outcome_unknown":\s*true/.test(text) };
}

function route(folderId, request) {
  const base = `/hosts/folders/${encodeURIComponent(folderId)}`;
  const path = typeof request.path === "string" ? request.path : "";
  if (request.action === "list") return { path: `${base}/files?path=${encodeURIComponent(path)}`, init: { method: "GET" } };
  if (request.action === "read") return { path: `${base}/file?path=${encodeURIComponent(path)}`, init: { method: "GET" } };
  const json = (method, suffix, body) => ({ path: `${base}${suffix}`, init: { method,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } });
  if (request.action === "write") {
    return json("PUT", "/file", { path, content_base64: request.content_base64,
      expected_revision: request.expected_revision ?? null });
  }
  if (request.action === "move") return json("POST", "/files", { action: "move", path, destination: request.destination });
  if (request.action === "git") {
    return json("POST", "/git", Object.fromEntries(GIT_FIELDS.filter((key) => request[key] !== undefined)
      .map((key) => [key, request[key]])));
  }
  return json("POST", "/files", { action: request.action, path });
}

function parseEvent(frame) {
  let type = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (type === "unavailable") {
    const value = data.length ? JSON.parse(data.join("\n")) : {};
    return { type, retryable: value?.retryable === true };
  }
  if (type !== "change") return null;
  const value = JSON.parse(data.join("\n"));
  if (value?.reset === true) return { type, paths: [], reset: true };
  if (!Array.isArray(value?.paths) || value.paths.length > 256 ||
      value.paths.some((item) => typeof item !== "string" || item.length > 4096)) throw new Error("Invalid folder notification.");
  return { type, paths: value.paths, reset: false };
}

/** Reads `text/event-stream`; returns when the stream ends or reports unavailable. */
export async function readHostFolderEvents(response, emit) {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    throw new Error("Invalid folder event stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return { type: "unavailable", retryable: true };
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_EVENT_BUFFER) throw new Error("Folder event exceeds the transport limit.");
      while (buffer.includes("\n\n")) {
        const end = buffer.indexOf("\n\n");
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (!event) continue;
        if (event.type === "unavailable") return event;
        await emit(event);
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/**
 * Access-side client for another computer's folder. Credentials stay in Main
 * (`auth.requestSessionApi`). Reads may retry a transport failure; a mutation
 * is sent once and an uncertain result is reported, never replayed.
 */
export function createRemoteHostClient({ auth, apiBase, retryDelays = [250, 1000], wait = delay }) {
  const deployment = resolveCloudApiBaseUrl(apiBase);

  async function request(folderId, input, expectedSession) {
    if (!UUID.test(folderId) || !ACTIONS.has(input?.action)) return { ok: false, status: 400, code: "invalid_request" };
    const { path, init } = route(folderId, input);
    const reading = READ_ACTIONS.has(input.action) || (input.action === "git" && GIT_READS.has(input.op));
    const attempts = reading ? retryDelays.length + 1 : 1;
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return { ok: true, result: await auth.requestSessionApi(deployment, path, { ...init }, expectedSession) };
      } catch (error) {
        last = failure(error);
        // Only transport loss and gateway hiccups are worth a second read.
        if (![0, 502, 504].includes(last.status) || attempt === attempts - 1) break;
        await wait(retryDelays[attempt]);
      }
    }
    if (!reading && last.status === 0) last.outcomeUnknown = true;
    return last;
  }

  /** Streams folder changes until `signal` aborts; reconnects a retryable outage. */
  async function watch(folderId, expectedSession, emit, signal) {
    if (!UUID.test(folderId)) throw new Error("Invalid folder.");
    const delays = [500, 1000, 3000, 10_000];
    for (let attempt = 0; !signal.aborted;) {
      let outcome;
      try {
        outcome = await auth.requestSessionApi(deployment, `/hosts/folders/${encodeURIComponent(folderId)}/events`,
          { method: "GET", responseType: "host-folder-events", onHostFolderEvent: async (event) => {
            attempt = 0;
            await emit(event);
          }, signal }, expectedSession);
      } catch (error) {
        if (signal.aborted) return;
        const result = failure(error);
        if (result.status === 403 || result.status === 401 || result.status === 404) {
          await emit({ type: "unavailable", retryable: false, code: result.code });
          return;
        }
        outcome = { type: "unavailable", retryable: true, code: result.code };
      }
      if (signal.aborted) return;
      if (!outcome?.retryable) { await emit({ type: "unavailable", retryable: false }); return; }
      await emit({ type: "offline", code: outcome.code ?? "device_offline" });
      await wait(delays[Math.min(attempt++, delays.length - 1)], undefined, { signal }).catch(() => {});
    }
  }

  return Object.freeze({ request, watch });
}
