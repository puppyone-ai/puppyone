/**
 * puppyone openclaw <subcommand>
 *
 * Subcommands:
 *   up          Connect (if needed) + reconcile + start daemon
 *   down        Stop daemon
 *   status      Show connection & daemon status
 *   logs        View daemon log
 *   connect     First-time connection + merge (no daemon)
 *   disconnect  Remove connection + stop daemon
 *
 * Implements the "Stateless Mirror" architecture:
 * - CLI only knows filenames, versions, and hashes
 * - No node_id / UUID anywhere in client code
 * - All ID resolution happens on the backend
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import {
  existsSync, statSync, mkdirSync, writeFileSync,
  readFileSync, readdirSync, openSync, unlinkSync,
} from "node:fs";
import { join, relative, extname } from "node:path";
import { createOpenClawClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig, saveConfig, resolveAuth } from "../config.js";
import { loadState, saveState, backupFile, ensurePuppyOneDir } from "../state.js";
import { registerWorkspace, unregisterWorkspace } from "../registry.js";
import { version as cliVersion } from "../version.js";

const INLINE_EXTS = new Set([".json", ".md", ".markdown"]);
const IGNORED_DIRS = new Set([".puppyone", ".git", "node_modules", "__pycache__"]);
const IGNORED_FILES = new Set([".DS_Store", ".env"]);

function isInlineExt(ext) { return INLINE_EXTS.has(ext); }

function hashBuffer(buf) { return createHash("sha256").update(buf).digest("hex"); }

function guessMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".txt": "text/plain", ".yaml": "text/yaml", ".yml": "text/yaml",
    ".csv": "text/csv", ".xml": "application/xml", ".html": "text/html",
  };
  return map[ext] || "application/octet-stream";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DAEMON_SCRIPT = join(__dirname, "..", "daemon.js");

// ============================================================
// PID helpers
// ============================================================

function pidFile(folder) { return join(folder, ".puppyone", "daemon.pid"); }
function logFile(folder) { return join(folder, ".puppyone", "daemon.log"); }

function readPid(folder) {
  const f = pidFile(folder);
  if (!existsSync(f)) return null;
  const pid = parseInt(readFileSync(f, "utf-8").trim(), 10);
  return isNaN(pid) ? null : pid;
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getDaemonStatus(folder) {
  const pid = readPid(folder);
  if (!pid) return { running: false, pid: null };
  if (isProcessAlive(pid)) return { running: true, pid };
  try { unlinkSync(pidFile(folder)); } catch { /* ignore */ }
  return { running: false, pid: null };
}

// ============================================================
// Path safety
// ============================================================

const DANGEROUS_PATHS = new Set(["/", "/usr", "/etc", "/var", "/tmp", "/bin", "/sbin", "/opt"]);

function isDangerousPath(absPath) {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const normalized = absPath.replace(/\/+$/, "") || "/";
  if (DANGEROUS_PATHS.has(normalized)) return `"${normalized}" is a system directory`;
  if (home && normalized === home) return `"${normalized}" is your home directory`;
  return null;
}

// ============================================================
// Sync API client wrapper (uses /sync/{folder_id}/ endpoints)
// ============================================================

function makeSyncApi(baseApi, folderId) {
  const prefix = `/sync/${folderId}`;
  return {
    pull: (cursor) => baseApi.get(`${prefix}/pull?cursor=${cursor}`),
    push: (body) => baseApi.post(`${prefix}/push`, body),
    uploadUrl: (body) => baseApi.post(`${prefix}/upload-url`, body),
    confirmUpload: (body) => baseApi.post(`${prefix}/confirm-upload`, body),
    deleteFile: (filename) => baseApi.del(`${prefix}/file/${encodeURIComponent(filename)}`),
  };
}

// ============================================================
// Sync confirmation: preview + prompt
// ============================================================

async function promptConfirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function computeMergePlan(cloudFiles, localFiles) {
  const plan = { pulls: [], pushes: [], conflicts: [], deletes: [], unchanged: 0 };
  const cloudByName = new Map();
  for (const file of cloudFiles) cloudByName.set(file.name, file);
  const localByName = new Map();
  for (const file of localFiles) localByName.set(file.relPath, file);

  for (const [fileName, cloudFile] of cloudByName) {
    const localFile = localByName.get(fileName);
    if (!localFile) {
      plan.pulls.push(fileName);
    } else if (isFileType(cloudFile.type)) {
      plan.unchanged++;
    } else {
      const cloudHash = hashString(serializeContent(cloudFile));
      if (cloudHash === localFile.hash) plan.unchanged++;
      else plan.conflicts.push(fileName);
      localByName.delete(fileName);
    }
  }
  for (const [relPath] of localByName) plan.pushes.push(relPath);
  return plan;
}

