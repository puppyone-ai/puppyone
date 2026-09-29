import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sha256File, verifyDesktopReleaseBundle } from "./desktop-release-metadata.mjs";

export const REMOTE_VERIFICATION_DEFAULTS = Object.freeze({
  concurrency: 3,
  attempts: 3,
  requestTimeoutMs: 15_000,
  idleTimeoutMs: 30_000,
  attemptTimeoutMs: 180_000,
  fileTimeoutMs: 300_000,
  progressIntervalMs: 10_000,
  retryDelayMs: 1_000,
});

export function normalizeReleaseUrlPrefix(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Release URL prefix must be credential-free HTTPS without query or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

export function createAuthorizationHeaders(environment) {
  const headers = {};
  if (environment.PUPPYONE_INTERNAL_RELEASE_TOKEN) {
    headers.Authorization = `Bearer ${environment.PUPPYONE_INTERNAL_RELEASE_TOKEN}`;
  }
  if (environment.CF_ACCESS_CLIENT_ID && environment.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = environment.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = environment.CF_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

// Validate every local bundle before issuing ANY remote request. Reuse local
// digests across origins, but verify every distinct public URL, including aliases.
export async function collectRemoteReleaseEntries(targets, {
  includeAliases = false,
  includeMetadata = false,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error("At least one release target is required");
  const bundles = new Map();
  const groups = [];
  for (const target of targets) {
    const bundle = path.resolve(target.bundle);
    const prefix = normalizeReleaseUrlPrefix(target.urlPrefix);
    if (!bundles.has(bundle)) {
      const { manifest } = await verifyDesktopReleaseBundle(bundle);
      const files = manifest.assets.map(asset => ({
        name: asset.name, bytes: asset.bytes, sha256: asset.sha256,
        alias: asset.latestAlias,
      }));
      if (includeMetadata) {
        for (const name of ["release.json", "SHA256SUMS", "build-info.json"]) {
          const localPath = path.join(bundle, name);
          const stats = await fs.stat(localPath).catch(error => {
            if (error.code === "ENOENT" && name === "build-info.json") return null;
            throw error;
          });
          if (stats) files.push({ name, bytes: stats.size, sha256: await sha256File(localPath) });
        }
      }
      bundles.set(bundle, files);
    }
    groups.push(bundles.get(bundle).flatMap(file => {
      const names = includeAliases && file.alias ? [file.name, file.alias] : [file.name];
      return names.map(name => ({ url: `${prefix}/${encodeURIComponent(name)}`, bytes: file.bytes, sha256: file.sha256 }));
    }));
  }
  // Round-robin targets: a large macOS archive must not queue every Windows URL
  // behind it. All platforms and origins share ONE worker pool.
  const entries = new Map();
  for (let index = 0; index < Math.max(...groups.map(group => group.length)); index++) {
    for (const group of groups) {
      const entry = group[index];
      if (!entry) continue;
      const previous = entries.get(entry.url);
      if (previous && (previous.bytes !== entry.bytes || previous.sha256 !== entry.sha256)) {
        throw new Error(`Conflicting release digests for ${entry.url}`);
      }
      entries.set(entry.url, entry);
    }
  }
  return [...entries.values()];
}

export async function verifyRemoteReleaseEntries(entries, {
  fetchImpl = globalThis.fetch,
  headers = {},
  onEvent = event => console.log(`[release-verify] ${JSON.stringify(event)}`),
  ...overrides
} = {}) {
  const options = { ...REMOTE_VERIFICATION_DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(options)) {
    if (!(key in REMOTE_VERIFICATION_DEFAULTS) || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Invalid remote verification option ${key}: ${value}`);
    }
  }
  if (options.concurrency > 8 || options.attempts > 5) throw new Error("Verification permits at most 8 workers and 5 attempts");
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("No release files to verify");
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid expected release digest for ${entry.url}`);
    }
  }
  const started = Date.now();
  const failures = [];
  let next = 0;
  let verified = 0;
  let bytes = 0;
  onEvent({ event: "start", files: entries.length, concurrency: options.concurrency });
  async function worker() {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        await verifyFile(entry, { ...options, fetchImpl, headers, onEvent });
        verified++;
        bytes += entry.bytes;
      } catch (error) {
        failures.push(`${entry.url}: ${error.message}`);
        onEvent({ event: "failed", url: entry.url, reason: error.message });
      }
    }
  }
  // Drain every worker before rejecting; callers may start rollback on failure.
  await Promise.all(Array.from({ length: Math.min(options.concurrency, entries.length) }, worker));
  const summary = { event: "summary", files: entries.length, verified, failed: failures.length, bytes, elapsedMs: Date.now() - started };
  onEvent(summary);
  if (failures.length) throw new AggregateError(failures.map(message => new Error(message)), `Remote release verification failed:\n${failures.join("\n")}`);
  return summary;
}

class TransferError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

async function verifyFile(entry, options) {
  const started = Date.now();
  const deadline = started + options.fileTimeoutMs;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    if (Date.now() >= deadline) throw new TransferError("File time budget exhausted", false);
    try {
      await downloadAndHash(entry, options, attempt, deadline);
      options.onEvent({ event: "verified", url: entry.url, bytes: entry.bytes, attempt, elapsedMs: Date.now() - started });
      return;
    } catch (error) {
      const remaining = deadline - Date.now();
      const retryMs = options.retryDelayMs * attempt;
      if (error.retryable === false || attempt === options.attempts || remaining <= retryMs) throw error;
      options.onEvent({ event: "retry", url: entry.url, attempt, nextAttempt: attempt + 1, delayMs: retryMs, reason: error.message });
      await delay(retryMs);
    }
  }
}

