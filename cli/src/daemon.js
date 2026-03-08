#!/usr/bin/env node

/**
 * PuppyOne Daemon — background sync process
 *
 * Implements the "Stateless Mirror" architecture:
 * - Only knows filenames, content hashes, and versions
 * - No UUIDs, no node_ids, no parent_ids
 * - All ID resolution happens on the backend via /sync/{folder_id}/ endpoints
 *
 * Usage (internal, not user-facing):
 *   node daemon.js <folder>
 */

import { createHash } from "node:crypto";
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  unlinkSync, appendFileSync,
} from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import chokidar from "chokidar";
import { loadState, saveState, backupFile } from "./state.js";

const INLINE_EXTS = new Set([".json", ".md", ".markdown"]);
const IGNORED_DIRS = new Set([".puppyone", ".git", "node_modules", "__pycache__"]);

function isInlineType(ext) {
  return INLINE_EXTS.has(ext);
}

const folder = process.argv[2];
if (!folder) {
  process.exit(1);
}

const PUPPYONE_DIR = join(folder, ".puppyone");
const LOG_FILE = join(PUPPYONE_DIR, "daemon.log");
const PID_FILE = join(PUPPYONE_DIR, "daemon.pid");
const STATS_FILE = join(PUPPYONE_DIR, "stats.json");

const stats = {
  pid: process.pid,
  started_at: new Date().toISOString(),
  last_loop_at: null,
  last_sync_at: null,
  last_error: null,
  consecutive_errors: 0,
  files_tracked: 0,
  cursor: 0,
  transfers: { active: [], completed_count: 0, error_count: 0 },
  conflicts: [],
};

function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