function computeReconcilePlan(cloudFiles, folder, state) {
  const plan = { pulls: [], pushes: [], conflicts: [], deletes: [], unchanged: 0 };
  const cloudByName = new Map();
  const cloudNames = new Set();
  for (const file of cloudFiles) {
    cloudByName.set(file.name, file);
    cloudNames.add(file.name);
  }
  const localFiles = scanLocalFiles(folder);
  const localByName = new Map();
  for (const file of localFiles) localByName.set(file.relPath, file);

  for (const [fileName, cloudFile] of cloudByName) {
    const localFile = localByName.get(fileName);
    const stateEntry = state.files[fileName];
    if (!localFile) {
      plan.pulls.push(fileName);
    } else if (isFileType(cloudFile.type)) {
      plan.unchanged++;
    } else {
      const cloudHash = hashString(serializeContent(cloudFile));
      if (cloudHash !== localFile.hash) {
        const cloudVersion = cloudFile.version ?? 0;
        const localVersion = stateEntry?.version ?? 0;
        if (cloudVersion > localVersion) plan.pulls.push(fileName);
        else if (stateEntry && localFile.hash !== stateEntry.hash) plan.pushes.push(fileName);
        else plan.unchanged++;
      } else {
        plan.unchanged++;
      }
    }
    localByName.delete(fileName);
  }

  for (const fileName of Object.keys(state.files)) {
    if (cloudNames.has(fileName)) continue;
    plan.deletes.push(fileName);
  }
  for (const [relPath] of localByName) {
    if (state.files[relPath]) continue;
    plan.pushes.push(relPath);
  }
  return plan;
}

function displaySyncPlan(plan, out) {
  const total = plan.pulls.length + plan.pushes.length + plan.conflicts.length + plan.deletes.length;
  out.info("");
  out.info("  ┌─────────────────────────────────┐");
  out.info("  │         Sync Preview             │");
  out.info("  └─────────────────────────────────┘");

  if (plan.pulls.length > 0) {
    out.info(`  ↓ Pull (cloud → local): ${plan.pulls.length} files`);
    for (const f of plan.pulls.slice(0, 10)) out.info(`    · ${f}`);
    if (plan.pulls.length > 10) out.info(`    ... and ${plan.pulls.length - 10} more`);
  }
  if (plan.pushes.length > 0) {
    out.info(`  ↑ Push (local → cloud): ${plan.pushes.length} files`);
    for (const f of plan.pushes.slice(0, 10)) out.info(`    · ${f}`);
    if (plan.pushes.length > 10) out.info(`    ... and ${plan.pushes.length - 10} more`);
  }
  if (plan.conflicts.length > 0) {
    out.info(`  ⚡ Conflicts (cloud wins, local backed up): ${plan.conflicts.length} files`);
    for (const f of plan.conflicts.slice(0, 10)) out.info(`    · ${f}`);
  }
  if (plan.deletes.length > 0) {
    out.info(`  ✕ Delete (local): ${plan.deletes.length} files`);
    for (const f of plan.deletes.slice(0, 10)) out.info(`    · ${f}`);
    if (plan.deletes.length > 10) out.info(`    ... and ${plan.deletes.length - 10} more`);
  }
  if (plan.unchanged > 0) {
    out.info(`  ─ Unchanged: ${plan.unchanged} files`);
  }
  out.info(`  ─────────────────────────────────`);

  if (total === 0) {
    out.info("  Nothing to sync.");
  }
  if (plan.pushes.length > 20) {
    out.info("");
    out.info("  ⚠  WARNING: Large number of files will be uploaded!");
    out.info("     Make sure --path points to the correct workspace folder.");
  }
  out.info("");
}

// ============================================================
// Register subcommands onto a given parent command.
// Used by both `access` and `openclaw` (alias).
// ============================================================