async function downloadAndHash(entry, options, attempt, deadline) {
  const controller = new AbortController();
  const started = Date.now();
  const remaining = Math.max(1, deadline - started);
  const abort = reason => controller.abort(new TransferError(reason, true));
  const totalTimer = setTimeout(() => abort(remaining <= options.attemptTimeoutMs
    ? "File time budget exhausted" : "Attempt time limit exceeded"), Math.min(remaining, options.attemptTimeoutMs));
  const requestTimer = setTimeout(() => abort("Response headers timed out"), options.requestTimeoutMs);
  let idleTimer;
  let reader;
  let response;
  let bytes = 0;
  const emitProgress = () => options.onEvent({
    event: "progress", url: entry.url, attempt, bytes, expectedBytes: entry.bytes,
    elapsedMs: Date.now() - started,
    bytesPerSecond: Math.round(bytes * 1000 / Math.max(1, Date.now() - started)),
  });
  const progressTimer = setInterval(emitProgress, options.progressIntervalMs);
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("Download stalled without receiving data"), options.idleTimeoutMs);
  };
  options.onEvent({ event: "attempt", url: entry.url, attempt, expectedBytes: entry.bytes });
  try {
    response = await options.fetchImpl(entry.url, {
      // Never follow redirects: Internal requests may carry access credentials.
      redirect: "manual",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache", "User-Agent": "puppyone-release-verifier/2", ...options.headers },
    });
    clearTimeout(requestTimer);
    if (response.status !== 200 || !response.body) {
      const retryable = [404, 408, 429].includes(response.status) || response.status >= 500;
      throw new TransferError(`HTTP ${response.status}; expected a complete HTTP 200 payload`, retryable);
    }
    const hash = createHash("sha256");
    reader = response.body.getReader();
    resetIdleTimer();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      resetIdleTimer();
      bytes += value.byteLength;
      if (bytes > entry.bytes) throw new TransferError(`Payload exceeds expected size ${entry.bytes}`, false);
      hash.update(value);
    }
    const digest = hash.digest("hex");
    if (bytes !== entry.bytes || digest !== entry.sha256) {
      throw new TransferError(`Digest mismatch: expected ${entry.bytes} bytes/${entry.sha256}, received ${bytes} bytes/${digest}`, false);
    }
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(requestTimer);
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    clearInterval(progressTimer);
    // Close HTTP error, oversized and timed-out bodies before retrying/reusing a slot.
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else {
      await response?.body?.cancel().catch(() => {});
    }
  }
}
