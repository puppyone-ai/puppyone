import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createOpenClawClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { loadConfig } from "../config.js";
import { loadState, saveState } from "../state.js";
import { nodeToFilename, serializeNodeContent, hashString } from "./connect.js";

export function registerPull(program) {
  program
    .command("pull")
    .description("Pull latest data from PuppyOne (OpenClaw mode)")
    .requiredOption("--key <access-key>", "OpenClaw access key")
    .action(async (opts, cmd) => {
      const out = createOutput(cmd);

      const config = loadConfig();
      const conn = findConnection(config, opts.key);
      if (!conn) {
        out.error(
          "NOT_CONNECTED",
          "No OpenClaw connection found for this key.",
          `Run \`puppyone connect --key ${opts.key} <workspace-folder>\` first.`,
        );
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

      try {
        const state = loadState(conn.folder);
        const folderId = conn.folder_id || state.connection?.folder_id;
        if (!folderId) {
          out.error("NO_FOLDER_ID", "No folder_id found. Re-run `puppyone connect` to update your connection.");
          return;
        }

        out.info(`\nPulling data to ${conn.folder}...\n`);

        const cursor = state.cursor ?? 0;
        const data = await api.get(`/filesystem/${folderId}/pull?cursor=${cursor}`);
        const files = data.files ?? [];

        if (files.length === 0) {
          out.info("  No files available. Check agent resource bindings.");
          out.success({ pulled: 0 });
          return;
        }

        let pulled = 0;
        let skippedCount = 0;

        for (const node of files) {
          try {
            if (node.type === "folder") { skippedCount++; continue; }
            const fileName = nodeToFilename(node);
            const newVersion = node.version ?? 0;
            const localEntry = state.files[fileName];
            const localVersion = localEntry?.version ?? -1;

            if (newVersion <= localVersion) {
              skippedCount++;
              continue;
            }

            const filePath = join(conn.folder, fileName);
            mkdirSync(dirname(filePath), { recursive: true });

            const content = serializeNodeContent(node);
            writeFileSync(filePath, content, "utf-8");
            const hash = hashString(content);

            state.files[fileName] = {
              version: newVersion,
              hash,
            };
            pulled++;
            out.info(`  ↓ ${fileName} (v${newVersion})`);
          } catch (e) {
            out.info(`  ✗ ${node.name}: ${e.message}`);
          }
        }

        if (data.cursor != null) {
          state.cursor = data.cursor;
        }
        saveState(conn.folder, state);

        out.info(`\n✅ Pulled ${pulled} updated, ${skippedCount} unchanged\n`);
        out.success({ pulled, skipped: skippedCount, total: files.length });
      } catch (e) {
        if (e instanceof ApiError) out.error(e.code, e.message, e.hint);
        else out.error("PULL_FAILED", e.message);
      }
    });
}

function findConnection(config, accessKey) {
  const conns = config.openclaw_connections ?? [];
  return conns.find((c) => c.access_key === accessKey) ?? null;
}
