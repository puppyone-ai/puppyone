import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import chokidar from "chokidar";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, createOpenClawClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig, saveConfig } from "../config.js";
import { loadState, saveState, backupFile } from "../state.js";
import { nodeToFilename, serializeNodeContent, hashString, scanLocalFiles } from "./connect.js";

const SUPPORTED_EXTS = new Set([".json", ".md", ".markdown", ".txt", ".yaml", ".yml"]);

export function registerWatch(program) {
  program
    .command("watch")
    .description("Watch local folder for changes and sync continuously")
    .option("--key <access-key>", "OpenClaw access key (uses /access/openclaw endpoints)")
    .option("-s, --source <id>", "source ID (sync mode, omit to watch all connections)")
    .option("-i, --interval <seconds>", "poll interval for remote changes", "30")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);

      if (opts.key) {
        await watchOpenClaw(opts, cmd, out);
      } else {
        await watchSync(opts, cmd, out);
      }
    });
}

// ============================================================
// OpenClaw watch mode
// ============================================================

async function watchOpenClaw(opts, cmd, out) {
  const config = loadConfig();
  const conn = findOpenClawConnection(config, opts.key);
  if (!conn) {
    out.error(
      "NOT_CONNECTED",
      "No OpenClaw connection found for this key.",
      `Run \`puppyone connect --key ${opts.key} <workspace-folder>\` first.`,
    );
    return;
  }

  if (!existsSync(conn.folder)) {
    out.error("FOLDER_NOT_FOUND", `Workspace folder not found: ${conn.folder}`);
    return;
  }

  let api;
  try {
    api = createOpenClawClient(opts.key, cmd, conn.api_url);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("UNKNOWN", e.message);
    return;
  }

  const interval = Math.max(5, parseInt(opts.interval, 10) || 30) * 1000;

  out.info(`\nWatching ${conn.folder} ↔ PuppyOne`);
  out.info(`  API:  ${conn.api_url ?? "http://localhost:9090"}`);
  out.info(`  Poll: ${interval / 1000}s\n`);

  // Initial reconciliation (full merge)
  out.info("  Reconciling...");
  const state = loadState(conn.folder);
  await openClawReconcile(api, conn.folder, state, out);
  saveState(conn.folder, state);
  out.info("  ✓ Reconciliation complete\n");

  // Track files being written by pull (suppress watcher echo)
  const suppressSet = new Set();

  // Local file watcher → push changes to cloud
  const watcher = startOpenClawWatcher(api, conn.folder, state, suppressSet, out);

  // Periodic remote poll → pull changes from cloud
  const timer = setInterval(async () => {
    await openClawPoll(api, conn.folder, state, suppressSet, out);
  }, interval);

  out.info(`  Watching for changes. Press Ctrl+C to stop.\n`);

  process.on("SIGINT", () => {
    out.info("\nStopping watcher...");
    watcher.close();
    clearInterval(timer);
    saveState(conn.folder, state);
    process.exit(0);
  });

  await new Promise(() => {});
}

/**
 * Full reconciliation on startup: same merge logic as connect.
 * Ensures nothing was missed while watch was not running.
 */