export function registerAgentSubcommands(oc) {

  // --- puppyone openclaw up ---
  oc
    .command("up")
    .description("Connect (if needed), sync, and start background daemon")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .option("--key <access-key>", "access key (first time only)")
    .option("-y, --yes", "skip confirmation prompt")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);
      const rawPath = opts.path || folder;
      if (!rawPath) {
        out.error("MISSING_PATH", "Workspace path is required.", "Usage: puppyone access up --path <folder> --key <key>");
        return;
      }
      const absPath = resolve(rawPath);

      if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
        if (!existsSync(absPath)) {
          mkdirSync(absPath, { recursive: true });
          out.info(`  Created directory: ${absPath}`);
        } else {
          out.error("FOLDER_NOT_FOUND", `Not a directory: ${absPath}`, "Provide a valid folder path.");
          return;
        }
      }

      const danger = isDangerousPath(absPath);
      if (danger) {
        out.error("DANGEROUS_PATH", danger, "Provide a specific workspace folder, e.g. ~/my-workspace or /home/user/project");
        return;
      }

      const daemon = getDaemonStatus(absPath);
      if (daemon.running) {
        out.info("");
        out.info(`  Daemon already running (PID ${daemon.pid}).`);
        out.info(`  Use \`puppyone access down ${absPath}\` to stop, then \`up\` again.`);
        out.info("");
        return;
      }

      const state = loadState(absPath);
      const hasConnection = state.connection?.access_key && state.connection?.folder_id;
      let accessKey = opts.key || process.env.PUPPYONE_ACCESS_KEY || null;

      if (!hasConnection && !accessKey) {
        out.error("MISSING_KEY", "No existing connection and no --key provided.", "Usage: puppyone access up <path> --key <access-key>");
        return;
      }

      out.info("");
      out.info(`PuppyOne CLI v${cliVersion}`);
      out.info("");

      if (!hasConnection) {
        const ok = await doConnect(absPath, accessKey, cmd, state, out, { yes: opts.yes });
        if (!ok) return;
      } else {
        accessKey = state.connection.access_key;
      }

      const baseApi = createOpenClawClient(accessKey, cmd, state.connection?.api_url);
      const syncApi = makeSyncApi(baseApi, state.connection.folder_id);

      out.step("Reconciling...");
      const ok = await reconcile(syncApi, absPath, state, out, { yes: opts.yes });
      if (!ok) return;
      saveState(absPath, state);
      out.done("done");

      const pid = spawnDaemon(absPath);
      out.step("Daemon starting...");
      out.done(`PID ${pid}`);

      out.info("");
      out.info("Sync is running in background.");
      out.info(`  Status:  puppyone access status ${absPath}`);
      out.info(`  Logs:    puppyone access logs ${absPath}`);
      out.info(`  Stop:    puppyone access down ${absPath}`);
      out.info("");
    });

  // --- puppyone openclaw down ---
  oc
    .command("down")
    .description("Stop the background daemon")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);
      const rawPath = opts.path || folder;
      if (!rawPath) { createOutput(cmd).error("MISSING_PATH", "Workspace path is required."); return; }
      const absPath = resolve(rawPath);
      const daemon = getDaemonStatus(absPath);

      if (!daemon.running) {
        out.info("  Daemon is not running.");
        return;
      }

      out.step("Stopping daemon...");
      try {
        process.kill(daemon.pid, "SIGTERM");
        await waitForExit(daemon.pid, 5000);
        out.done(`stopped (PID ${daemon.pid})`);
      } catch {
        try { process.kill(daemon.pid, "SIGKILL"); } catch { /* ignore */ }
        out.done(`killed (PID ${daemon.pid})`);
      }
      try { unlinkSync(pidFile(absPath)); } catch { /* ignore */ }
      out.info("");
    });

  // --- puppyone openclaw logs ---
  oc
    .command("logs")
    .description("View daemon sync log")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .option("-f, --follow", "follow log output (like tail -f)")
    .option("-n, --lines <count>", "number of lines to show", "30")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);
      const rawPath = opts.path || folder;
      if (!rawPath) { createOutput(cmd).error("MISSING_PATH", "Workspace path is required."); return; }
      const absPath = resolve(rawPath);
      const logPath = logFile(absPath);

      if (!existsSync(logPath)) {
        out.info("  No log file found. Run `puppyone access up <path>` first.");
        return;
      }

      if (opts.follow) {
        await tailFollow(logPath, parseInt(opts.lines, 10) || 30);
      } else {
        const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
        const n = parseInt(opts.lines, 10) || 30;
        const tail = lines.slice(-n);
        for (const line of tail) out.info(line);
      }
    });

  // --- puppyone openclaw connect ---
  oc
    .command("connect")
    .description("First-time connection + merge (no daemon)")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .option("--key <access-key>", "access key")
    .option("-y, --yes", "skip confirmation prompt")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);
      const rawPath = opts.path || folder;
      if (!rawPath) { createOutput(cmd).error("MISSING_PATH", "Workspace path is required."); return; }
      const absPath = resolve(rawPath);

      if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
        out.error("FOLDER_NOT_FOUND", `Not a directory: ${absPath}`, "Provide a valid folder path.");
        return;
      }

      const danger = isDangerousPath(absPath);
      if (danger) {
        out.error("DANGEROUS_PATH", danger, "Provide a specific workspace folder, e.g. ~/my-workspace");
        return;
      }

      const accessKey = opts.key || process.env.PUPPYONE_ACCESS_KEY;
      if (!accessKey) {
        out.error("MISSING_KEY", "Access key is required.", "Usage: puppyone access up <folder> --key <key>");
        return;
      }

      const state = loadState(absPath);
      const ok = await doConnect(absPath, accessKey, cmd, state, out, { yes: opts.yes });
      if (!ok) return;

      out.info("");
      out.info("  Next: puppyone access up <folder>");
      out.info("");
    });

  // --- puppyone openclaw disconnect ---
  oc
    .command("disconnect")
    .description("Remove connection and stop daemon (alias for remove)")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .option("--key <access-key>", "access key (or auto-detect)")
    .action(async (folder, opts, cmd) => {
      const rawPath = opts.path || folder;
      if (!rawPath) { createOutput(cmd).error("MISSING_PATH", "Workspace path is required."); return; }
      await doRemove(rawPath, opts, cmd);
    });

  // --- puppyone openclaw remove ---
  oc
    .command("remove")
    .description("Stop daemon, disconnect from cloud, and unregister workspace")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .option("--key <access-key>", "access key (or auto-detect)")
    .action(async (folder, opts, cmd) => {
      const rawPath = opts.path || folder;
      if (!rawPath) { createOutput(cmd).error("MISSING_PATH", "Workspace path is required."); return; }
      await doRemove(rawPath, opts, cmd);
    });

  // --- puppyone openclaw trigger ---
  oc
    .command("trigger")
    .description("Force an immediate sync cycle")
    .argument("[folder]", "workspace folder path (or use --path)")
    .option("-p, --path <path>", "workspace folder path")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);
      const rawPath = opts.path || folder;
      if (!rawPath) { out.error("MISSING_PATH", "Workspace path is required."); return; }
      const absPath = resolve(rawPath);
      const daemon = getDaemonStatus(absPath);

      if (!daemon.running) {
        out.error("NOT_RUNNING", "Daemon is not running.", `Start it with: puppyone access up ${absPath}`);
        return;
      }

      try { process.kill(daemon.pid, "SIGUSR1"); } catch { /* ignore */ }
      out.info("  Trigger sent. Check logs for sync activity.");
    });
}

