import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { createClient, createOpenClawClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { saveConfig, loadConfig, resolveAuth } from "../config.js";
import { loadState, saveState, backupFile, ensurePuppyOneDir } from "../state.js";

const SUPPORTED_EXTS = new Set([".json", ".md", ".markdown", ".txt", ".yaml", ".yml"]);
const IGNORED_DIRS = new Set([".puppyone", ".git", "node_modules", "__pycache__"]);
const IGNORED_FILES = new Set([".DS_Store", ".env"]);

export function registerConnect(program) {
  program
    .command("connect")
    .description("Link a local folder to a PuppyOne project")
    .argument("<folder>", "local folder path")
    .option("--key <access-key>", "OpenClaw access key (uses /access/openclaw endpoints)")
    .option("-p, --project <id>", "PuppyOne project ID (sync mode only)")
    .option("-f, --folder-id <id>", "target folder node ID inside the project (omit for project root)")
    .option("-m, --mode <mode>", "sync mode: bidirectional | pull | push", "bidirectional")
    .option("-c, --conflict <strategy>", "conflict strategy: merge | external | puppyone | manual", "merge")
    .option("-n, --name <name>", "connection name")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);

      const absPath = resolve(folder);
      if (!existsSync(absPath)) {
        mkdirSync(absPath, { recursive: true });
        out.info(`Created workspace folder: ${absPath}`);
      } else if (!statSync(absPath).isDirectory()) {
        out.error("FOLDER_NOT_FOUND", `Not a directory: ${absPath}`, "Provide a folder path, not a file.");
        return;
      }

      if (opts.key) {
        await connectOpenClaw(absPath, folder, opts, cmd, out);
      } else {
        await connectSync(absPath, folder, opts, cmd, out);
      }
    });
}

// ============================================================
// OpenClaw mode: connect + merge
// ============================================================

async function connectOpenClaw(absPath, folder, opts, cmd, out) {
  let api;
  try {
    const { apiUrl: resolvedUrl } = resolveAuth(cmd);
    const effectiveApiUrl = resolvedUrl ?? "http://localhost:9090";
    api = createOpenClawClient(opts.key, cmd);

    out.info(`\nConnecting ${absPath} to PuppyOne via OpenClaw...`);
    out.step("Registering connection...");

    const data = await api.post("/access/openclaw/connect", {
      workspace_path: absPath,
    });

    out.done("✓");
    out.info(`  Agent:   ${data.agent_id}`);
    out.info(`  Project: ${data.project_id}`);
    out.info(`  Source:  ${data.source_id}`);

    ensurePuppyOneDir(absPath);

    // Merge: cloud nodes vs local files
    const cloudNodes = data.nodes ?? [];
    const localFiles = scanLocalFiles(absPath);
    const mergeResult = await executeMerge(api, absPath, cloudNodes, localFiles, out);

    // Build state from merge result
    const state = {
      files: mergeResult.fileMap,
      connection: {
        access_key: opts.key,
        api_url: effectiveApiUrl,
        source_id: data.source_id,
        agent_id: data.agent_id,
        project_id: data.project_id,
      },
    };
    saveState(absPath, state);

    // Also save connection to global config
    const config = loadConfig();
    const ocConnections = config.openclaw_connections ?? [];
    const existing = ocConnections.findIndex((c) => c.access_key === opts.key);
    const conn = {
      access_key: opts.key,
      api_url: effectiveApiUrl,
      folder: absPath,
    };
    if (existing >= 0) {
      ocConnections[existing] = conn;
    } else {
      ocConnections.push(conn);
    }
    saveConfig({ openclaw_connections: ocConnections });

    out.info("");
    out.info(`✅ Synced. ${mergeResult.pulled} pulled, ${mergeResult.pushed} pushed, ${mergeResult.conflicts} conflicts, ${mergeResult.skipped} skipped.`);
    out.info("");
    out.info("Next steps:");
    out.info(`  puppyone watch --key ${opts.key}`);
    out.info("");

    out.success({
      source_id: data.source_id,
      agent_id: data.agent_id,
      project_id: data.project_id,
      ...mergeResult,
    });
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("CONNECT_FAILED", e.message, "Check the access key is valid.");
  }
}

/**
 * Execute merge: make cloud and local identical.
 *
 * | Cloud    | Local    | Action                                  |
 * |----------|----------|-----------------------------------------|
 * | Has file | Missing  | Cloud → write to local                  |
 * | Missing  | Has file | Local → push to cloud (create new node) |
 * | Has file | Has file, same    | Skip                           |
 * | Has file | Has file, differ  | Cloud wins, backup local       |
 */