function flushStats() {
  try { writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf-8"); } catch { /* ignore */ }
}

function writePid() {
  try {
    mkdirSync(PUPPYONE_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
  } catch { /* ignore */ }
}

function removePid() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function removeStats() {
  try { if (existsSync(STATS_FILE)) unlinkSync(STATS_FILE); } catch { /* ignore */ }
}

function addTransfer(file, direction, bytesTotal) {
  stats.transfers.active.push({ file, direction, bytes_done: 0, bytes_total: bytesTotal, started_at: Date.now() });
  flushStats();
}

function completeTransfer(file, error = false) {
  stats.transfers.active = stats.transfers.active.filter(t => t.file !== file);
  if (error) stats.transfers.error_count++;
  else stats.transfers.completed_count++;
  flushStats();
}

function addConflict(file) {
  stats.conflicts = stats.conflicts.filter(c => c.file !== file);
  stats.conflicts.push({ file, backed_up_at: new Date().toISOString() });
  flushStats();
}

function updateSyncStats(state) {
  stats.last_sync_at = new Date().toISOString();
  stats.files_tracked = Object.keys(state.files ?? {}).length;
  stats.cursor = state.cursor ?? 0;
  flushStats();
}

// ============================================================
// Minimal API client (no commander dependency)
// ============================================================

function makeClient(accessKey, apiUrl, folderId) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const syncBase = `/api/v1/filesystem/${folderId}`;

  async function request(method, path, body, { timeoutMs } = {}) {
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: { "X-Access-Key": accessKey, "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    };
    if (timeoutMs) {
      const ac = new AbortController();
      opts.signal = ac.signal;
      setTimeout(() => ac.abort(), timeoutMs);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message ?? "Unknown error");
    return json.data;
  }

  return {
    pull: (cursor) =>
      request("GET", `${syncBase}/pull?cursor=${cursor}`),
    push: (body) =>
      request("POST", `${syncBase}/push`, body),
    uploadUrl: (body) =>
      request("POST", `${syncBase}/upload-url`, body),
    confirmUpload: (body) =>
      request("POST", `${syncBase}/confirm-upload`, body),
    changes: (cursor, timeout, timeoutMs) =>
      request("GET", `${syncBase}/changes?cursor=${cursor}&timeout=${timeout}`, null, { timeoutMs }),
  };
}

// ============================================================
// Helpers
// ============================================================

function isFileType(type) {
  return type !== "json" && type !== "markdown" && type !== "folder";
}

function serializeContent(file) {
  if (file.type === "json") return JSON.stringify(file.content, null, 2);
  return String(file.content ?? "");
}

function hashString(str) {
  return createHash("sha256").update(str, "utf-8").digest("hex");
}

function hashBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ============================================================
// Pull: cloud → local
// ============================================================

async function applyPull(api, state, suppressSet) {
  try {
    const cursor = state.cursor ?? 0;
    const data = await api.pull(cursor);
    const files = data.files ?? [];
    const newCursor = data.cursor ?? cursor;
    const isFullSync = data.is_full_sync ?? false;

    if (isFullSync) {
      await handleFullSync(files, state, suppressSet);
    } else {
      await handleIncrementalSync(files, state, suppressSet);
    }

    state.cursor = newCursor;
    saveState(folder, state);

    if (data.has_more) {
      await applyPull(api, state, suppressSet);
    }

    updateSyncStats(state);
  } catch (e) {
    log(`pull error: ${e.message}`);
    stats.last_error = e.message;
    flushStats();
  }
}

async function handleFullSync(files, state, suppressSet) {
  const cloudFileNames = new Set();

  for (const file of files) {
    const fileName = file.name;
    cloudFileNames.add(fileName);

    const newVersion = file.version ?? 0;
    const stateEntry = state.files[fileName];
    const localVersion = stateEntry?.version ?? -1;
    if (newVersion <= localVersion) continue;

    if (isFileType(file.type)) {
      await pullFile(file, stateEntry, localVersion, suppressSet, state);
      continue;
    }

    const cloudContent = serializeContent(file);
    const cloudHash = hashString(cloudContent);
    if (stateEntry && stateEntry.hash === cloudHash) {
      state.files[fileName] = { ...stateEntry, version: newVersion };
      continue;
    }

    const filePath = join(folder, fileName);
    if (existsSync(filePath)) {
      const localHash = hashString(readFileSync(filePath, "utf-8"));
      if (localHash !== (stateEntry?.hash ?? "") && localHash !== cloudHash) {
        backupFile(folder, fileName);
        addConflict(fileName);
        log(`conflict ${fileName}: cloud wins, local backed up`);
      }
    }

    mkdirSync(dirname(filePath), { recursive: true });
    suppressSet.add(fileName);
    writeFileSync(filePath, cloudContent, "utf-8");
    setTimeout(() => suppressSet.delete(fileName), 2000);

    state.files[fileName] = { version: newVersion, hash: cloudHash };
    saveState(folder, state);
    log(`pull ${fileName} v${localVersion} → v${newVersion}`);
  }

  for (const [fileName, entry] of Object.entries(state.files)) {
    if (cloudFileNames.has(fileName)) continue;

    const filePath = join(folder, fileName);
    if (existsSync(filePath)) {
      backupFile(folder, fileName);
      suppressSet.add(fileName);
      unlinkSync(filePath);
      setTimeout(() => suppressSet.delete(fileName), 2000);
      log(`delete ${fileName}: removed from cloud, local backed up & deleted`);
    }
    delete state.files[fileName];
    saveState(folder, state);
  }
}

async function pullFile(file, stateEntry, localVersion, suppressSet, state) {
  const fileName = file.name;
  const newVersion = file.version ?? 0;
  if (!file.download_url) {
    log(`skip ${fileName}: no download_url`);
    return;
  }
  try {
    const res = await fetch(file.download_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const cloudHash = hashBuffer(buf);

    if (stateEntry && stateEntry.hash === cloudHash) {
      state.files[fileName] = { ...stateEntry, version: newVersion };
      return;
    }

    const filePath = join(folder, fileName);
    if (existsSync(filePath)) {
      const localHash = hashBuffer(readFileSync(filePath));
      if (localHash !== (stateEntry?.hash ?? "") && localHash !== cloudHash) {
        backupFile(folder, fileName);
        addConflict(fileName);
        log(`conflict ${fileName}: cloud wins, local backed up`);
      }
    }

    mkdirSync(dirname(filePath), { recursive: true });
    suppressSet.add(fileName);
    writeFileSync(filePath, buf);
    setTimeout(() => suppressSet.delete(fileName), 2000);

    state.files[fileName] = {
      version: newVersion, hash: cloudHash, s3: true, mime_type: file.mime_type,
    };
    saveState(folder, state);
    log(`pull file ${fileName} v${localVersion} → v${newVersion} (${buf.length} bytes)`);
  } catch (e) {
    log(`pull file error ${fileName}: ${e.message}`);
  }
}

async function handleIncrementalSync(files, state, suppressSet) {
  for (const file of files) {
    if (file.action === "delete") {
      const fileName = file.name;
      if (!fileName) continue;
      const filePath = join(folder, fileName);
      if (existsSync(filePath)) {
        backupFile(folder, fileName);
        suppressSet.add(fileName);
        unlinkSync(filePath);
        setTimeout(() => suppressSet.delete(fileName), 2000);
        log(`delete ${fileName}: cloud deletion synced`);
      }
      delete state.files[fileName];
      saveState(folder, state);
      continue;
    }

    const fileName = file.name;
    const newVersion = file.version ?? 0;
    const stateEntry = state.files[fileName];
    const localVersion = stateEntry?.version ?? -1;
    if (newVersion <= localVersion) continue;

    if (isFileType(file.type)) {
      await pullFile(file, stateEntry, localVersion, suppressSet, state);
      continue;
    }

    const cloudContent = serializeContent(file);
    const cloudHash = hashString(cloudContent);
    if (stateEntry && stateEntry.hash === cloudHash) {
      state.files[fileName] = { ...stateEntry, version: newVersion };
      continue;
    }

    const filePath = join(folder, fileName);
    if (existsSync(filePath)) {
      const localHash = hashString(readFileSync(filePath, "utf-8"));
      if (localHash !== (stateEntry?.hash ?? "") && localHash !== cloudHash) {
        backupFile(folder, fileName);
        addConflict(fileName);
        log(`conflict ${fileName}: cloud wins, local backed up`);
      }
    }

    mkdirSync(dirname(filePath), { recursive: true });
    suppressSet.add(fileName);
    writeFileSync(filePath, cloudContent, "utf-8");
    setTimeout(() => suppressSet.delete(fileName), 2000);

    state.files[fileName] = { version: newVersion, hash: cloudHash };
    saveState(folder, state);
    log(`pull ${fileName} v${localVersion} → v${newVersion}`);
  }
}

// ============================================================
// Push: local → cloud
// ============================================================

async function pushChange(api, absPath, relPath, ext, state) {
  try {
    if (!existsSync(absPath)) return;

    if (isInlineType(ext)) {
      await pushInlineFile(api, absPath, relPath, ext, state);
    } else {
      await pushS3File(api, absPath, relPath, state);
    }
  } catch (e) {
    log(`push error ${relPath}: ${e.message}`);
  }
}

async function pushInlineFile(api, absPath, relPath, ext, state) {
  const contentStr = readFileSync(absPath, "utf-8");
  const currentHash = hashString(contentStr);
  const stateEntry = state.files[relPath];
  if (stateEntry && stateEntry.hash === currentHash) return;

  let content, nodeType = "markdown";
  if (ext === ".json") {
    try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
  } else {
    content = contentStr;
  }

  try {
    const resp = await api.push({
      filename: relPath,
      content,
      base_version: stateEntry?.version ?? 0,
      node_type: nodeType,
    });
    if (resp.ok) {
      state.files[relPath] = {
        version: resp.version ?? (stateEntry?.version ?? 0) + 1,
        hash: currentHash,
      };
      saveState(folder, state);
      log(`push ${relPath} → v${resp.version} (${resp.status})`);
    }
  } catch (e) {
    if (e.message?.includes("409")) {
      log(`conflict ${relPath}: will pull cloud version on next cycle`);
    } else {
      log(`push error ${relPath}: ${e.message}`);
    }
  }
}

async function pushS3File(api, absPath, relPath, state) {
  const fileBuf = readFileSync(absPath);
  const currentHash = hashBuffer(fileBuf);
  const stateEntry = state.files[relPath];
  if (stateEntry && stateEntry.hash === currentHash) return;

  const mimeType = guessMimeType(relPath);
  addTransfer(relPath, "up", fileBuf.length);

  try {
    const urlResp = await api.uploadUrl({
      filename: relPath,
      content_type: mimeType,
      size_bytes: fileBuf.length,
    });

    if (!urlResp.ok) {
      log(`push s3 error ${relPath}: ${urlResp.message ?? urlResp.error}`);
      return;
    }

    const putRes = await fetch(urlResp.upload_url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: fileBuf,
    });
    if (!putRes.ok) throw new Error(`S3 PUT ${putRes.status}`);

    const confirmResp = await api.confirmUpload({
      filename: relPath,
      size_bytes: fileBuf.length,
      content_hash: currentHash,
    });

    if (confirmResp.ok) {
      state.files[relPath] = {
        version: confirmResp.version ?? 1,
        hash: currentHash,
        s3: true,
      };
      saveState(folder, state);
      completeTransfer(relPath);
      log(`push file ${relPath} → v${confirmResp.version} (${fileBuf.length} bytes via S3)`);
    }
  } catch (e) {
    completeTransfer(relPath, true);
    log(`push s3 error ${relPath}: ${e.message}`);
  }
}

function guessMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav",
    ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
    ".txt": "text/plain", ".yaml": "text/yaml", ".yml": "text/yaml",
    ".csv": "text/csv", ".xml": "application/xml", ".html": "text/html",
  };
  return map[ext] || "application/octet-stream";
}