// ============================================================
// Register: puppyone openclaw <subcommand>  (backward-compat alias)
// ============================================================

export function registerOpenClaw(program) {
  const oc = program
    .command("openclaw")
    .alias("oc")
    .description("Manage agent workspace sync (alias for `access`)");
  registerAgentSubcommands(oc);
}

async function doRemove(folder, opts, cmd) {
  const out = createOutput(cmd);
  const absPath = resolve(folder);

  const daemon = getDaemonStatus(absPath);
  if (daemon.running) {
    try { process.kill(daemon.pid, "SIGTERM"); } catch { /* ignore */ }
    await waitForExit(daemon.pid, 3000).catch(() => {});
    try { unlinkSync(pidFile(absPath)); } catch { /* ignore */ }
    out.info("  Daemon stopped.");
  }

  const state = loadState(absPath);
  const accessKey = opts.key || state.connection?.access_key || process.env.PUPPYONE_ACCESS_KEY;

  if (!accessKey) {
    out.error("MISSING_KEY", "Cannot determine access key.", "Provide --key or run from a connected workspace.");
    return;
  }

  let api;
  try {
    api = createOpenClawClient(accessKey, cmd, state.connection?.api_url);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("UNKNOWN", e.message);
    return;
  }

  try {
    const data = await api.del("/sync/openclaw/disconnect");
    out.info(`  ${data.message ?? "Disconnected"}`);

    unregisterWorkspace(absPath);

    const config = loadConfig();
    const ocConns = (config.openclaw_connections ?? []).filter((c) => c.access_key !== accessKey);
    saveConfig({ openclaw_connections: ocConns });

    out.info(`  Workspace unregistered. Local files preserved.`);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("DISCONNECT_FAILED", e.message);
  }
}