async function executeMerge(api, folder, cloudNodes, localFiles, out) {
  const fileMap = {};
  let pulled = 0, pushed = 0, skipped = 0, conflicts = 0;

  out.info("\nMerging...\n");

  const cloudByName = new Map();
  for (const node of cloudNodes) {
    const fileName = nodeToFilename(node);
    cloudByName.set(fileName, node);
  }

  const localByName = new Map();
  for (const file of localFiles) {
    localByName.set(file.relPath, file);
  }

  // 1) Process cloud nodes
  for (const [fileName, node] of cloudByName) {
    const localFile = localByName.get(fileName);

    if (!localFile) {
      // Cloud only → write to local
      const filePath = join(folder, fileName);
      mkdirSync(dirname(filePath), { recursive: true });
      const content = serializeNodeContent(node);
      writeFileSync(filePath, content, "utf-8");
      const hash = hashString(content);

      fileMap[fileName] = {
        node_id: node.node_id,
        version: node.version ?? 0,
        hash,
      };
      pulled++;
      out.info(`  ↓ ${fileName}  cloud → local (new)`);
    } else {
      // Both exist → compare
      const cloudContent = serializeNodeContent(node);
      const cloudHash = hashString(cloudContent);
      const localHash = localFile.hash;

      if (cloudHash === localHash) {
        fileMap[fileName] = {
          node_id: node.node_id,
          version: node.version ?? 0,
          hash: localHash,
        };
        skipped++;
        out.info(`  = ${fileName}  identical, skip`);
      } else {
        // Conflict → cloud wins, backup local
        backupFile(folder, fileName);
        const filePath = join(folder, fileName);
        writeFileSync(filePath, cloudContent, "utf-8");

        fileMap[fileName] = {
          node_id: node.node_id,
          version: node.version ?? 0,
          hash: cloudHash,
        };
        conflicts++;
        out.info(`  ↓ ${fileName}  conflict → cloud wins, local backed up`);
      }
      localByName.delete(fileName);
    }
  }

  // 2) Local-only files → push to cloud (create new node)
  for (const [relPath, file] of localByName) {
    try {
      const contentStr = readFileSync(join(folder, relPath), "utf-8");
      const ext = extname(relPath).toLowerCase();
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

      const resp = await api.post("/access/openclaw/push", {
        node_id: null,
        filename: relPath,
        content,
        base_version: 0,
        node_type: nodeType,
      });

      if (resp.ok) {
        fileMap[relPath] = {
          node_id: resp.node_id,
          version: resp.version ?? 1,
          hash: file.hash,
        };
        pushed++;
        out.info(`  ↑ ${relPath}  local → cloud (new node created)`);
      } else {
        out.info(`  ✗ ${relPath}  push failed: ${resp.message ?? "unknown"}`);
      }
    } catch (e) {
      out.info(`  ✗ ${relPath}  push failed: ${e.message}`);
    }
  }

  return { fileMap, pulled, pushed, skipped, conflicts };
}

// ============================================================
// Sync mode: connect using JWT (unchanged)
// ============================================================

async function connectSync(absPath, folder, opts, cmd, out) {
  const projectId = opts.project;
  if (!projectId) {
    out.error("MISSING_PROJECT", "Project ID is required.", "Use: puppyone connect ./folder -p <project-id>");
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

  const conflictMap = {
    merge: "three_way_merge",
    external: "external_wins",
    puppyone: "puppyone_wins",
    manual: "manual",
  };
  const conflictStrategy = conflictMap[opts.conflict] ?? opts.conflict;

  const modeMap = {
    bidirectional: "bidirectional",
    pull: "pull_only",
    push: "push_only",
  };
  const syncMode = modeMap[opts.mode] ?? opts.mode;

  try {
    out.info(`\nLinking ${absPath} → project ${projectId}...\n`);
    out.step("Registering connection...");

    const sourceConfig = { path: absPath };
    if (opts.folderId) sourceConfig.target_folder_id = opts.folderId;

    const source = await api.post("/sync/sources", {
      project_id: projectId,
      adapter_type: "filesystem",
      config: sourceConfig,
      trigger_config: { type: "cli" },
      sync_mode: syncMode,
      conflict_strategy: conflictStrategy,
    });

    out.done("✓");

    const config = loadConfig();
    const connections = config.connections ?? [];
    connections.push({
      source_id: source.id,
      folder: absPath,
      project_id: projectId,
      target_folder_id: opts.folderId || null,
      sync_mode: syncMode,
    });
    saveConfig({ connections });

    out.info("");
    out.info(`✅ Linked: ${folder} → project ${projectId}${opts.folderId ? ` (folder ${opts.folderId})` : ""}`);
    out.info(`   Source ID: ${source.id}`);
    out.info(`   Mode:      ${source.sync_mode}`);
    out.info(`   Conflict:  ${source.conflict_strategy}`);
    out.info("");
    out.info("Next steps:");
    out.info("  puppyone sync              # one-time sync");
    out.info("  puppyone watch             # watch for changes");
    out.info("");

    out.success({
      source: {
        id: source.id,
        adapter_type: source.adapter_type,
        sync_mode: source.sync_mode,
        conflict_strategy: source.conflict_strategy,
        status: source.status,
        config: source.config,
      },
    });
  } catch (e) {
    if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
    else out.error("CONNECT_FAILED", e.message, "Check the API server is running and the project ID is correct.");
  }
}

// ============================================================
// Helpers
// ============================================================

export function nodeToFilename(node) {
  const name = node.name || node.node_id;
  if (node.type === "json") return name.endsWith(".json") ? name : `${name}.json`;
  if (node.type === "markdown") return name.endsWith(".md") ? name : `${name}.md`;
  return name;
}

export function serializeNodeContent(node) {
  if (node.type === "json") {
    return JSON.stringify(node.content, null, 2);
  }
  return String(node.content ?? "");
}

export function hashString(str) {
  return createHash("sha256").update(str, "utf-8").digest("hex");
}

export function scanLocalFiles(folder) {
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
        if (SUPPORTED_EXTS.has(ext)) {
          const relPath = relative(folder, abs);
          const content = readFileSync(abs, "utf-8");
          const hash = hashString(content);
          files.push({ relPath, absPath: abs, ext, hash });
        }
      }
    }
  }

  walk(folder);
  return files;
}