async function openClawReconcile(api, folder, state, out) {
  try {
    const data = await api.get("/access/openclaw/pull");
    const cloudNodes = data.nodes ?? [];
    const localFiles = scanLocalFiles(folder);

    const cloudByName = new Map();
    for (const node of cloudNodes) {
      cloudByName.set(nodeToFilename(node), node);
    }

    const localByName = new Map();
    for (const file of localFiles) {
      localByName.set(file.relPath, file);
    }

    // Cloud → local
    for (const [fileName, node] of cloudByName) {
      const localFile = localByName.get(fileName);
      const cloudContent = serializeNodeContent(node);
      const cloudHash = hashString(cloudContent);
      const stateEntry = state.files[fileName];

      if (!localFile) {
        const filePath = join(folder, fileName);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, cloudContent, "utf-8");
        state.files[fileName] = { node_id: node.node_id, version: node.version ?? 0, hash: cloudHash };
        out.info(`    ↓ ${fileName} (new from cloud)`);
      } else if (cloudHash !== localFile.hash) {
        const cloudVersion = node.version ?? 0;
        const localVersion = stateEntry?.version ?? 0;

        if (cloudVersion > localVersion) {
          backupFile(folder, fileName);
          writeFileSync(join(folder, fileName), cloudContent, "utf-8");
          state.files[fileName] = { node_id: node.node_id, version: cloudVersion, hash: cloudHash };
          out.info(`    ↓ ${fileName} (cloud wins, local backed up)`);
        } else if (stateEntry && localFile.hash !== stateEntry.hash) {
          // Local changed since last sync, push to cloud
          await pushLocalFile(api, folder, fileName, localFile, state, out);
        }
      } else {
        // Same content, just update state
        state.files[fileName] = { node_id: node.node_id, version: node.version ?? 0, hash: cloudHash };
      }
      localByName.delete(fileName);
    }

    // Local-only → push to cloud
    for (const [relPath, file] of localByName) {
      if (state.files[relPath]?.node_id) {
        // Was previously synced but now missing from cloud — skip for now
        continue;
      }
      await pushNewLocalFile(api, folder, relPath, file, state, out);
    }
  } catch (e) {
    out.info(`    ✗ reconciliation error: ${e.message}`);
  }
}

/**
 * Periodic poll: pull cloud changes.
 */
async function openClawPoll(api, folder, state, suppressSet, out) {
  try {
    const data = await api.get("/access/openclaw/pull");
    const nodes = data.nodes ?? [];

    for (const node of nodes) {
      const fileName = nodeToFilename(node);
      const newVersion = node.version ?? 0;
      const stateEntry = state.files[fileName];
      const localVersion = stateEntry?.version ?? -1;

      if (newVersion <= localVersion) continue;

      const cloudContent = serializeNodeContent(node);
      const cloudHash = hashString(cloudContent);

      if (stateEntry && stateEntry.hash === cloudHash) {
        state.files[fileName] = { ...stateEntry, version: newVersion };
        continue;
      }

      const filePath = join(folder, fileName);

      // Check if local file was also changed
      if (existsSync(filePath)) {
        const localContent = readFileSync(filePath, "utf-8");
        const localHash = hashString(localContent);
        if (localHash !== (stateEntry?.hash ?? "") && localHash !== cloudHash) {
          backupFile(folder, fileName);
          out.info(`  ⚠ ${fileName}: conflict, cloud wins, local backed up`);
        }
      }

      mkdirSync(dirname(filePath), { recursive: true });
      suppressSet.add(fileName);
      writeFileSync(filePath, cloudContent, "utf-8");
      setTimeout(() => suppressSet.delete(fileName), 2000);

      state.files[fileName] = {
        node_id: node.node_id,
        version: newVersion,
        hash: cloudHash,
      };
      saveState(folder, state);
      out.info(`  ↓ ${fileName} v${localVersion} → v${newVersion}`);
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 0)) {
      out.info(`  ✗ poll: ${e.message}`);
    }
  }
}

/**
 * Watcher: local changes → push to cloud.
 */