// ============================================================
// Watcher
// ============================================================

function startWatcher(api, state, suppressSet) {
  const debounceMap = new Map();
  const DEBOUNCE_MS = 500;

  const watcher = chokidar.watch(folder, {
    ignored: (filePath) => {
      const rel = relative(folder, filePath);
      if (!rel) return false;
      const parts = rel.split(/[/\\]/);
      return parts.some((p) => (p.startsWith(".") && p !== ".") || IGNORED_DIRS.has(p));
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  function handleChange(absPath) {
    const ext = extname(absPath).toLowerCase();
    const relPath = relative(folder, absPath);
    if (suppressSet.has(relPath)) return;

    if (debounceMap.has(relPath)) clearTimeout(debounceMap.get(relPath));
    debounceMap.set(
      relPath,
      setTimeout(() => {
        debounceMap.delete(relPath);
        pushChange(api, absPath, relPath, ext, state);
      }, DEBOUNCE_MS),
    );
  }

  function handleDelete(absPath) {
    const relPath = relative(folder, absPath);
    const entry = state.files[relPath];
    if (!entry) return;
    log(`delete ${relPath}: local removed (cloud node preserved)`);
    delete state.files[relPath];
    saveState(folder, state);
  }

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleDelete);

  return watcher;
}

// ============================================================
// Long Poll loop
// ============================================================

const LONG_POLL_TIMEOUT = 30;
const FETCH_TIMEOUT = (LONG_POLL_TIMEOUT + 5) * 1000;
const ERROR_BACKOFF_BASE = 2000;
const ERROR_BACKOFF_MAX = 30000;

let shuttingDown = false;

async function longPollLoop(api, state, suppressSet) {
  let consecutiveErrors = 0;

  while (!shuttingDown) {
    stats.last_loop_at = new Date().toISOString();
    stats.consecutive_errors = consecutiveErrors;
    flushStats();

    try {
      const cursor = state.cursor ?? 0;
      const data = await api.changes(cursor, LONG_POLL_TIMEOUT, FETCH_TIMEOUT);

      consecutiveErrors = 0;

      if (data.has_changes) {
        const files = data.files ?? [];
        const newCursor = data.cursor ?? cursor;
        const isFullSync = data.is_full_sync ?? false;

        if (isFullSync) {
          await handleFullSync(files, state, suppressSet);
        } else {
          await handleIncrementalSync(files, state, suppressSet);
        }

        state.cursor = newCursor;
        saveState(folder, state);

        if (data.has_more) {
          await applyPull(api, state, suppressSet);
        }

        log(`long-poll: ${files.length} changes, cursor ${cursor} → ${newCursor}`);
      } else {
        updateSyncStats(state);
      }
    } catch (e) {
      if (shuttingDown) break;
      consecutiveErrors++;
      stats.last_error = e.message;
      flushStats();
      const backoff = Math.min(ERROR_BACKOFF_BASE * 2 ** (consecutiveErrors - 1), ERROR_BACKOFF_MAX);
      log(`long-poll error: ${e.message}, retry in ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const state = loadState(folder);
  const conn = state.connection;

  if (!conn?.access_key || !conn?.folder_id) {
    log("FATAL: no connection found in state.json (need access_key + folder_id)");
    process.exit(1);
  }

  const api = makeClient(
    conn.access_key,
    conn.api_url ?? "http://localhost:9090",
    conn.folder_id,
  );

  writePid();
  stats.cursor = state.cursor ?? 0;
  stats.files_tracked = Object.keys(state.files ?? {}).length;
  flushStats();
  log(`daemon started (PID ${process.pid}, folder_id ${conn.folder_id}, cursor ${state.cursor ?? 0})`);

  const suppressSet = new Set();
  const watcher = startWatcher(api, state, suppressSet);

  longPollLoop(api, state, suppressSet);

  function shutdown() {
    log("daemon stopping...");
    shuttingDown = true;
    watcher.close();
    saveState(folder, state);
    removePid();
    removeStats();
    log("daemon stopped");
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log("watching for changes (long-poll mode)");
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  removePid();
  process.exit(1);
});
