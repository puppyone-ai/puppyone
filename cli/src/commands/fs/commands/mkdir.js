import { withErrors } from "../../../helpers.js";
import { createOutput } from "../../../output.js";
import { createApClient, extraHeaders } from "../lib/context.js";
import { addFsHelp, JSON_METADATA_NOTE, MUTATION_AUDIT_NOTE, MUTATION_SILENT_NOTE, SCOPE_NOTE } from "../lib/help.js";
import { getCurrentScopeBaseCommit, post } from "../lib/http.js";
import { scopedPath } from "../lib/paths.js";

export function registerMkdirCommand(fs) {
  addFsHelp(fs
    .command("mkdir")
    .description("Create a directory within the access point scope")
    .argument("<paths...>", "directory path(s) relative to the access point scope")
    .option("-p, --parents", "create parent directories as needed; no error if already exists"), {
      examples: [
        "puppyone fs mkdir docs",
        "puppyone fs mkdir -p notes/2026/may",
        "puppyone --json fs mkdir -p notes/2026/may",
      ],
      notes: [
        SCOPE_NOTE,
        MUTATION_SILENT_NOTE,
        MUTATION_AUDIT_NOTE,
        JSON_METADATA_NOTE,
      ],
    })
    .action(withErrors(async (paths, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createApClient(cmd);
      const headers = await extraHeaders(cmd);
      const results = [];
      for (const path of paths) {
        const cleanPath = scopedPath(path);
        const baseCommitId = await getCurrentScopeBaseCommit(client, headers);
        const result = await post(client, "/ap-fs/mkdir", {
          path: cleanPath,
          base_commit_id: baseCommitId,
          parents: !!opts.parents,
        }, headers);
        results.push(result);
      }
      if (out.json) {
        if (results.length === 1) out.success(results[0]);
        else out.success({ results });
      }
    }));
}
