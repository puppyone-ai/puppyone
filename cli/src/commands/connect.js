import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { createClient, ApiError } from "../api.js";
import { createOutput } from "../output.js";
import { saveConfig, loadConfig } from "../config.js";

export function registerConnect(program) {
  program
    .command("connect")
    .description("Link a local folder to a PuppyOne project")
    .argument("<folder>", "local folder path")
    .option("-p, --project <id>", "PuppyOne project ID")
    .option("-f, --folder-id <id>", "target folder node ID inside the project (omit for project root)")
    .option("-m, --mode <mode>", "sync mode: bidirectional | pull | push", "bidirectional")
    .option("-c, --conflict <strategy>", "conflict strategy: merge | external | puppyone | manual", "merge")
    .option("-n, --name <name>", "connection name")
    .action(async (folder, opts, cmd) => {
      const out = createOutput(cmd);

      const absPath = resolve(folder);
      if (!existsSync(absPath)) {
        out.error("FOLDER_NOT_FOUND", `Folder not found: ${absPath}`, "Check the path exists.");
        return;
      }
      if (!statSync(absPath).isDirectory()) {
        out.error("FOLDER_NOT_FOUND", `Not a directory: ${absPath}`, "Provide a folder path, not a file.");
        return;
      }

      const projectId = opts.project;
      if (!projectId) {
        out.error("MISSING_PROJECT", "Project ID is required.", "Use: puppyone connect ./folder -p <project-id>");
        return;
      }

      let api;
      try {
        api = createClient(cmd);
      } catch (e) {
        if (e instanceof ApiError) {
          out.error(e.code, e.message, e.hint);
        } else {
          out.error("UNKNOWN", e.message);
        }
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

        // Save to local config so watch/sync know about this connection
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
        if (e instanceof ApiError) {
          out.error(e.code, e.message, e.hint);
        } else {
          out.error("CONNECT_FAILED", e.message, "Check the API server is running and the project ID is correct.");
        }
      }
    });
}