function startOpenClawWatcher(api, folder, state, suppressSet, out) {
  const debounceMap = new Map();
  const DEBOUNCE_MS = 500;
  const IGNORED_NAMES = new Set(["node_modules", "__pycache__", ".git", ".DS_Store", ".env", ".puppyone"]);

  const watcher = chokidar.watch(folder, {
    ignored: (filePath) => {
      const rel = relative(folder, filePath);
      if (!rel) return false;
      const parts = rel.split(/[/\\]/);
      return parts.some((p) => (p.startsWith(".") && p !== ".") || IGNORED_NAMES.has(p));
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  async function handleFileChange(absPath) {
    const ext = extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return;

    const relPath = relative(folder, absPath);

    if (suppressSet.has(relPath)) return;

    if (debounceMap.has(relPath)) clearTimeout(debounceMap.get(relPath));
    debounceMap.set(
      relPath,
      setTimeout(async () => {
        debounceMap.delete(relPath);
        await handleOpenClawPush(api, folder, absPath, relPath, ext, state, out);
      }, DEBOUNCE_MS),
    );
  }

  async function handleFileDelete(absPath) {
    const relPath = relative(folder, absPath);
    const entry = state.files[relPath];
    if (!entry) return;
    out.info(`  ✗ ${relPath}: local delete detected (node ${entry.node_id} preserved on cloud)`);
    delete state.files[relPath];
    saveState(folder, state);
  }

  watcher.on("add", handleFileChange);
  watcher.on("change", handleFileChange);
  watcher.on("unlink", handleFileDelete);

  return watcher;
}

async function handleOpenClawPush(api, folder, absPath, relPath, ext, state, out) {
  try {
    if (!existsSync(absPath)) return;

    const contentStr = readFileSync(absPath, "utf-8");
    const currentHash = hashString(contentStr);
    const stateEntry = state.files[relPath];

    // Skip if content unchanged
    if (stateEntry && stateEntry.hash === currentHash) return;

    let content;
    let nodeType = "markdown";

    if (ext === ".json") {
      try {
        content = JSON.parse(contentStr);
        nodeType = "json";
      } catch {
        content = contentStr;
      }
    } else {
      content = contentStr;
    }

    if (stateEntry?.node_id) {
      // Update existing node
      try {
        const resp = await api.post("/access/openclaw/push", {
          node_id: stateEntry.node_id,
          content,
          base_version: stateEntry.version,
          node_type: nodeType,
        });

        if (resp.ok) {
          state.files[relPath] = {
            node_id: stateEntry.node_id,
            version: resp.version ?? stateEntry.version + 1,
            hash: currentHash,
          };
          saveState(folder, state);
          out.info(`  ↑ ${relPath} → v${resp.version}`);
        }
      } catch (e) {
        if (e.status === 409) {
          // Version conflict: cloud wins
          out.info(`  ⚠ ${relPath}: version conflict, will pull cloud version on next poll`);
        } else {
          out.info(`  ✗ push ${relPath}: ${e.message}`);
        }
      }
    } else {
      // New file, create node on cloud
      try {
        const resp = await api.post("/access/openclaw/push", {
          node_id: null,
          filename: relPath,
          content,
          base_version: 0,
          node_type: nodeType,
        });

        if (resp.ok) {
          state.files[relPath] = {
            node_id: resp.node_id,
            version: resp.version ?? 1,
            hash: currentHash,
          };
          saveState(folder, state);
          out.info(`  ↑ ${relPath} → v${resp.version} (created)`);
        }
      } catch (e) {
        out.info(`  ✗ push ${relPath}: ${e.message}`);
      }
    }
  } catch (e) {
    out.info(`  ✗ push ${relPath}: ${e.message}`);
  }
}

async function pushLocalFile(api, folder, fileName, localFile, state, out) {
  const stateEntry = state.files[fileName];
  if (!stateEntry?.node_id) return;

  const contentStr = readFileSync(join(folder, fileName), "utf-8");
  const ext = extname(fileName).toLowerCase();
  let content;
  let nodeType = "markdown";

  if (ext === ".json") {
    try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
  } else {
    content = contentStr;
  }

  try {
    const resp = await api.post("/access/openclaw/push", {
      node_id: stateEntry.node_id,
      content,
      base_version: stateEntry.version,
      node_type: nodeType,
    });

    if (resp.ok) {
      state.files[fileName] = {
        node_id: stateEntry.node_id,
        version: resp.version ?? stateEntry.version + 1,
        hash: localFile.hash,
      };
      out.info(`    ↑ ${fileName} → v${resp.version}`);
    }
  } catch (e) {
    out.info(`    ✗ push ${fileName}: ${e.message}`);
  }
}

async function pushNewLocalFile(api, folder, relPath, file, state, out) {
  const contentStr = readFileSync(join(folder, relPath), "utf-8");
  const ext = extname(relPath).toLowerCase();
  let content;
  let nodeType = "markdown";

  if (ext === ".json") {
    try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
  } else {
    content = contentStr;
  }

  try {
    const resp = await api.post("/access/openclaw/push", {
      node_id: null,
      filename: relPath,
      content,
      base_version: 0,
      node_type: nodeType,
    });

    if (resp.ok) {
      state.files[relPath] = {
        node_id: resp.node_id,
        version: resp.version ?? 1,
        hash: file.hash,
      };
      out.info(`    ↑ ${relPath} → cloud (new)`);
    }
  } catch (e) {
    out.info(`    ✗ push ${relPath}: ${e.message}`);
  }
}

// ============================================================
// Sync watch mode — JWT auth, /api/v1/sync/sources/* (unchanged)
// ============================================================

async function watchSync(opts, cmd, out) {
  const config = loadConfig();
  const connections = config.connections ?? [];
  if (connections.length === 0) {
    out.error("NO_CONNECTIONS", "No connections found.", "Run `puppyone connect <folder> -p <project-id>` first.");
    return;
  }

  let api;
  try {
    api = createClient(cmd);
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("UNKNOWN", e.message);
    return;
  }

  const targets = opts.source
    ? connections.filter((c) => String(c.source_id) === String(opts.source))
    : connections;

  if (targets.length === 0) {
    out.error("SOURCE_NOT_FOUND", `No connection with source ID ${opts.source}.`);
    return;
  }

  const interval = Math.max(5, parseInt(opts.interval, 10) || 30) * 1000;
  const cleanups = [];

  const realtimeClient = await setupRealtime(api, config, out);

  for (const conn of targets) {
    if (!existsSync(conn.folder)) {
      out.info(`⚠ Folder not found: ${conn.folder}, skipping`);
      continue;
    }

    out.info(`Watching source #${conn.source_id}: ${conn.folder}`);

    out.info(`  🔄 Reconciling...`);
    const reconcileResult = await reconcile(api, conn, out);
    out.info(`  ✓ Reconciled: ${reconcileResult.pushed} pushed, ${reconcileResult.pulled} pulled, ${reconcileResult.skipped} unchanged`);

    const watcher = startSyncWatcher(api, conn, out);
    cleanups.push(watcher);

    if (realtimeClient) {
      const channel = subscribeToChanges(realtimeClient, api, conn, out);
      cleanups.push({ close: () => channel.unsubscribe() });
      out.info(`  ⚡ Realtime subscription active`);
    } else {
      out.info(`  ⏱ Falling back to polling every ${interval / 1000}s`);
      const timer = setInterval(() => pollRemote(api, conn, out), interval);
      cleanups.push({ close: () => clearInterval(timer) });
    }
  }

  if (cleanups.length === 0) {
    out.error("NO_WATCHERS", "No valid folders to watch.");
    return;
  }

  const mode = realtimeClient ? "Realtime" : `polling every ${interval / 1000}s`;
  out.info(`\nWatching for changes (server→local: ${mode}). Press Ctrl+C to stop.\n`);

  process.on("SIGINT", () => {
    out.info("\nStopping watchers...");
    for (const w of cleanups) w.close();
    if (realtimeClient) realtimeClient.removeAllChannels();
    process.exit(0);
  });

  await new Promise(() => {});
}

// ============================================================
// Sync mode helpers (unchanged)
// ============================================================

async function setupRealtime(api, config, out) {
  try {
    const cfg = await api.get("/auth/config");
    if (!cfg.supabase_url || !cfg.supabase_anon_key) return null;

    const supabase = createSupabaseClient(cfg.supabase_url, cfg.supabase_anon_key, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    const token = config.api_key;
    if (token) {
      await supabase.auth.setSession({
        access_token: token,
        refresh_token: config.refresh_token || "",
      });
    }

    return supabase;
  } catch (e) {
    out.info(`  ⚠ Realtime setup failed (${e.message}), will use polling`);
    return null;
  }
}

function subscribeToChanges(supabase, api, conn, out) {
  let pulling = false;

  async function triggerPull() {
    if (pulling) return;
    pulling = true;
    try {
      await pullSyncFiles(api, conn, out);
    } finally {
      pulling = false;
    }
  }

  const channel = supabase
    .channel(`sync-${conn.source_id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "content_nodes",
        filter: `sync_source_id=eq.${conn.source_id}`,
      },
      async (payload) => {
        const row = payload.new;
        const version = row.current_version ?? 0;
        const lastSync = row.last_sync_version ?? 0;
        if (version <= lastSync) return;
        await triggerPull();
      },
    );

  if (conn.target_folder_id) {
    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "content_nodes",
        filter: `parent_id=eq.${conn.target_folder_id}`,
      },
      async () => {
        await triggerPull();
      },
    );
  }

  channel.subscribe();
  return channel;
}

async function pullSyncFiles(api, conn, out) {
  try {
    const resp = await api.get(`/sync/sources/${conn.source_id}/pull-files`);
    const files = resp.files ?? [];
    if (files.length === 0) return;

    const ackItems = [];

    for (const file of files) {
      const localPath = join(conn.folder, file.external_resource_id);
      try {
        mkdirSync(dirname(localPath), { recursive: true });

        let contentStr;
        if (file.node_type === "json" && file.content_json != null) {
          contentStr = JSON.stringify(file.content_json, null, 2);
        } else {
          contentStr = file.content_md ?? "";
        }

        writeFileSync(localPath, contentStr, "utf-8");
        const hash = createHash("sha256").update(contentStr, "utf-8").digest("hex");

        ackItems.push({
          node_id: file.node_id,
          version: file.current_version,
          remote_hash: hash,
        });

        out.info(`  ↓ pulled: ${file.external_resource_id} v${file.current_version}`);
      } catch (e) {
        out.info(`  ✗ pull ${file.external_resource_id}: ${e.message}`);
      }
    }

    if (ackItems.length > 0) {
      await api.post(`/sync/sources/${conn.source_id}/ack-pull`, { items: ackItems });
    }
  } catch (e) {
    out.info(`  ✗ realtime pull: ${e.message}`);
  }
}

async function reconcile(api, conn, out) {
  const result = { pushed: 0, pulled: 0, skipped: 0, errors: 0 };

  const localFiles = scanSyncFolder(conn.folder);
  for (const file of localFiles) {
    try {
      const contentBytes = readFileSync(file.absPath);
      const hash = createHash("sha256").update(contentBytes).digest("hex");
      const contentStr = contentBytes.toString("utf-8");

      let contentJson = null;
      let contentMd = null;
      if (file.ext === ".json") {
        try { contentJson = JSON.parse(contentStr); } catch { contentMd = contentStr; }
      } else {
        contentMd = contentStr;
      }

      const resp = await api.post(`/sync/sources/${conn.source_id}/push-file`, {
        external_resource_id: file.relPath,
        content_json: contentJson,
        content_md: contentMd,
        content_hash: hash,
      });

      if (resp.action === "skipped") {
        result.skipped++;
      } else {
        out.info(`    ↑ ${resp.action}: ${file.relPath}`);
        result.pushed++;
      }
    } catch (e) {
      out.info(`    ✗ push ${file.relPath}: ${e.message}`);
      result.errors++;
    }
  }

  try {
    const resp = await api.get(`/sync/sources/${conn.source_id}/pull-files`);
    const files = resp.files ?? [];
    const ackItems = [];

    for (const file of files) {
      const localPath = join(conn.folder, file.external_resource_id);
      try {
        mkdirSync(dirname(localPath), { recursive: true });
        let contentStr;
        if (file.node_type === "json" && file.content_json != null) {
          contentStr = JSON.stringify(file.content_json, null, 2);
        } else {
          contentStr = file.content_md ?? "";
        }
        writeFileSync(localPath, contentStr, "utf-8");
        const hash = createHash("sha256").update(contentStr, "utf-8").digest("hex");
        ackItems.push({ node_id: file.node_id, version: file.current_version, remote_hash: hash });
        out.info(`    ↓ pulled: ${file.external_resource_id}`);
        result.pulled++;
      } catch (e) {
        out.info(`    ✗ pull ${file.external_resource_id}: ${e.message}`);
        result.errors++;
      }
    }

    if (ackItems.length > 0) {
      await api.post(`/sync/sources/${conn.source_id}/ack-pull`, { items: ackItems });
    }
  } catch (e) {
    out.info(`    ✗ pull phase: ${e.message}`);
    result.errors++;
  }

  return result;
}

function scanSyncFolder(folderPath) {
  const files = [];
  const IGNORED = new Set([".git", ".DS_Store", "node_modules", "__pycache__", ".env", ".puppyone"]);

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith(".") || IGNORED.has(entry)) continue;
      const abs = join(dir, entry);
      let stat;
      try { stat = statSync(abs); } catch { continue; }
      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          files.push({ absPath: abs, relPath: relative(folderPath, abs), ext });
        }
      }
    }
  }

  walk(folderPath);
  return files;
}

function startSyncWatcher(api, conn, out) {
  const debounceMap = new Map();
  const DEBOUNCE_MS = 500;
  const IGNORED_NAMES = new Set(["node_modules", "__pycache__", ".git", ".DS_Store", ".env", ".puppyone"]);

  const watcher = chokidar.watch(conn.folder, {
    ignored: (filePath) => {
      const rel = relative(conn.folder, filePath);
      if (!rel) return false;
      const parts = rel.split(/[/\\]/);
      return parts.some((p) => (p.startsWith(".") && p !== ".") || IGNORED_NAMES.has(p));
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  async function handleFileChange(absPath) {
    const ext = extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) return;

    const relPath = relative(conn.folder, absPath);

    if (debounceMap.has(relPath)) clearTimeout(debounceMap.get(relPath));
    debounceMap.set(
      relPath,
      setTimeout(async () => {
        debounceMap.delete(relPath);
        await pushSyncFile(api, conn, absPath, relPath, ext, out);
      }, DEBOUNCE_MS),
    );
  }

  watcher.on("add", handleFileChange);
  watcher.on("change", handleFileChange);

  return watcher;
}

async function pushSyncFile(api, conn, absPath, relPath, ext, out) {
  try {
    if (!existsSync(absPath)) return;

    const contentBytes = readFileSync(absPath);
    const hash = createHash("sha256").update(contentBytes).digest("hex");
    const contentStr = contentBytes.toString("utf-8");

    let contentJson = null;
    let contentMd = null;
    if (ext === ".json") {
      try { contentJson = JSON.parse(contentStr); } catch { contentMd = contentStr; }
    } else {
      contentMd = contentStr;
    }

    const resp = await api.post(`/sync/sources/${conn.source_id}/push-file`, {
      external_resource_id: relPath,
      content_json: contentJson,
      content_md: contentMd,
      content_hash: hash,
    });

    if (resp.action !== "skipped") {
      out.info(`  ↑ ${resp.action}: ${relPath} → v${resp.version}`);
    }
  } catch (e) {
    out.info(`  ✗ push ${relPath}: ${e.message}`);
  }
}

async function pollRemote(api, conn, out) {
  try {
    const resp = await api.get(`/sync/sources/${conn.source_id}/pull-files`);
    const files = resp.files ?? [];
    if (files.length === 0) return;

    const ackItems = [];

    for (const file of files) {
      const localPath = join(conn.folder, file.external_resource_id);
      try {
        mkdirSync(dirname(localPath), { recursive: true });

        let contentStr;
        if (file.node_type === "json" && file.content_json != null) {
          contentStr = JSON.stringify(file.content_json, null, 2);
        } else {
          contentStr = file.content_md ?? "";
        }

        writeFileSync(localPath, contentStr, "utf-8");
        const hash = createHash("sha256").update(contentStr, "utf-8").digest("hex");

        ackItems.push({
          node_id: file.node_id,
          version: file.current_version,
          remote_hash: hash,
        });

        out.info(`  ↓ pulled: ${file.external_resource_id} v${file.current_version}`);
      } catch (e) {
        out.info(`  ✗ pull ${file.external_resource_id}: ${e.message}`);
      }
    }

    if (ackItems.length > 0) {
      await api.post(`/sync/sources/${conn.source_id}/ack-pull`, { items: ackItems });
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 0)) {
      out.info(`  ✗ remote poll: ${e.message}`);
    }
  }
}

// ============================================================
// Shared helpers
// ============================================================

function findOpenClawConnection(config, accessKey) {
  const conns = config.openclaw_connections ?? [];
  return conns.find((c) => c.access_key === accessKey) ?? null;
}