// ============================================================
// Core: Connect
// ============================================================

async function doConnect(absPath, accessKey, cmd, state, out, opts = {}) {
  let api;
  try {
    const { apiUrl: resolvedUrl } = resolveAuth(cmd);
    const effectiveApiUrl = resolvedUrl ?? "http://localhost:9090";
    api = createOpenClawClient(accessKey, cmd);

    out.step("Authenticating...");
    const data = await api.post("/sync/openclaw/connect", { workspace_path: absPath });

    if (!data.folder_id) {
      out.done("");
      out.error("NO_FOLDER", "Agent has no writable folder configured.", "Configure a folder binding in the web UI first.");
      return false;
    }

    out.done(`Connected (folder ${data.folder_id.slice(0, 8)}...)`);

    ensurePuppyOneDir(absPath);

    out.step("Scanning files...");
    const cloudFiles = data.files ?? [];
    const localFiles = scanLocalFiles(absPath);
    out.done(`${cloudFiles.length} cloud, ${localFiles.length} local`);

    const plan = computeMergePlan(cloudFiles, localFiles);
    const hasChanges = plan.pulls.length + plan.pushes.length + plan.conflicts.length > 0;

    if (hasChanges) {
      displaySyncPlan(plan, out);
      if (!opts.yes) {
        const confirmed = await promptConfirm("  Proceed with sync? [y/N]: ");
        if (!confirmed) {
          out.info("  Sync cancelled. Connection saved but no files synced.");
          state.connection = {
            access_key: accessKey,
            api_url: effectiveApiUrl,
            folder_id: data.folder_id,
            source_id: data.source_id,
            agent_id: data.agent_id,
            project_id: data.project_id,
          };
          state.cursor = data.cursor ?? 0;
          saveState(absPath, state);
          return false;
        }
      }
    }

    out.step("Syncing...");
    const syncApi = makeSyncApi(api, data.folder_id);
    const mergeResult = await executeMerge(syncApi, absPath, cloudFiles, localFiles);
    out.done(`${mergeResult.pulled} pulled, ${mergeResult.pushed} pushed, ${mergeResult.conflicts} conflicts`);

    state.files = mergeResult.fileMap;
    state.cursor = data.cursor ?? 0;
    state.connection = {
      access_key: accessKey,
      api_url: effectiveApiUrl,
      folder_id: data.folder_id,
      source_id: data.source_id,
      agent_id: data.agent_id,
      project_id: data.project_id,
    };
    saveState(absPath, state);

    registerWorkspace(absPath, {
      access_key: accessKey,
      api_url: effectiveApiUrl,
      agent_id: data.agent_id,
      project_id: data.project_id,
      source_id: data.source_id,
      folder_id: data.folder_id,
    });

    const config = loadConfig();
    const ocConnections = config.openclaw_connections ?? [];
    const existing = ocConnections.findIndex((c) => c.access_key === accessKey);
    const conn = { access_key: accessKey, api_url: effectiveApiUrl, folder: absPath };
    if (existing >= 0) ocConnections[existing] = conn;
    else ocConnections.push(conn);
    saveConfig({ openclaw_connections: ocConnections });

    return true;
  } catch (e) {
    out.done("");
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("CONNECT_FAILED", e.message, "Check the access key and API URL.");
    return false;
  }
}

// ============================================================
// Core: Spawn daemon
// ============================================================

function spawnDaemon(absPath) {
  const logPath = logFile(absPath);
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", "utf-8");

  const fd = openSync(logPath, "a");

  const child = spawn(process.execPath, [DAEMON_SCRIPT, absPath], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env },
  });

  child.unref();
  return child.pid;
}

