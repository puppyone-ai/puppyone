import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, extname, basename } from "node:path";
import { createClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig } from "../config.js";

export function registerSync(program) {
  program
    .command("sync")
    .description("One-time sync between local folder and PuppyOne")
    .option("-s, --source <id>", "source ID (omit to sync all connections)")
    .option("-d, --direction <dir>", "push | pull | both", "both")
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
        out.error("SOURCE_NOT_FOUND", `No connection with source ID ${opts.source}.`, "Run `puppyone status` to see connections.");
        return;
      }

      const direction = opts.direction;
      const summary = { pushed: 0, pulled: 0, skipped: 0, errors: 0 };

      for (const conn of targets) {
        out.info(`\nSyncing source #${conn.source_id}: ${conn.folder}`);

        if (!existsSync(conn.folder)) {
          out.info(`  ⚠ Folder not found: ${conn.folder}, skipping push`);
          if (direction === "push") continue;
        }

        try {
          if (direction === "push" || direction === "both") {
            const pushResult = await doPush(api, conn, out);
            summary.pushed += pushResult.pushed;
            summary.skipped += pushResult.skipped;
            summary.errors += pushResult.errors;
          }

          if (direction === "pull" || direction === "both") {
            const pullResult = await doPull(api, conn, out);
            summary.pulled += pullResult.pulled;
            summary.skipped += pullResult.skipped;
            summary.errors += pullResult.errors;
          }
        } catch (e) {
          if (e instanceof ApiError) {
            out.info(`  ✗ API error: ${e.message}`);
          } else {
            out.info(`  ✗ Error: ${e.message}`);
          }
          summary.errors++;
        }
      }

      out.info("");
      out.info(`Done: ${summary.pushed} pushed, ${summary.pulled} pulled, ${summary.skipped} skipped, ${summary.errors} errors`);

      out.success({
        pushed: summary.pushed,
        pulled: summary.pulled,
        skipped: summary.skipped,
        errors: summary.errors,
      });
    });
}

async function doPush(api, conn, out) {
  const result = { pushed: 0, skipped: 0, errors: 0 };
  const localFiles = scanFolder(conn.folder);

  out.info(`  PUSH: ${localFiles.length} local files found`);

  for (const file of localFiles) {
    const relPath = file.relPath;
    try {
      const contentBytes = readFileSync(file.absPath);
      const hash = createHash("sha256").update(contentBytes).digest("hex");
      const contentStr = contentBytes.toString("utf-8");

      let contentJson = null;
      let contentMd = null;
      if (file.ext === ".json") {
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

      if (resp.action === "skipped") {
        result.skipped++;
      } else {
        out.info(`    ${resp.action}: ${relPath} → node ${resp.node_id} v${resp.version}`);
        result.pushed++;
      }
    } catch (e) {
      out.info(`    ✗ ${relPath}: ${e.message}`);
      result.errors++;
    }
  }

  return result;
}

async function doPull(api, conn, out) {
  const result = { pulled: 0, skipped: 0, errors: 0 };

  const resp = await api.get(`/sync/sources/${conn.source_id}/pull-files`);
  const files = resp.files ?? [];

  out.info(`  PULL: ${files.length} files to download`);

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

      out.info(`    pulled: ${file.external_resource_id} v${file.current_version}`);
      result.pulled++;
    } catch (e) {
      out.info(`    ✗ ${file.external_resource_id}: ${e.message}`);
      result.errors++;
    }
  }

  if (ackItems.length > 0) {
    await api.post(`/sync/sources/${conn.source_id}/ack-pull`, { items: ackItems });
  }

  return result;
}

function scanFolder(folderPath) {
  const files = [];
  const IGNORED = new Set([".git", ".DS_Store", "node_modules", "__pycache__", ".env"]);

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || IGNORED.has(entry)) continue;
      const abs = join(dir, entry);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if ([".json", ".md", ".markdown", ".txt", ".yaml", ".yml"].includes(ext)) {
          files.push({
            absPath: abs,
            relPath: relative(folderPath, abs),
            ext,
          });
        }
      }
    }
  }

  walk(folderPath);
  return files;
}
