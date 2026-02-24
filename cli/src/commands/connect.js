import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { createClient, createOpenClawClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { saveConfig, loadConfig, resolveAuth } from "../config.js";
import { loadState, saveState, backupFile, ensurePuppyOneDir } from "../state.js";

const INLINE_EXTS = new Set([".json", ".md", ".markdown"]);
const IGNORED_DIRS = new Set([".puppyone", ".git", "node_modules", "__pycache__"]);
const IGNORED_FILES = new Set([".DS_Store", ".env"]);

function isInlineExt(ext) { return INLINE_EXTS.has(ext); }
function isFileNode(node) { return node.type !== "json" && node.type !== "markdown" && node.type !== "folder"; }
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

export function registerConnect(program) {
  program
    .command("connect")
    .description("Link a local folder to a PuppyOne project")
    .argument("<folder>", "absolute or relative path to the local folder")
    .option("--key <access-key>", "OpenClaw access key")
    .option("-p, --project <id>", "PuppyOne project ID (sync mode only)")
    .option("-f, --folder-id <id>", "target folder node ID inside the project (omit for project root)")
    .option("-m, --mode <mode>", "sync mode: bidirectional | pull | push", "bidirectional")
    .option("-c, --conflict <strategy>", "conflict strategy: merge | external | puppyone | manual", "merge")
    .option("-n, --name <name>", "connection name")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);

      const absPath = resolve(folder);

      if (opts.key) {
        if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
          out.error(
            "FOLDER_NOT_FOUND",
            `Not a directory: ${absPath}`,
            "Provide a valid folder path: puppyone connect <folder> --key <key>",
          );
          return;
        }
        await connectOpenClaw(absPath, folder, opts, cmd, out);
      } else {
        if (!folder) {
          out.error("MISSING_FOLDER", "Folder path is required for sync mode.", "Usage: puppyone connect <folder> -p <project-id>");
          return;
        }
        if (!existsSync(absPath)) {
          mkdirSync(absPath, { recursive: true });
          out.info(`Created folder: ${absPath}`);
        } else if (!statSync(absPath).isDirectory()) {
          out.error("FOLDER_NOT_FOUND", `Not a directory: ${absPath}`, "Provide a folder path, not a file.");
          return;
        }
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

    const data = await api.post("/sync/openclaw/connect", {
      workspace_path: absPath,
    });

    out.done("✓");
    out.info(`  Agent:   ${data.agent_id}`);
    out.info(`  Project: ${data.project_id}`);
    out.info(`  Folder:  ${data.folder_id}`);
    out.info(`  Source:  ${data.source_id}`);

    ensurePuppyOneDir(absPath);

    // Merge: cloud files vs local files
    const folderId = data.folder_id;
    const cloudFiles = data.files ?? data.nodes ?? [];
    const localFiles = scanLocalFiles(absPath);
    const mergeResult = await executeMerge(api, absPath, cloudFiles, localFiles, out, folderId);

    // Build state from merge result
    const state = {
      files: mergeResult.fileMap,
      cursor: data.cursor ?? 0,
      connection: {
        access_key: opts.key,
        api_url: effectiveApiUrl,
        source_id: data.source_id,
        agent_id: data.agent_id,
        project_id: data.project_id,
        folder_id: folderId,
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
      folder_id: folderId,
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
async function executeMerge(api, folder, cloudNodes, localFiles, out, folderId) {
  const fileMap = {};
  let pulled = 0, pushed = 0, skipped = 0, conflicts = 0;
  const syncBase = folderId ? `/sync/${folderId}` : null;

  out.info("\nMerging...\n");

  const cloudByName = new Map();
  for (const node of cloudNodes) {
    if (node.type === "folder") continue;
    const fileName = nodeToFilename(node);
    cloudByName.set(fileName, node);
  }

  const localByName = new Map();
  for (const file of localFiles) {
    localByName.set(file.relPath, file);
  }

  for (const [fileName, node] of cloudByName) {
    const localFile = localByName.get(fileName);

    if (!localFile) {
      const filePath = join(folder, fileName);
      mkdirSync(dirname(filePath), { recursive: true });

      if (isFileNode(node)) {
        if (node.download_url) {
          try {
            const res = await fetch(node.download_url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              writeFileSync(filePath, buf);
              fileMap[fileName] = { version: node.version ?? 0, hash: hashBuffer(buf), s3: true };
              pulled++;
              out.info(`  ↓ ${fileName}  cloud → local (file via S3)`);
            }
          } catch { /* skip */ }
        }
      } else {
        const content = serializeNodeContent(node);
        writeFileSync(filePath, content, "utf-8");
        fileMap[fileName] = { version: node.version ?? 0, hash: hashString(content) };
        pulled++;
        out.info(`  ↓ ${fileName}  cloud → local (new)`);
      }
    } else {
      if (isFileNode(node)) {
        fileMap[fileName] = { version: node.version ?? 0, hash: localFile.hash, s3: true };
        skipped++;
        out.info(`  = ${fileName}  file node, keep local`);
      } else {
        const cloudContent = serializeNodeContent(node);
        const cloudHash = hashString(cloudContent);
        const localHash = localFile.hash;

        if (cloudHash === localHash) {
          fileMap[fileName] = { version: node.version ?? 0, hash: localHash };
          skipped++;
          out.info(`  = ${fileName}  identical, skip`);
        } else {
          backupFile(folder, fileName);
          writeFileSync(join(folder, fileName), cloudContent, "utf-8");
          fileMap[fileName] = { version: node.version ?? 0, hash: cloudHash };
          conflicts++;
          out.info(`  ↓ ${fileName}  conflict → cloud wins, local backed up`);
        }
      }
      localByName.delete(fileName);
    }
  }

  for (const [relPath, file] of localByName) {
    try {
      if (file.inline) {
        const contentStr = readFileSync(join(folder, relPath), "utf-8");
        const ext = extname(relPath).toLowerCase();
        let content, nodeType = "markdown";
        if (ext === ".json") {
          try { content = JSON.parse(contentStr); nodeType = "json"; } catch { content = contentStr; }
        } else { content = contentStr; }

        const resp = await api.post(`${syncBase}/push`, {
          filename: relPath, content, base_version: 0, node_type: nodeType,
        });
        if (resp.ok) {
          fileMap[relPath] = { version: resp.version ?? 1, hash: file.hash };
          pushed++;
          out.info(`  ↑ ${relPath}  local → cloud (new)`);
        }
      } else {
        const fileBuf = readFileSync(join(folder, relPath));
        const mimeType = guessMimeType(relPath);
        const urlResp = await api.post(`${syncBase}/upload-url`, {
          filename: relPath, content_type: mimeType, size_bytes: fileBuf.length,
        });
        if (!urlResp.ok) continue;
        const putRes = await fetch(urlResp.upload_url, {
          method: "PUT", headers: { "Content-Type": mimeType }, body: fileBuf,
        });
        if (!putRes.ok) continue;
        const confirmResp = await api.post(`${syncBase}/confirm-upload`, {
          filename: relPath, size_bytes: fileBuf.length, content_hash: hashBuffer(fileBuf),
        });
        if (confirmResp.ok) {
          fileMap[relPath] = { version: confirmResp.version ?? 1, hash: file.hash, s3: true };
          pushed++;
          out.info(`  ↑ ${relPath}  local → cloud (file via S3)`);
        }
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
        if (!ext) continue;
        const relPath = relative(folder, abs);
        if (isInlineExt(ext)) {
          const content = readFileSync(abs, "utf-8");
          files.push({ relPath, absPath: abs, ext, hash: hashString(content), inline: true });
        } else {
          const buf = readFileSync(abs);
          files.push({ relPath, absPath: abs, ext, hash: hashBuffer(buf), inline: false, size: buf.length });
        }
      }
    }
  }

  walk(folder);
  return files;
}
