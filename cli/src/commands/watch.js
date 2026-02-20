import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, extname, basename } from "node:path";
import chokidar from "chokidar";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig } from "../config.js";

const SUPPORTED_EXTS = new Set([".json", ".md", ".markdown", ".txt", ".yaml", ".yml"]);

export function registerWatch(program) {
  program
    .command("watch")
    .description("Watch local folder for changes and sync continuously")
    .option("-s, --source <id>", "source ID (omit to watch all connections)")
    .option("-i, --interval <seconds>", "fallback poll interval if Realtime unavailable", "30")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);

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

      // Try to set up Supabase Realtime for server→local push
      const realtimeClient = await setupRealtime(api, config, out);

      for (const conn of targets) {
        if (!existsSync(conn.folder)) {
          out.info(`⚠ Folder not found: ${conn.folder}, skipping`);
          continue;
        }

        out.info(`Watching source #${conn.source_id}: ${conn.folder}`);

        // STEP 1: Full reconciliation on startup — never miss a file
        out.info(`  🔄 Reconciling...`);
        const reconcileResult = await reconcile(api, conn, out);
        out.info(`  ✓ Reconciled: ${reconcileResult.pushed} pushed, ${reconcileResult.pulled} pulled, ${reconcileResult.skipped} unchanged`);

        // STEP 2: Start real-time watchers
        const watcher = startWatcher(api, conn, out);
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
    });
}

/**
 * Fetch Supabase public config from backend and create a Realtime-capable client.
 * Returns null if config endpoint is unavailable (graceful fallback to polling).
 */
async function setupRealtime(api, config, out) {
  try {
    const cfg = await api.get("/auth/config");
    if (!cfg.supabase_url || !cfg.supabase_anon_key) return null;

    const supabase = createSupabaseClient(cfg.supabase_url, cfg.supabase_anon_key, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    // Authenticate with the user's existing JWT so RLS policies apply
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

/**
 * Subscribe to content_nodes changes via Supabase Realtime.
 * Listens for:
 *   - UPDATE on bound nodes (sync_source_id matches)
 *   - INSERT on target folder (new nodes created via web UI)
 */
function subscribeToChanges(supabase, api, conn, out) {
  let pulling = false;

  async function triggerPull() {
    if (pulling) return;
    pulling = true;
    try {
      await pullSingleNode(api, conn, null, out);
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

  // Also listen for new nodes created in the target folder via web UI
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

/**
 * Pull a single changed node from the server and write to local filesystem.
 */
async function pullSingleNode(api, conn, row, out) {
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

// ============================================================
// Startup reconciliation — full bidirectional sync
// ============================================================

async function reconcile(api, conn, out) {
  const result = { pushed: 0, pulled: 0, skipped: 0, errors: 0 };

  // 1) Push all local files (server skips unchanged via hash check)
  const localFiles = scanFolder(conn.folder);
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

  // 2) Pull any server-side changes not yet on local
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

function scanFolder(folderPath) {
  const files = [];
  const IGNORED = new Set([".git", ".DS_Store", "node_modules", "__pycache__", ".env"]);

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

// ============================================================
// Local → Server: chokidar file watcher
// ============================================================

function startWatcher(api, conn, out) {
  const debounceMap = new Map();
  const DEBOUNCE_MS = 500;
  const IGNORED_NAMES = new Set(["node_modules", "__pycache__", ".git", ".DS_Store", ".env"]);

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
        await pushFile(api, conn, absPath, relPath, ext, out);
      }, DEBOUNCE_MS),
    );
  }

  watcher.on("add", handleFileChange);
  watcher.on("change", handleFileChange);

  return watcher;
}

async function pushFile(api, conn, absPath, relPath, ext, out) {
  try {
    if (!existsSync(absPath)) return;

    const contentBytes = readFileSync(absPath);
    const hash = createHash("sha256").update(contentBytes).digest("hex");
    const contentStr = contentBytes.toString("utf-8");

    let contentJson = null;
    let contentMd = null;
    if (ext === ".json") {
      try {
        contentJson = JSON.parse(contentStr);
      } catch {
        contentMd = contentStr;
      }
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

// Fallback polling (used when Realtime is unavailable)
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