// ============================================================
// Core: Reconcile (simplified — no node_id, no folder expansion)
// ============================================================

async function reconcile(syncApi, folder, state, out, opts = {}) {
  try {
    const cursor = state.cursor ?? 0;
    const data = await syncApi.pull(cursor);
    const cloudFiles = data.files ?? [];
    const isFullSync = data.is_full_sync ?? false;

    if (isFullSync) {
      const plan = computeReconcilePlan(cloudFiles, folder, state);
      const hasChanges = plan.pulls.length + plan.pushes.length + plan.conflicts.length + plan.deletes.length > 0;

      if (hasChanges) {
        out.done("");
        displaySyncPlan(plan, out);
        if (!opts.yes) {
          const confirmed = await promptConfirm("  Proceed with sync? [y/N]: ");
          if (!confirmed) {
            out.info("  Sync cancelled.");
            return false;
          }
        }
        out.step("Executing sync...");
      }

      const localFiles = scanLocalFiles(folder);
      const cloudByName = new Map();
      const cloudNames = new Set();

      for (const file of cloudFiles) {
        cloudByName.set(file.name, file);
        cloudNames.add(file.name);
      }

      const localByName = new Map();
      for (const file of localFiles) localByName.set(file.relPath, file);

      for (const [fileName, cloudFile] of cloudByName) {
        const localFile = localByName.get(fileName);
        const stateEntry = state.files[fileName];
        const isFile = isFileType(cloudFile.type);

        if (!localFile) {
          await pullToLocal(folder, cloudFile, state);
        } else if (isFile) {
          state.files[fileName] = {
            version: cloudFile.version ?? 0, hash: localFile.hash, s3: true,
          };
        } else {
          const cloudContent = serializeContent(cloudFile);
          const cloudHash = hashString(cloudContent);
          if (cloudHash !== localFile.hash) {
            const cloudVersion = cloudFile.version ?? 0;
            const localVersion = stateEntry?.version ?? 0;
            if (cloudVersion > localVersion) {
              backupFile(folder, fileName);
              writeFileSync(join(folder, fileName), cloudContent, "utf-8");
              state.files[fileName] = { version: cloudVersion, hash: cloudHash };
            } else if (stateEntry && localFile.hash !== stateEntry.hash) {
              await pushExistingFile(syncApi, folder, fileName, localFile, state);
            } else if (!stateEntry) {
              state.files[fileName] = { version: cloudVersion, hash: localFile.hash };
            }
          } else {
            state.files[fileName] = { version: cloudFile.version ?? 0, hash: cloudHash };
          }
        }
        localByName.delete(fileName);
      }

      for (const [fileName] of Object.entries(state.files)) {
        if (cloudNames.has(fileName)) continue;
        const filePath = join(folder, fileName);
        if (existsSync(filePath)) {
          backupFile(folder, fileName);
          unlinkSync(filePath);
        }
        delete state.files[fileName];
      }

      for (const [relPath, file] of localByName) {
        if (state.files[relPath]) continue;
        await pushNewFile(syncApi, folder, relPath, file, state);
      }
    } else {
      for (const file of cloudFiles) {
        if (file.action === "delete") {
          const fileName = file.name;
          if (!fileName) continue;
          const filePath = join(folder, fileName);
          if (existsSync(filePath)) {
            backupFile(folder, fileName);
            unlinkSync(filePath);
          }
          delete state.files[fileName];
          continue;
        }

        const fileName = file.name;
        const stateEntry = state.files[fileName];
        const newVersion = file.version ?? 0;

        if (isFileType(file.type)) {
          await pullToLocal(folder, file, state);
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
          }
        }

        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, cloudContent, "utf-8");
        state.files[fileName] = { version: newVersion, hash: cloudHash };
      }
    }

    state.cursor = data.cursor ?? cursor;
    saveState(folder, state);
    return true;
  } catch (err) {
    console.error(`[reconcile] error: ${err.message || err}`);
    if (err.stack) console.error(err.stack);
    return true;
  }
}

function isFileType(type) {
  return type !== "json" && type !== "markdown" && type !== "folder";
}

