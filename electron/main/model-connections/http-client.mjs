import http from "node:http";
import https from "node:https";
import { connectionError, MODEL_CONNECTION_LIMITS } from "../../../shared/model-connections/schema.mjs";

/** Metadata only. No redirects, no response bodies in diagnostics, bounded time and bytes. */
export function createModelMetadataClient({ timeoutMs = 5000, maxBytes = MODEL_CONNECTION_LIMITS.responseBytes, maxConcurrent = 4 } = {}) {
  let running = 0;
  const queue = [];
  async function requestJson(url, { apiKey, body, signal } = {}) {
    if (signal?.aborted) throw connectionError("CANCELLED");
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol)) throw connectionError("INVALID_URL");
    return new Promise((resolve, reject) => {
      const transport = target.protocol === "https:" ? https : http;
      const payload = body === undefined ? null : JSON.stringify(body);
      let timer;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value);
      };
      const request = transport.request(target, {
        method: payload ? "POST" : "GET",
        headers: { accept: "application/json", ...(payload ? { "content-type": "application/json" } : {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        agent: false,
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.destroy();
          finish(connectionError(status === 401 || status === 403 ? "AUTHENTICATION_FAILED" : status === 404 ? "ENDPOINT_NOT_FOUND" : status >= 300 && status < 400 ? "REDIRECT_REJECTED" : "ENDPOINT_ERROR"));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) { response.destroy(); request.destroy(); finish(connectionError("RESPONSE_TOO_LARGE")); }
          else chunks.push(chunk);
        });
        response.on("error", () => finish(connectionError("NETWORK_ERROR")));
        response.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            if (apiKey && (raw.includes(apiKey) || raw.includes(JSON.stringify(apiKey).slice(1, -1)))) throw connectionError("INVALID_RESPONSE");
            finish(null, JSON.parse(raw));
          }
          catch { finish(connectionError("INVALID_RESPONSE")); }
        });
      });
      const abort = () => { request.destroy(); finish(connectionError("CANCELLED")); };
      timer = setTimeout(() => { request.destroy(); finish(connectionError("TIMEOUT")); }, timeoutMs);
      timer.unref?.();
      signal?.addEventListener("abort", abort, { once: true });
      request.on("error", () => finish(connectionError("NETWORK_ERROR")));
      request.end(payload ?? undefined);
    });
  }
  // One app-wide budget also bounds parallel refreshes from multiple windows.
  return (url, options = {}) => new Promise((resolve, reject) => {
    if (queue.length >= 128) { reject(connectionError("BUSY")); return; }
    let waiting = true;
    const cancel = (code) => {
      if (!waiting) return;
      waiting = false;
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(connectionError(code));
    };
    const abort = () => cancel("CANCELLED");
    const start = () => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      running++;
      requestJson(url, options).then(resolve, reject).finally(() => { running--; queue.shift()?.(); });
    };
    const timer = setTimeout(() => cancel("TIMEOUT"), timeoutMs);
    timer.unref?.();
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (running < maxConcurrent) start(); else queue.push(start);
  });
}