async function pullToLocal(folder, cloudFile, state) {
  const fileName = cloudFile.name;
  const filePath = join(folder, fileName);
  mkdirSync(dirname(filePath), { recursive: true });

  if (isFileType(cloudFile.type)) {
    if (!cloudFile.download_url) return;
    try {
      const res = await fetch(cloudFile.download_url);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(filePath, buf);
      state.files[fileName] = {
        version: cloudFile.version ?? 0, hash: hashBuffer(buf), s3: true,
      };
    } catch { /* skip */ }
  } else {
    const content = serializeContent(cloudFile);
    writeFileSync(filePath, content, "utf-8");
    state.files[fileName] = {
      version: cloudFile.version ?? 0, hash: hashString(content),
    };
  }
}

function serializeContent(file) {
  if (file.type === "json") return JSON.stringify(file.content, null, 2);
  return String(file.content ?? "");
}

function hashString(str) {
  return createHash("sha256").update(str, "utf-8").digest("hex");
}

// ============================================================
// Merge (used by connect)
// ============================================================

async function executeMerge(syncApi, folder, cloudFiles, localFiles) {
  const fileMap = {};
  let pulled = 0, pushed = 0, skipped = 0, conflicts = 0;

  const cloudByName = new Map();
  for (const file of cloudFiles) {
    cloudByName.set(file.name, file);
  }

  const localByName = new Map();
  for (const file of localFiles) localByName.set(file.relPath, file);

  for (const [fileName, cloudFile] of cloudByName) {
    const localFile = localByName.get(fileName);
    if (!localFile) {
      const filePath = join(folder, fileName);
      mkdirSync(dirname(filePath), { recursive: true });

      if (isFileType(cloudFile.type)) {
        if (cloudFile.download_url) {
          try {
            const res = await fetch(cloudFile.download_url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              writeFileSync(filePath, buf);
              fileMap[fileName] = { version: cloudFile.version ?? 0, hash: hashBuffer(buf), s3: true };
              pulled++;
            }
          } catch { /* skip */ }
        }
      } else {
        const content = serializeContent(cloudFile);
        writeFileSync(filePath, content, "utf-8");
        fileMap[fileName] = { version: cloudFile.version ?? 0, hash: hashString(content) };
        pulled++;
      }
    } else {
      if (isFileType(cloudFile.type)) {
        fileMap[fileName] = { version: cloudFile.version ?? 0, hash: localFile.hash, s3: true };
        skipped++;
      } else {
        const cloudContent = serializeContent(cloudFile);
        const cloudHash = hashString(cloudContent);
        if (cloudHash === localFile.hash) {
          fileMap[fileName] = { version: cloudFile.version ?? 0, hash: localFile.hash };
          skipped++;
        } else {
          backupFile(folder, fileName);
          writeFileSync(join(folder, fileName), cloudContent, "utf-8");
          fileMap[fileName] = { version: cloudFile.version ?? 0, hash: cloudHash };
          conflicts++;
        }
      }
      localByName.delete(fileName);
    }
  }

  for (const [relPath, file] of localByName) {
    try {
      if (file.inline) {
        await pushNewInlineFile(syncApi, folder, relPath, file, fileMap);
      } else {
        await pushNewS3File(syncApi, folder, relPath, file, fileMap);
      }
      pushed++;
    } catch { /* skip */ }
  }

  return { fileMap, pulled, pushed, skipped, conflicts };
}

// ============================================================
// Push helpers
// ============================================================

async function pushNewInlineFile(syncApi, folder, relPath, file, fileMap) {
  const contentStr = readFileSync(join(folder, relPath), "utf-8");
  const ext = extname(relPath).toLowerCase();
  let content, nodeType = "markdown";
  if (ext === ".json") {
    try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
  } else { content = contentStr; }
  const resp = await syncApi.push({
    filename: relPath, content, base_version: 0, node_type: nodeType,
  });
  if (resp.ok) {
    fileMap[relPath] = { version: resp.version ?? 1, hash: file.hash };
  }
}

async function pushNewS3File(syncApi, folder, relPath, file, fileMap) {
  const fileBuf = readFileSync(join(folder, relPath));
  const mimeType = guessMimeType(relPath);
  const urlResp = await syncApi.uploadUrl({
    filename: relPath, content_type: mimeType, size_bytes: fileBuf.length,
  });
  if (!urlResp.ok) return;

  const putRes = await fetch(urlResp.upload_url, {
    method: "PUT", headers: { "Content-Type": mimeType }, body: fileBuf,
  });
  if (!putRes.ok) return;

  const confirmResp = await syncApi.confirmUpload({
    filename: relPath, size_bytes: fileBuf.length, content_hash: hashBuffer(fileBuf),
  });
  if (confirmResp.ok) {
    fileMap[relPath] = { version: confirmResp.version ?? 1, hash: file.hash, s3: true };
  }
}

async function pushExistingFile(syncApi, folder, fileName, localFile, state) {
  const stateEntry = state.files[fileName];
  const ext = extname(fileName).toLowerCase();

  if (!isInlineExt(ext)) {
    const fileBuf = readFileSync(join(folder, fileName));
    const mimeType = guessMimeType(fileName);
    try {
      const urlResp = await syncApi.uploadUrl({
        filename: fileName, content_type: mimeType, size_bytes: fileBuf.length,
      });
      if (!urlResp.ok) return;
      const putRes = await fetch(urlResp.upload_url, {
        method: "PUT", headers: { "Content-Type": mimeType }, body: fileBuf,
      });
      if (!putRes.ok) return;
      const confirmResp = await syncApi.confirmUpload({
        filename: fileName, size_bytes: fileBuf.length, content_hash: hashBuffer(fileBuf),
      });
      if (confirmResp.ok) {
        state.files[fileName] = {
          version: confirmResp.version ?? (stateEntry?.version ?? 0) + 1,
          hash: localFile.hash, s3: true,
        };
      }
    } catch { /* ignore */ }
    return;
  }

  const contentStr = readFileSync(join(folder, fileName), "utf-8");
  let content, nodeType = "markdown";
  if (ext === ".json") {
    try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
  } else { content = contentStr; }
  try {
    const resp = await syncApi.push({
      filename: fileName, content, base_version: stateEntry?.version ?? 0, node_type: nodeType,
    });
    if (resp.ok) {
      state.files[fileName] = {
        version: resp.version ?? (stateEntry?.version ?? 0) + 1, hash: localFile.hash,
      };
    }
  } catch { /* ignore */ }
}

async function pushNewFile(syncApi, folder, relPath, file, state) {
  if (file.inline) {
    const fileMap = {};
    await pushNewInlineFile(syncApi, folder, relPath, file, fileMap);
    if (fileMap[relPath]) state.files[relPath] = fileMap[relPath];
  } else {
    const fileMap = {};
    await pushNewS3File(syncApi, folder, relPath, file, fileMap);
    if (fileMap[relPath]) state.files[relPath] = fileMap[relPath];
  }
}

// ============================================================
// Tail follow
// ============================================================

async function tailFollow(logPath, initialLines) {
  const fs = await import("node:fs");
  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  for (const line of lines.slice(-initialLines)) console.log(line);

  let position = statSync(logPath).size;

  const check = () => {
    try {
      const currentSize = statSync(logPath).size;
      if (currentSize > position) {
        const buf = Buffer.alloc(currentSize - position);
        const fd = fs.openSync(logPath, "r");
        fs.readSync(fd, buf, 0, buf.length, position);
        fs.closeSync(fd);
        const newContent = buf.toString("utf-8");
        const newLines = newContent.split("\n").filter(Boolean);
        for (const line of newLines) console.log(line);
        position = currentSize;
      }
    } catch { /* ignore */ }
  };

  const timer = setInterval(check, 500);

  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });

  await new Promise(() => {});
}

// ============================================================
// Utilities
// ============================================================

function waitForExit(pid, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (!isProcessAlive(pid)) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(check, 100);
    };
    check();
  });
}

function scanLocalFiles(folder) {
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry) || IGNORED_FILES.has(entry) || entry.startsWith(".")) continue;
      const abs = join(dir, entry);
      let stat;
      try { stat = statSync(abs); } catch { continue; }
      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        const relPath = relative(folder, abs);
        if (ext && isInlineExt(ext)) {
          const content = readFileSync(abs, "utf-8");
          files.push({ relPath, absPath: abs, ext, hash: hashString(content), inline: true });
        } else {
          const buf = readFileSync(abs);
          files.push({ relPath, absPath: abs, ext: ext || "", hash: hashBuffer(buf), inline: false, size: buf.length });
        }
      }
    }
  }
  walk(folder);
  return files;
}
